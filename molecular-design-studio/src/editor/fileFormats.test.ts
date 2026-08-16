import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getFormatFromExtension,
  parseSequenceFile,
  exportToGenbank,
  exportToFasta,
  exportToSnapGene,
  exportSequenceFile,
} from "./fileFormats";
import { parseGenBank, parseSnapGene } from "./parser";
import type { SequenceDocument } from "../types";
import puc19Raw from "../fixtures/puc19.gb?raw";
import snapGeneFixtureUrl from "../../tests/fixtures/snapgene-fwd-feature-circular.dna?inline";

// The narrow node:fs / node:path declarations live in src/types/ambient.d.ts.
const ab1FixturePath = resolve(process.cwd(), "src/fixtures/synthetic_trace.ab1");

function decodeInlineFixture(dataUrl: string): Uint8Array {
  const encoded = dataUrl.split(",")[1];
  if (!encoded) throw new Error("SnapGene fixture was not inlined");
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

describe("getFormatFromExtension", () => {
  it("detects .gb as genbank", () => {
    expect(getFormatFromExtension("file.gb")).toBe("genbank");
  });

  it("detects .gbk as genbank", () => {
    expect(getFormatFromExtension("file.gbk")).toBe("genbank");
  });

  it("detects .fasta as fasta", () => {
    expect(getFormatFromExtension("file.fasta")).toBe("fasta");
  });

  it("detects .fa as fasta", () => {
    expect(getFormatFromExtension("file.fa")).toBe("fasta");
  });

  it("detects .fna as fasta", () => {
    expect(getFormatFromExtension("file.fna")).toBe("fasta");
  });

  it("detects .dna as snapgene", () => {
    expect(getFormatFromExtension("file.dna")).toBe("snapgene");
  });

  it("detects .ab1 as ab1", () => {
    expect(getFormatFromExtension("read.ab1")).toBe("ab1");
  });

  it("detects .abi as ab1", () => {
    expect(getFormatFromExtension("read.abi")).toBe("ab1");
  });

  it("normalizes uppercase extensions", () => {
    expect(getFormatFromExtension("FILE.GB")).toBe("genbank");
    expect(getFormatFromExtension("FILE.FASTA")).toBe("fasta");
    expect(getFormatFromExtension("FILE.GBK")).toBe("genbank");
    expect(getFormatFromExtension("FILE.DNA")).toBe("snapgene");
    expect(getFormatFromExtension("FILE.AB1")).toBe("ab1");
  });

  it("returns null for unsupported extension", () => {
    expect(getFormatFromExtension("file.txt")).toBeNull();
    expect(getFormatFromExtension("file.json")).toBeNull();
  });

  it("returns null when there is no extension", () => {
    expect(getFormatFromExtension("noext")).toBeNull();
  });
});

describe("parseSequenceFile", () => {
  it("parses a GenBank file by extension", async () => {
    const doc = await parseSequenceFile(puc19Raw, "pUC19.gb");
    expect(doc.name).toBeTruthy();
    expect(doc.sequence.length).toBe(2686);
    expect(doc.circular).toBe(true);
    expect(doc.features.length).toBeGreaterThan(0);
  });

  it("parses a single-record FASTA file", async () => {
    const fasta = ">test_seq\nATCGATCGATCG\nATCG\n";
    const doc = await parseSequenceFile(fasta, "test.fasta");
    expect(doc.name).toBe("test_seq");
    expect(doc.sequence).toBe("ATCGATCGATCGATCG");
    expect(doc.circular).toBe(false);
    expect(doc.features).toHaveLength(0);
  });

  it("parses a SnapGene .dna file with topology and annotations", async () => {
    const fixture = decodeInlineFixture(snapGeneFixtureUrl);
    const doc = await parseSequenceFile(
      fixture,
      "snapgene-fwd-feature-circular.dna",
    );

    expect(doc.sequence).toHaveLength(1280);
    expect(doc.circular).toBe(true);
    expect(doc.features).toEqual([
      expect.objectContaining({
        name: "fwdFeature",
        type: "misc_feature",
        start: 299,
        end: 400,
        strand: 1,
        color: "#a6acb3",
      }),
    ]);
  });

  it("does not expose the local path as the SnapGene document name", async () => {
    const fixture = decodeInlineFixture(snapGeneFixtureUrl);
    const doc = await parseSequenceFile(
      fixture,
      "/Users/researcher/private-project/snapgene-fwd-feature-circular.dna",
    );

    expect(doc.name).toBe("snapgene-fwd-feature-circular");
    expect(doc.name).not.toContain("/Users/");
  });

  it("rejects SnapGene input passed as text", async () => {
    await expect(parseSequenceFile("not binary", "bad.dna")).rejects.toThrow(
      "must be binary",
    );
  });

  it("imports an .ab1 trace as a plain sequence document (no chromatogram)", async () => {
    const bytes = readFileSync(ab1FixturePath);
    const doc = await parseSequenceFile(bytes, "mcs_read.ab1");

    // 57 basecalls from the pUC19 MCS (HindIII -> EcoRI).
    expect(doc.sequence).toBe(
      "AAGCTTGCATGCCTGCAGGTCGACTCTAGAGGATCCCCGGGTACCGAGCTCGAATTC",
    );
    // Import keeps only the called bases — no trace data, no features.
    expect(doc.circular).toBe(false);
    expect(doc.features).toEqual([]);
  });

  it("names an .ab1 document from the file base, never the full path", async () => {
    const bytes = readFileSync(ab1FixturePath);
    const doc = await parseSequenceFile(
      bytes,
      "/Users/researcher/reads/mcs_read.ab1",
    );

    expect(doc.name).toBe("mcs_read");
    expect(doc.name).not.toContain("/Users/");
  });

  it("rejects ABI input passed as text", async () => {
    await expect(parseSequenceFile("not binary", "bad.ab1")).rejects.toThrow(
      "must be binary",
    );
  });

  it("rejects multi-record FASTA", async () => {
    const multiFasta = ">seq1\nATCG\n>seq2\nGCTA\n";
    await expect(parseSequenceFile(multiFasta, "multi.fasta")).rejects.toThrow(
      "Multiple FASTA records",
    );
  });

  it("rejects unsupported extension", async () => {
    await expect(parseSequenceFile("data", "file.xyz")).rejects.toThrow(
      "Unsupported file extension: .xyz",
    );
  });
});

describe("exportToGenbank round-trip", () => {
  it("round-trips pUC19 canonical sequence and feature coordinates", () => {
    const original = parseGenBank(puc19Raw);
    const exported = exportToGenbank(original);
    const roundTripped = parseGenBank(exported);

    expect(roundTripped.name).toBe(original.name);
    expect(roundTripped.sequence).toBe(original.sequence);
    expect(roundTripped.circular).toBe(original.circular);
    expect(roundTripped.features.length).toBe(original.features.length);
    expect(roundTripped.accession).toBe(original.accession);
    expect(roundTripped.version).toBe(original.version);

    for (let i = 0; i < original.features.length; i++) {
      const orig = original.features[i]!;
      const rt = roundTripped.features[i]!;
      expect(rt.start).toBe(orig.start);
      expect(rt.end).toBe(orig.end);
      expect(rt.strand).toBe(orig.strand);
      expect(rt.name).toBe(orig.name);
      expect(rt.type).toBe(orig.type);
    }
  });

  it("preserves qualifiers in round-trip", () => {
    const original = parseGenBank(puc19Raw);
    const exported = exportToGenbank(original);
    const roundTripped = parseGenBank(exported);

    // Check that at least some qualifier keys are preserved
    for (let i = 0; i < original.features.length; i++) {
      const origKeys = Object.keys(original.features[i]!.qualifiers).sort();
      const rtKeys = Object.keys(roundTripped.features[i]!.qualifiers).sort();
      expect(rtKeys).toEqual(origKeys);
    }
  });

  // A-BIO-004: an origin-spanning feature exports as join() and re-imports
  // with the same segments.
  it("exports an origin-spanning feature as join() and round-trips segments", () => {
    const doc: SequenceDocument = {
      name: "wrap",
      sequence: "A".repeat(100),
      circular: true,
      features: [
        {
          id: "wrapGene",
          name: "wrapGene",
          type: "gene",
          start: 90,
          end: 10,
          strand: 1,
          qualifiers: {},
          segments: [
            { start: 90, end: 100 },
            { start: 0, end: 10 },
          ],
        },
      ],
    };
    const exported = exportToGenbank(doc);
    expect(exported).toContain("join(91..100,1..10)");

    const roundTripped = parseGenBank(exported);
    const rt = roundTripped.features[0]!;
    expect(rt.name).toBe("wrapGene");
    expect(rt.start).toBe(90);
    expect(rt.end).toBe(10);
    expect(rt.segments).toEqual([
      { start: 90, end: 100 },
      { start: 0, end: 10 },
    ]);
  });
});

describe("exportToFasta round-trip", () => {
  it("round-trips sequence through FASTA", async () => {
    const original = parseGenBank(puc19Raw);
    const fasta = exportToFasta(original);
    const roundTripped = await parseSequenceFile(fasta, "exported.fasta");

    expect(roundTripped.sequence).toBe(original.sequence);
    expect(roundTripped.circular).toBe(false);
    expect(roundTripped.features).toHaveLength(0);
  });
});

describe("exportSequenceFile", () => {
  it("exports GenBank when filename has .gb extension", () => {
    const doc = parseGenBank(puc19Raw);
    const result = exportSequenceFile(doc, "output.gb");
    expect(result).toContain("LOCUS");
    expect(result).toContain("//");
  });

  it("exports FASTA when filename has .fasta extension", () => {
    const doc = parseGenBank(puc19Raw);
    const result = exportSequenceFile(doc, "output.fasta");
    expect(result).toMatch(/^>/);
  });

  it("throws for unsupported extension", () => {
    const doc = parseGenBank(puc19Raw);
    expect(() => exportSequenceFile(doc, "output.txt")).toThrow(
      "Unsupported file extension",
    );
  });

  it("exports .dna as binary bytes", () => {
    const doc = parseGenBank(puc19Raw);
    const result = exportSequenceFile(doc, "output.dna");
    expect(result).toBeInstanceOf(Uint8Array);
  });
});

describe("exportToSnapGene", () => {
  it("writes a SnapGene header with the expected magic bytes", () => {
    const bytes = exportToSnapGene({
      name: "pX",
      sequence: "ATGC",
      circular: false,
      features: [],
    });
    expect(bytes[0]).toBe(0x09);
    expect(bytes[1]).toBe(0x00);
    expect(bytes[2]).toBe(0x00);
    expect(bytes[3]).toBe(0x00);
    expect(bytes[4]).toBe(0x0e);
    expect(new TextDecoder().decode(bytes.slice(5, 13))).toBe("SnapGene");
  });

  it("throws for an empty sequence", () => {
    expect(() =>
      exportToSnapGene({
        name: "empty",
        sequence: "",
        circular: false,
        features: [],
      }),
    ).toThrow("empty sequence");
  });

  it("round-trips sequence, name, and topology through parseSnapGene", async () => {
    const original = parseGenBank(puc19Raw);
    const bytes = exportToSnapGene(original);
    const roundTripped = await parseSnapGene(bytes, "roundtrip.dna");

    expect(roundTripped.name).toBe(original.name);
    expect(roundTripped.sequence).toBe(original.sequence);
    expect(roundTripped.circular).toBe(original.circular);
    expect(roundTripped.features.length).toBe(original.features.length);

    for (let i = 0; i < original.features.length; i++) {
      const orig = original.features[i]!;
      const rt = roundTripped.features[i]!;
      expect(rt.name).toBe(orig.name);
      expect(rt.type).toBe(orig.type);
      expect(rt.start).toBe(orig.start);
      expect(rt.end).toBe(orig.end);
      expect(rt.strand).toBe(orig.strand);
    }
  });

  it("preserves reverse-strand features and colors", async () => {
    const doc: SequenceDocument = {
      name: "Reverse Test",
      sequence: "ATGCATGCATGC",
      circular: false,
      features: [
        {
          id: "rev",
          name: "ampR",
          type: "gene",
          start: 2,
          end: 8,
          strand: -1,
          color: "#ff8800",
          qualifiers: {},
        },
      ],
    };
    const roundTripped = await parseSnapGene(exportToSnapGene(doc), "rev.dna");

    expect(roundTripped.circular).toBe(false);
    expect(roundTripped.features).toEqual([
      expect.objectContaining({
        name: "ampR",
        type: "gene",
        start: 2,
        end: 8,
        strand: -1,
        color: "#ff8800",
      }),
    ]);
  });

  it("round-trips feature qualifiers (gene/translation/note/multi-value)", async () => {
    // A-BIO-001 regression: qualifiers must survive .dna export → import,
    // including repeated (multi-value) notes and XML-special characters.
    const doc: SequenceDocument = {
      name: "qualifier-doc",
      sequence: "ATGGCTAGCTAGCATGAAAAAAGCTTGCATGCAT",
      circular: true,
      features: [
        {
          id: "cds",
          name: "lacZ",
          type: "CDS",
          start: 1,
          end: 18,
          strand: 1,
          color: "#44aa66",
          qualifiers: {
            gene: ["lacZ"],
            product: ["beta-galactosidase & luciferase <fused>"],
            translation: ["MASHASKHHHHH"],
            note: ["first note", "second <note> & more"],
            locus_tag: ["b0344"],
          },
        },
      ],
    };
    const roundTripped = await parseSnapGene(exportToSnapGene(doc), "qualifier.dna");

    expect(roundTripped.features[0]!.qualifiers).toEqual({
      gene: ["lacZ"],
      product: ["beta-galactosidase & luciferase <fused>"],
      translation: ["MASHASKHHHHH"],
      note: ["first note", "second <note> & more"],
      locus_tag: ["b0344"],
    });
    expect(roundTripped.features[0]!.color).toBe("#44aa66");
  });

  it("drops empty-string qualifier values on export", async () => {
    const doc: SequenceDocument = {
      name: "empty-qualifiers",
      sequence: "AAAAACCCCCTTTTT",
      circular: false,
      features: [
        {
          id: "f",
          name: "f1",
          type: "gene",
          start: 0,
          end: 5,
          strand: 1,
          qualifiers: { note: ["", "real note"], gene: [] },
        },
      ],
    };
    const roundTripped = await parseSnapGene(exportToSnapGene(doc), "empty.dna");
    expect(roundTripped.features[0]!.qualifiers).toEqual({ note: ["real note"] });
  });

  it("escapes XML-special characters in names and types", async () => {
    const doc: SequenceDocument = {
      name: "p<A&T>\"q'",
      sequence: "GGGGCCCC",
      circular: true,
      features: [
        {
          id: "esc",
          name: "g<1>&2",
          type: "gene",
          start: 1,
          end: 5,
          strand: 1,
          qualifiers: {},
        },
      ],
    };
    const roundTripped = await parseSnapGene(exportToSnapGene(doc), "esc.dna");

    expect(roundTripped.circular).toBe(true);
    expect(roundTripped.name).toBe('p<A&T>"q\'');
    expect(roundTripped.features[0]!.name).toBe("g<1>&2");
    expect(roundTripped.features[0]!.start).toBe(1);
    expect(roundTripped.features[0]!.end).toBe(5);
  });

  it("round-trips purely numeric document names", async () => {
    const doc: SequenceDocument = {
      name: "123",
      sequence: "ACGT",
      circular: false,
      features: [],
    };
    const roundTripped = await parseSnapGene(exportToSnapGene(doc), "num.dna");
    expect(roundTripped.name).toBe("123");
  });

  it("rejects features whose range exceeds the sequence", () => {
    const doc: SequenceDocument = {
      name: "bad",
      sequence: "ATGC",
      circular: false,
      features: [
        {
          id: "f",
          name: "overshoot",
          type: "misc_feature",
          start: 2,
          end: 9,
          strand: 1,
          qualifiers: {},
        },
      ],
    };
    expect(() => exportToSnapGene(doc)).toThrow("exceeds sequence length");
  });

  // A-BIO-004: an origin-spanning feature writes two <Segment> elements and
  // round-trips through the SnapGene binary parser.
  it("round-trips an origin-spanning feature through SnapGene segments", async () => {
    const doc: SequenceDocument = {
      name: "wrap",
      sequence: "A".repeat(100),
      circular: true,
      features: [
        {
          id: "wrapGene",
          name: "wrapGene",
          type: "gene",
          start: 90,
          end: 10,
          strand: 1,
          qualifiers: {},
          segments: [
            { start: 90, end: 100 },
            { start: 0, end: 10 },
          ],
        },
      ],
    };
    const bytes = exportToSnapGene(doc);
    const roundTripped = await parseSnapGene(bytes, "wrap.dna");

    expect(roundTripped.circular).toBe(true);
    const rt = roundTripped.features[0]!;
    expect(rt.name).toBe("wrapGene");
    expect(rt.start).toBe(90);
    expect(rt.end).toBe(10);
    expect(rt.segments).toEqual([
      { start: 90, end: 100 },
      { start: 0, end: 10 },
    ]);
  });
});
