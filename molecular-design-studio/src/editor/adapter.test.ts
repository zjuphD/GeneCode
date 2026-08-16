import { describe, it, expect } from "vitest";
import {
  toOveData,
  toOveFeature,
  oveEndToCanonicalEnd,
  fromOveData,
  resolveDisplayColor,
  isOveFallbackColor,
} from "./adapter";
import { parseGenBank } from "./parser";
import type { SequenceDocument, SequenceFeature } from "../types";
import type { OveSequenceData } from "@teselagen/ove";
import puc19Raw from "../fixtures/puc19.gb?raw";

describe("OveAdapter coordinate conversion", () => {
  it("converts a forward feature from half-open to inclusive", () => {
    const feature: SequenceFeature = {
      id: "test-1",
      name: "lacZ",
      type: "gene",
      start: 100,
      end: 500,
      strand: 1,
      qualifiers: {},
    };

    const ove = toOveFeature(feature);
    expect(ove.start).toBe(100);
    expect(ove.end).toBe(499); // inclusive end = exclusive end - 1
    expect(ove.strand).toBe(1);
    expect(ove.forward).toBe(true);
    expect(ove.name).toBe("lacZ");
  });

  it("converts a reverse feature from half-open to inclusive", () => {
    const feature: SequenceFeature = {
      id: "test-2",
      name: "ampR",
      type: "gene",
      start: 1000,
      end: 1800,
      strand: -1,
      qualifiers: {},
    };

    const ove = toOveFeature(feature);
    expect(ove.start).toBe(1000);
    expect(ove.end).toBe(1799); // inclusive end = exclusive end - 1
    expect(ove.strand).toBe(-1);
    expect(ove.forward).toBe(false);
  });

  it("round-trips end via oveEndToCanonicalEnd", () => {
    // canonical [100, 500) -> OVE [100, 499] -> back to 500
    const canonicalEnd = 500;
    const oveEnd = canonicalEnd - 1;
    expect(oveEndToCanonicalEnd(oveEnd)).toBe(canonicalEnd);
  });

  it("handles a feature at position zero", () => {
    const feature: SequenceFeature = {
      id: "test-3",
      name: "start",
      type: "source",
      start: 0,
      end: 1,
      strand: 1,
      qualifiers: {},
    };

    const ove = toOveFeature(feature);
    expect(ove.start).toBe(0);
    expect(ove.end).toBe(0); // single-base feature: [0,1) -> [0,0]
  });

  it("pUC19 source feature round-trips [0,2686) -> OVE [0,2685]", () => {
    const doc = parseGenBank(puc19Raw);
    const source = doc.features.find((f) => f.type === "source");
    expect(source).toBeDefined();
    const ove = toOveFeature(source!);
    expect(ove.start).toBe(0);
    expect(ove.end).toBe(2685);
  });

  it("pUC19 M13mp19 feature round-trips [0,447) -> OVE [0,446]", () => {
    const doc = parseGenBank(puc19Raw);
    const m13 = doc.features.find((f) => f.name === "M13mp19");
    expect(m13).toBeDefined();
    const ove = toOveFeature(m13!);
    expect(ove.start).toBe(0);
    expect(ove.end).toBe(446);
  });

  it("sets circular=false when viewMode is linear", () => {
    const doc = parseGenBank(puc19Raw);
    expect(doc.circular).toBe(true);

    const linearData = toOveData(doc, "linear");
    expect(linearData.circular).toBe(false);

    const circularData = toOveData(doc, "circular");
    expect(circularData.circular).toBe(true);
  });

  it("maps canonical qualifiers to OVE notes", () => {
    const feature: SequenceFeature = {
      id: "test-notes",
      name: "test",
      type: "gene",
      start: 0,
      end: 100,
      strand: 1,
      qualifiers: { gene: ["lacZ"], note: ["beta-galactosidase"] },
    };

    const ove = toOveFeature(feature);
    expect(ove.notes).toEqual({ gene: ["lacZ"], note: ["beta-galactosidase"] });
  });

  it("maps canonical color to OVE color", () => {
    const feature: SequenceFeature = {
      id: "test-color",
      name: "colored",
      type: "CDS",
      start: 0,
      end: 100,
      strand: 1,
      qualifiers: {},
      color: "#ff0000",
    };

    const ove = toOveFeature(feature);
    expect(ove.color).toBe("#ff0000");
  });
});

describe("fromOveData reverse conversion", () => {
  const makeOveData = (
    overrides: Partial<OveSequenceData> = {},
  ): OveSequenceData => ({
    name: "test",
    sequence: "ATCGATCG",
    circular: false,
    features: [],
    ...overrides,
  });

  it("converts a valid OVE feature back to canonical half-open", () => {
    const oveData = makeOveData({
      features: [
        {
          id: "f1",
          name: "lacZ",
          type: "gene",
          start: 100,
          end: 499,
          strand: 1,
          forward: true,
          notes: { gene: ["lacZ"] },
        },
      ],
    });

    // pad sequence to be long enough
    oveData.sequence = "A".repeat(500);

    const result = fromOveData(oveData);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.features).toHaveLength(1);
    expect(result.doc.features[0]!.start).toBe(100);
    expect(result.doc.features[0]!.end).toBe(500); // inclusive 499 -> exclusive 500
    expect(result.doc.features[0]!.strand).toBe(1);
    expect(result.doc.features[0]!.qualifiers).toEqual({ gene: ["lacZ"] });
  });

  it("preserves annotations when OVE returns features as an object after editing", () => {
    const oveData = makeOveData({
      sequence: "A".repeat(501),
      features: {
        f1: {
          id: "f1",
          name: "lacZ",
          type: "gene",
          start: 101,
          end: 500,
          strand: 1,
          forward: true,
        },
      } as unknown as OveSequenceData["features"],
    });

    const result = fromOveData(oveData);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.features).toEqual([
      expect.objectContaining({
        id: "f1",
        name: "lacZ",
        start: 101,
        end: 501,
      }),
    ]);
  });

  it("preserves accession and version from original document", () => {
    const original: SequenceDocument = {
      name: "pUC19",
      sequence: "ATCG",
      circular: true,
      features: [],
      accession: "M77789",
      version: "M77789.2",
    };

    const oveData = makeOveData({ sequence: "ATCG", name: "pUC19", circular: true });
    const result = fromOveData(oveData, original);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.accession).toBe("M77789");
    expect(result.doc.version).toBe("M77789.2");
  });

  it("round-trips pUC19 through toOveData and fromOveData", () => {
    const doc = parseGenBank(puc19Raw);
    const oveData = toOveData(doc);
    const result = fromOveData(oveData, doc);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.doc.name).toBe(doc.name);
    expect(result.doc.sequence.length).toBe(doc.sequence.length);
    expect(result.doc.circular).toBe(doc.circular);
    expect(result.doc.features.length).toBe(doc.features.length);

    // Verify coordinate round-trip for each feature
    for (let i = 0; i < doc.features.length; i++) {
      expect(result.doc.features[i]!.start).toBe(doc.features[i]!.start);
      expect(result.doc.features[i]!.end).toBe(doc.features[i]!.end);
    }
  });

  // A-BIO-004: an origin-spanning feature (canonical start > end with
  // segments) round-trips through the OVE engine's spans-origin convention
  // (start > end inclusive) and its `locations` join pieces.
  it("round-trips an origin-spanning feature through locations", () => {
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
    const oveData = toOveData(doc);
    const oveFeature = oveData.features[0] as { start: number; end: number; locations?: Array<{ start: number; end: number }> };
    expect(oveFeature.start).toBe(90);
    expect(oveFeature.end).toBe(9);
    expect(oveFeature.locations).toEqual([
      { start: 90, end: 99 },
      { start: 0, end: 9 },
    ]);

    const result = fromOveData(oveData, doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rt = result.doc.features[0]!;
    expect(rt.start).toBe(90);
    expect(rt.end).toBe(10);
    expect(rt.segments).toEqual([
      { start: 90, end: 100 },
      { start: 0, end: 10 },
    ]);
  });

  it("accepts a spans-origin OVE feature without explicit locations", () => {
    const oveData = makeOveData({
      sequence: "A".repeat(100),
      circular: true,
      features: [
        { id: "wrap", name: "wrap", type: "gene", start: 90, end: 9, strand: 1 },
      ],
    });
    const result = fromOveData(oveData);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rt = result.doc.features[0]!;
    expect(rt.start).toBe(90);
    expect(rt.end).toBe(10);
    expect(rt.segments).toEqual([
      { start: 90, end: 100 },
      { start: 0, end: 10 },
    ]);
  });

  it("rejects empty sequence", () => {
    const oveData = makeOveData({ sequence: "" });
    const result = fromOveData(oveData);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.message).toContain("empty");
  });

  it("rejects negative start", () => {
    const oveData = makeOveData({
      sequence: "ATCG",
      features: [
        { id: "f1", name: "bad", type: "gene", start: -1, end: 2, strand: 1 },
      ],
    });
    const result = fromOveData(oveData);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.message).toContain("negative");
  });

  it("rejects end before start", () => {
    const oveData = makeOveData({
      sequence: "ATCG",
      features: [
        { id: "f1", name: "bad", type: "gene", start: 3, end: 1, strand: 1 },
      ],
    });
    const result = fromOveData(oveData);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.message).toContain("before start");
  });

  it("rejects start beyond sequence length", () => {
    const oveData = makeOveData({
      sequence: "ATCG",
      features: [
        { id: "f1", name: "bad", type: "gene", start: 10, end: 12, strand: 1 },
      ],
    });
    const result = fromOveData(oveData);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.message).toContain(">= sequence length");
  });

  it("rejects inclusive end beyond sequence length", () => {
    const oveData = makeOveData({
      sequence: "ATCG",
      features: [
        { id: "f1", name: "bad", type: "gene", start: 0, end: 10, strand: 1 },
      ],
    });
    const result = fromOveData(oveData);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.message).toContain("inclusive end");
  });

  it("rejects non-integer coordinates", () => {
    const oveData = makeOveData({
      sequence: "ATCG",
      features: [
        { id: "f1", name: "bad", type: "gene", start: 1.5, end: 2, strand: 1 },
      ],
    });
    const result = fromOveData(oveData);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.message).toContain("integers");
  });

  it("reports multiple errors for multiple invalid features", () => {
    const oveData = makeOveData({
      sequence: "ATCG",
      features: [
        { id: "f1", name: "bad1", type: "gene", start: -1, end: 2, strand: 1 },
        { id: "f2", name: "bad2", type: "gene", start: 3, end: 1, strand: 1 },
      ],
    });
    const result = fromOveData(oveData);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(2);
  });

  it("does not replace document when conversion fails", () => {
    const oveData = makeOveData({
      sequence: "ATCG",
      features: [
        { id: "f1", name: "bad", type: "gene", start: -1, end: 2, strand: 1 },
      ],
    });
    const result = fromOveData(oveData);
    expect(result.ok).toBe(false);
    // No partial document should be returned
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("preserves reverse orientation from forward: false without numeric strand", () => {
    const oveData = makeOveData({
      sequence: "A".repeat(500),
      features: [
        {
          id: "f-rev",
          name: "revGene",
          type: "gene",
          start: 100,
          end: 200,
          strand: 0,
          forward: false,
        },
      ],
    });

    const result = fromOveData(oveData);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.features[0]!.strand).toBe(-1);
  });

  it("preserves forward orientation from forward: true", () => {
    const oveData = makeOveData({
      sequence: "A".repeat(500),
      features: [
        {
          id: "f-fwd",
          name: "fwdGene",
          type: "gene",
          start: 100,
          end: 200,
          strand: 0,
          forward: true,
        },
      ],
    });

    const result = fromOveData(oveData);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.features[0]!.strand).toBe(1);
  });

  it("uppercases sequence in canonical output", () => {
    const oveData = makeOveData({ sequence: "atcgatcg" });
    const result = fromOveData(oveData);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.sequence).toBe("ATCGATCG");
  });
});

describe("isOveFallbackColor", () => {
  it("returns true for undefined color", () => {
    expect(isOveFallbackColor(undefined)).toBe(true);
  });

  it("returns true for #0B17BD (case-insensitive)", () => {
    expect(isOveFallbackColor("#0B17BD")).toBe(true);
    expect(isOveFallbackColor("#0b17bd")).toBe(true);
  });

  it("returns true for #006FEF (case-insensitive)", () => {
    expect(isOveFallbackColor("#006FEF")).toBe(true);
    expect(isOveFallbackColor("#006fef")).toBe(true);
  });

  it("returns false for explicit custom colors", () => {
    expect(isOveFallbackColor("#ff0000")).toBe(false);
    expect(isOveFallbackColor("#5e8c6a")).toBe(false);
  });
});

describe("resolveDisplayColor", () => {
  const makeFeature = (
    overrides: Partial<SequenceFeature> = {},
  ): SequenceFeature => ({
    id: "f1",
    name: "test",
    type: "gene",
    start: 0,
    end: 100,
    strand: 1,
    qualifiers: {},
    ...overrides,
  });

  it("returns explicit custom color unchanged", () => {
    const feature = makeFeature({ color: "#ff0000" });
    expect(resolveDisplayColor(feature)).toBe("#ff0000");
  });

  it("maps undefined color to a palette entry", () => {
    const feature = makeFeature({ color: undefined });
    const result = resolveDisplayColor(feature);
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("maps OVE fallback #0B17BD to a palette entry", () => {
    const feature = makeFeature({ color: "#0B17BD" });
    const result = resolveDisplayColor(feature);
    expect(result).not.toBe("#0B17BD");
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("maps OVE fallback #006FEF to a palette entry", () => {
    const feature = makeFeature({ color: "#006FEF" });
    const result = resolveDisplayColor(feature);
    expect(result).not.toBe("#006FEF");
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("is deterministic: same identity returns same color", () => {
    const a = makeFeature({ type: "gene", name: "lacZ" });
    const b = makeFeature({ type: "gene", name: "lacZ" });
    expect(resolveDisplayColor(a)).toBe(resolveDisplayColor(b));
  });

  it("different identities map to different palette entries", () => {
    // Deterministic: known feature identities must produce distinct colors
    const lacZ = makeFeature({ type: "gene", name: "lacZ" });
    const ampR = makeFeature({ type: "gene", name: "ampR" });
    const ori = makeFeature({ type: "rep_origin", name: "ori" });
    const source = makeFeature({ type: "source", name: "source" });
    const colors = new Set([
      resolveDisplayColor(lacZ),
      resolveDisplayColor(ampR),
      resolveDisplayColor(ori),
      resolveDisplayColor(source),
    ]);
    expect(colors.size).toBeGreaterThanOrEqual(3);
  });

  it("same feature in circular and linear maps gets the same color", () => {
    const feature = makeFeature({ type: "rep_origin", name: "ori" });
    expect(resolveDisplayColor(feature)).toBe(resolveDisplayColor(feature));
  });

  it("pUC19 fallback features resolve to at least four distinct colors", () => {
    const doc = parseGenBank(puc19Raw);
    const colors = new Set<string>();
    for (const f of doc.features) {
      colors.add(resolveDisplayColor(f));
    }
    expect(colors.size).toBeGreaterThanOrEqual(4);
  });

  it("pUC19 source feature is not the dominant warm color", () => {
    const doc = parseGenBank(puc19Raw);
    const source = doc.features.find((f) => f.type === "source");
    expect(source).toBeDefined();
    const sourceColor = resolveDisplayColor(source!);
    // Source should not be the warm accent (#c17c3e or #b05a5a)
    const warmColors = new Set(["#c17c3e", "#b05a5a"]);
    expect(warmColors.has(sourceColor)).toBe(false);
  });
});

describe("display color round-trip safety", () => {
  it("toOveFeature sends resolved display color", () => {
    const feature: SequenceFeature = {
      id: "f1",
      name: "lacZ",
      type: "gene",
      start: 100,
      end: 500,
      strand: 1,
      qualifiers: {},
    };
    // No explicit color -> should get a resolved display color
    const ove = toOveFeature(feature);
    expect(ove.color).toBeDefined();
    expect(ove.color).not.toBe(feature.color); // feature.color was undefined
    expect(ove.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("toOveFeature preserves explicit custom color", () => {
    const feature: SequenceFeature = {
      id: "f1",
      name: "lacZ",
      type: "gene",
      start: 100,
      end: 500,
      strand: 1,
      qualifiers: {},
      color: "#ff0000",
    };
    const ove = toOveFeature(feature);
    expect(ove.color).toBe("#ff0000");
  });

  it("render conversion does not mutate canonical feature object", () => {
    const feature: SequenceFeature = {
      id: "f1",
      name: "lacZ",
      type: "gene",
      start: 100,
      end: 500,
      strand: 1,
      qualifiers: {},
      color: undefined,
    };
    const originalColor = feature.color;
    toOveFeature(feature);
    expect(feature.color).toBe(originalColor);
  });

  it("OVE save round trip restores original fallback color when unchanged", () => {
    const original: SequenceDocument = {
      name: "test",
      sequence: "A".repeat(600),
      circular: false,
      features: [
        {
          id: "f1",
          name: "lacZ",
          type: "gene",
          start: 100,
          end: 500,
          strand: 1,
          qualifiers: {},
          // No explicit color — OVE fallback
        },
      ],
    };

    const oveData = toOveData(original);
    // Simulate OVE returning the same display color (user didn't change it)
    const result = fromOveData(oveData, original);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The canonical feature should still have no explicit color
    expect(result.doc.features[0]!.color).toBeUndefined();
  });

  it("preserves original undefined color after round trip", () => {
    const original: SequenceDocument = {
      name: "test",
      sequence: "A".repeat(600),
      circular: false,
      features: [
        {
          id: "f1",
          name: "ampR",
          type: "gene",
          start: 100,
          end: 500,
          strand: -1,
          qualifiers: {},
          color: "#0B17BD", // OVE fallback in canonical
        },
      ],
    };

    const oveData = toOveData(original);
    const result = fromOveData(oveData, original);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Original canonical fallback color is preserved
    expect(result.doc.features[0]!.color).toBe("#0B17BD");
  });

  it("preserves genuinely changed OVE feature color", () => {
    const original: SequenceDocument = {
      name: "test",
      sequence: "A".repeat(600),
      circular: false,
      features: [
        {
          id: "f1",
          name: "lacZ",
          type: "gene",
          start: 100,
          end: 500,
          strand: 1,
          qualifiers: {},
          color: undefined,
        },
      ],
    };

    // Convert to OVE
    const oveData = toOveData(original);
    // Simulate user changing the color in OVE to a non-palette color
    oveData.features[0]!.color = "#ff6600";

    const result = fromOveData(oveData, original);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The changed color should survive the round trip
    expect(result.doc.features[0]!.color).toBe("#ff6600");
  });

  it("pUC19 round-trip preserves all feature colors", () => {
    const doc = parseGenBank(puc19Raw);
    const oveData = toOveData(doc);
    const result = fromOveData(oveData, doc);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (let i = 0; i < doc.features.length; i++) {
      expect(result.doc.features[i]!.color).toBe(doc.features[i]!.color);
    }
  });
});
