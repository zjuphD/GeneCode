import { describe, it, expect } from "vitest";
import { parseGenBank, parseFasta, convertFeature } from "./parser";
import puc19Raw from "../fixtures/puc19.gb?raw";

describe("parseGenBank", () => {
  it("parses pUC19 name and accession", () => {
    const doc = parseGenBank(puc19Raw);
    expect(doc.name).toBeTruthy();
    expect(doc.version).toBe("M77789.2");
  });

  it("parses pUC19 as 2686 bp", () => {
    const doc = parseGenBank(puc19Raw);
    expect(doc.sequence.length).toBe(2686);
  });

  it("parses pUC19 as circular", () => {
    const doc = parseGenBank(puc19Raw);
    expect(doc.circular).toBe(true);
  });

  it("extracts features from NCBI record", () => {
    const doc = parseGenBank(puc19Raw);
    expect(doc.features.length).toBeGreaterThan(0);
  });

  it("source feature covers full sequence as [0, 2686)", () => {
    const doc = parseGenBank(puc19Raw);
    const source = doc.features.find((f) => f.type === "source");
    expect(source).toBeDefined();
    expect(source!.start).toBe(0);
    expect(source!.end).toBe(2686);
  });

  it("M13mp19 feature covers [0, 447)", () => {
    const doc = parseGenBank(puc19Raw);
    const m13 = doc.features.find((f) => f.name === "M13mp19");
    expect(m13).toBeDefined();
    expect(m13!.start).toBe(0);
    expect(m13!.end).toBe(447);
  });

  it("throws on empty input", () => {
    expect(() => parseGenBank("")).toThrow("empty");
  });

  it("throws on invalid input", () => {
    expect(() => parseGenBank("not a genbank file")).toThrow();
  });
});

describe("convertFeature validation", () => {
  const seqLen = 2686;

  it("throws on NaN start", () => {
    expect(() =>
      convertFeature(
        { type: "gene", start: NaN, end: 100, notes: {} },
        0,
        seqLen,
      ),
    ).toThrow("integers");
  });

  it("throws on negative start", () => {
    expect(() =>
      convertFeature(
        { type: "gene", start: -1, end: 100, notes: {} },
        0,
        seqLen,
      ),
    ).toThrow("negative");
  });

  it("throws on end before start on a linear sequence", () => {
    expect(() =>
      convertFeature(
        { type: "gene", start: 100, end: 50, notes: {} },
        0,
        seqLen,
        false,
      ),
    ).toThrow("before start");
  });

  it("throws on start beyond sequence length", () => {
    expect(() =>
      convertFeature(
        { type: "gene", start: 3000, end: 3100, notes: {} },
        0,
        seqLen,
      ),
    ).toThrow(">= sequence length");
  });

  it("throws on end beyond sequence length", () => {
    expect(() =>
      convertFeature(
        { type: "gene", start: 2680, end: 9999, notes: {} },
        0,
        seqLen,
      ),
    ).toThrow(">= sequence length");
  });

  it("accepts valid feature", () => {
    const result = convertFeature(
      { type: "gene", start: 100, end: 200, notes: {} },
      0,
      seqLen,
    );
    expect(result.start).toBe(100);
    expect(result.end).toBe(201); // inclusive 200 -> half-open 201
  });

  it("throws on fractional start", () => {
    expect(() =>
      convertFeature(
        { type: "gene", start: 10.5, end: 200, notes: {} },
        0,
        seqLen,
      ),
    ).toThrow("integers");
  });

  it("throws on fractional end", () => {
    expect(() =>
      convertFeature(
        { type: "gene", start: 10, end: 200.7, notes: {} },
        0,
        seqLen,
      ),
    ).toThrow("integers");
  });

  it("includes feature name and index in error message", () => {
    expect(() =>
      convertFeature(
        { type: "gene", name: "lacZ", start: -1, end: 100, notes: {} },
        3,
        seqLen,
      ),
    ).toThrow('Feature "lacZ" (index 3)');
  });

  it("throws on end before start on a linear sequence", () => {
    expect(() =>
      convertFeature(
        { type: "gene", start: 90, end: 9, notes: {} },
        0,
        seqLen,
        false,
      ),
    ).toThrow("before start");
  });

  // A-BIO-004: an origin-spanning location (inclusive end before start) is
  // legal on a circular molecule and becomes a canonical segments feature.
  it("accepts an origin-spanning range on a circular sequence with segments", () => {
    const result = convertFeature(
      { type: "gene", start: 90, end: 9, notes: {} },
      0,
      seqLen,
      true,
    );
    expect(result.start).toBe(90);
    expect(result.end).toBe(10);
    expect(result.segments).toEqual([
      { start: 90, end: seqLen },
      { start: 0, end: 10 },
    ]);
  });

  it("honors explicit locations for a joined feature", () => {
    const result = convertFeature(
      {
        type: "gene",
        start: 90,
        end: 9,
        notes: {},
        locations: [
          { start: 90, end: 99 },
          { start: 0, end: 9 },
        ],
      },
      0,
      seqLen,
      true,
    );
    expect(result.start).toBe(90);
    expect(result.end).toBe(10);
    expect(result.segments).toEqual([
      { start: 90, end: 100 },
      { start: 0, end: 10 },
    ]);
  });
});

describe("parseGenBank join() import", () => {
  it("imports an origin-spanning join() feature as a segments feature", () => {
    const sequence = "A".repeat(100);
    const blocks = [];
    for (let i = 0; i < sequence.length; i += 60) {
      blocks.push(
        String(i + 1).padStart(9) +
        " " +
        sequence.slice(i, i + 60).replace(/(.{10})/g, "$1 ").trim(),
      );
    }
    const text = `LOCUS       test                 100 bp    DNA     circular SYN 01-JAN-2020
DEFINITION  test.
ACCESSION   test
FEATURES             Location/Qualifiers
     gene            join(91..100,1..10)
                     /gene="wrapGene"
ORIGIN
${blocks.join("\n")}
//`;
    const doc = parseGenBank(text);
    const gene = doc.features.find((f) => f.name === "wrapGene");
    expect(gene).toBeDefined();
    expect(gene!.start).toBe(90);
    expect(gene!.end).toBe(10);
    expect(gene!.segments).toEqual([
      { start: 90, end: 100 },
      { start: 0, end: 10 },
    ]);
  });
});

describe("parseFasta", () => {
  it("parses a single-record FASTA", () => {
    const text = ">my_sequence\nATCGATCG\nATCG\n";
    const doc = parseFasta(text);
    expect(doc.name).toBe("my_sequence");
    expect(doc.sequence).toBe("ATCGATCGATCG");
    expect(doc.circular).toBe(false);
    expect(doc.features).toHaveLength(0);
  });

  it("uppercases the sequence", () => {
    const text = ">test\natcgatcg\n";
    const doc = parseFasta(text);
    expect(doc.sequence).toBe("ATCGATCG");
  });

  it("rejects empty input", () => {
    expect(() => parseFasta("")).toThrow("empty");
  });

  it("rejects whitespace-only input", () => {
    expect(() => parseFasta("   \n  ")).toThrow("empty");
  });

  it("rejects multi-record FASTA", () => {
    const text = ">seq1\nATCG\n>seq2\nGCTA\n";
    expect(() => parseFasta(text)).toThrow("Multiple FASTA records");
  });

  it("rejects record with no sequence data", () => {
    expect(() => parseFasta(">header\n")).toThrow("no sequence data");
  });

  it("parses FASTA with description after pipe", () => {
    const text = ">seq1|some description\nATCG\n";
    const doc = parseFasta(text);
    expect(doc.name).toBe("seq1");
  });

  it("produces zero features for any FASTA input", () => {
    const text = ">gene_1\n" + "A".repeat(1000) + "\n";
    const doc = parseFasta(text);
    expect(doc.features).toHaveLength(0);
  });
});
