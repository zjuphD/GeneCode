import { describe, it, expect } from "vitest";
import { fromFeatureSelection, fromOveSelection } from "./selection";
import type { SequenceDocument, SequenceFeature } from "../types";

function makeDoc(
  overrides: Partial<SequenceDocument> = {},
): SequenceDocument {
  return {
    name: "test",
    sequence: "ATCGATCGATCGATCG",
    circular: false,
    features: [],
    ...overrides,
  };
}

describe("fromOveSelection", () => {
  it("converts a simple forward selection from inclusive to half-open", () => {
    const doc = makeDoc({ sequence: "A".repeat(100) });
    // OVE inclusive [10, 20] -> canonical [10, 21)
    const sel = fromOveSelection({ start: 10, end: 20 }, doc);
    expect(sel).not.toBeNull();
    expect(sel!.start).toBe(10);
    expect(sel!.end).toBe(21);
    expect(sel!.length).toBe(11);
    expect(sel!.wrapsOrigin).toBe(false);
    expect(sel!.sequence).toBe("A".repeat(11));
  });

  it("extracts the exact selected sequence", () => {
    const doc = makeDoc({ sequence: "ATCGATCGATCGATCG" });
    // OVE [0, 3] -> canonical [0, 4) -> "ATCG"
    const sel = fromOveSelection({ start: 0, end: 3 }, doc);
    expect(sel).not.toBeNull();
    expect(sel!.sequence).toBe("ATCG");
  });

  it("handles single-base selection (start === end in OVE is one base)", () => {
    const doc = makeDoc({ sequence: "ATCG" });
    // OVE inclusive [2, 2] -> canonical [2, 3) -> one base "C"
    const sel = fromOveSelection({ start: 2, end: 2 }, doc);
    expect(sel).not.toBeNull();
    expect(sel!.start).toBe(2);
    expect(sel!.end).toBe(3);
    expect(sel!.length).toBe(1);
    expect(sel!.sequence).toBe("C");
  });

  it("returns null for caret event ({ start: -1, end: -1 })", () => {
    const doc = makeDoc({ sequence: "ATCG" });
    const sel = fromOveSelection({ start: -1, end: -1 }, doc);
    expect(sel).toBeNull();
  });

  it("returns null for null/undefined layer", () => {
    const doc = makeDoc();
    expect(fromOveSelection(null, doc)).toBeNull();
    expect(fromOveSelection(undefined, doc)).toBeNull();
  });

  it("returns null for non-object layer", () => {
    const doc = makeDoc();
    expect(fromOveSelection("string", doc)).toBeNull();
    expect(fromOveSelection(42, doc)).toBeNull();
  });

  it("returns null when start or end is missing", () => {
    const doc = makeDoc();
    expect(fromOveSelection({ start: 0 }, doc)).toBeNull();
    expect(fromOveSelection({ end: 5 }, doc)).toBeNull();
    expect(fromOveSelection({}, doc)).toBeNull();
  });

  it("returns null for non-finite coordinates", () => {
    const doc = makeDoc();
    expect(fromOveSelection({ start: Infinity, end: 5 }, doc)).toBeNull();
    expect(fromOveSelection({ start: 0, end: NaN }, doc)).toBeNull();
  });

  it("returns null for non-integer coordinates", () => {
    const doc = makeDoc();
    expect(fromOveSelection({ start: 1.5, end: 5 }, doc)).toBeNull();
  });

  it("returns null for negative start", () => {
    const doc = makeDoc();
    expect(fromOveSelection({ start: -1, end: 5 }, doc)).toBeNull();
  });

  it("returns null when end is beyond sequence length", () => {
    const doc = makeDoc({ sequence: "ATCG" }); // length 4
    // OVE end 3 is valid (inclusive, maps to canonical 4)
    expect(fromOveSelection({ start: 0, end: 3 }, doc)).not.toBeNull();
    // OVE end 4 is out of range
    expect(fromOveSelection({ start: 0, end: 4 }, doc)).toBeNull();
  });

  it("returns null for empty sequence", () => {
    const doc = makeDoc({ sequence: "" });
    expect(fromOveSelection({ start: 0, end: 0 }, doc)).toBeNull();
  });
});

describe("fromOveSelection circular origin wrap", () => {
  it("wraps origin when start > end on a circular document", () => {
    const doc = makeDoc({
      sequence: "ATCGATCGATCGATCG", // 16 bp
      circular: true,
    });
    // OVE [12, 3] on 16-bp circular: bases 12..15 then 0..3
    // canonical [12, 4) wrapping, length = 4 + 4 = 8
    const sel = fromOveSelection({ start: 12, end: 3 }, doc);
    expect(sel).not.toBeNull();
    expect(sel!.start).toBe(12);
    expect(sel!.end).toBe(4); // oveEnd + 1 = 4
    expect(sel!.length).toBe(8); // (16-12) + (3+1) = 4 + 4
    expect(sel!.wrapsOrigin).toBe(true);
    expect(sel!.sequence).toBe("ATCGATCG"); // ATCG (tail) + ATCG (head)
  });

  it("does not wrap on linear document even if start > end", () => {
    const doc = makeDoc({
      sequence: "ATCGATCGATCGATCG", // 16 bp
      circular: false,
    });
    // start > end on linear: this is an inverted/invalid range from OVE.
    // Without circular, we treat it as a normal non-wrapping selection.
    // But canonical end = oveEnd+1 = 4, start = 12, so start > end -> invalid.
    // The function should return null since canonicalEnd (4) <= oveStart (12)
    // is not caught, but start > endInclusive and not circular goes to
    // the normal branch where canonicalEnd=4 < start=12.
    // Actually: oveStart(12) > oveEndInclusive(3) and NOT circular ->
    // falls through to normal branch. canonicalEnd = 4. 4 < seqLen(16) so
    // it would pass the range check. start=12, end=4, length=-8.
    // That's wrong. We should return null for non-circular inverted.
    const sel = fromOveSelection({ start: 12, end: 3 }, doc);
    // For a linear document, start > end is not a valid wrap.
    // The function should return null.
    expect(sel).toBeNull();
  });

  it("handles wrap with large tail and small head", () => {
    // 20-bp circular: wrap from position 18 to position 1
    const doc = makeDoc({
      sequence: "ABCDEFGHIJKLMNOPQRST", // 20 bp
      circular: true,
    });
    // OVE [18, 1]: tail = positions 18,19 ("ST"), head = positions 0,1 ("AB")
    const sel = fromOveSelection({ start: 18, end: 1 }, doc);
    expect(sel).not.toBeNull();
    expect(sel!.start).toBe(18);
    expect(sel!.end).toBe(2); // oveEnd+1
    expect(sel!.length).toBe(4); // (20-18) + (1+1) = 2 + 2
    expect(sel!.wrapsOrigin).toBe(true);
    expect(sel!.sequence).toBe("STAB");
  });

  it("wraps entire origin when start=1, end=0 on circular", () => {
    const doc = makeDoc({
      sequence: "ATCG", // 4 bp
      circular: true,
    });
    // OVE [1, 0]: tail = positions 1,2,3 ("TCG"), head = position 0 ("A")
    const sel = fromOveSelection({ start: 1, end: 0 }, doc);
    expect(sel).not.toBeNull();
    expect(sel!.length).toBe(4); // (4-1) + (0+1) = 3 + 1 = 4
    expect(sel!.wrapsOrigin).toBe(true);
    expect(sel!.sequence).toBe("TCGA");
  });
});

describe("fromFeatureSelection", () => {
  const feature: SequenceFeature = {
    id: "feature-1",
    name: "Primer F",
    type: "primer_bind",
    start: 2,
    end: 6,
    strand: 1,
    qualifiers: {},
  };

  it("converts an annotation to an exact canonical selection", () => {
    const doc = makeDoc({ sequence: "AACCGGTT" });
    expect(fromFeatureSelection(feature, doc)).toEqual({
      start: 2,
      end: 6,
      length: 4,
      wrapsOrigin: false,
      sequence: "CCGG",
    });
  });

  it("rejects empty and out-of-range annotations", () => {
    const doc = makeDoc({ sequence: "AACCGGTT" });
    expect(fromFeatureSelection({ ...feature, end: 2 }, doc)).toBeNull();
    expect(fromFeatureSelection({ ...feature, end: 20 }, doc)).toBeNull();
  });

  it("returns null for an empty document", () => {
    expect(fromFeatureSelection(feature, makeDoc({ sequence: "" }))).toBeNull();
  });

  // A-BIO-004: an origin-spanning feature (start > end) becomes a wrapping
  // selection with the tail + head bases concatenated.
  it("converts an origin-spanning feature to a wrapping selection", () => {
    const doc = makeDoc({ sequence: "A".repeat(100), circular: true });
    const wrapFeature: SequenceFeature = {
      id: "wrap",
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
    };
    const sel = fromFeatureSelection(wrapFeature, doc);
    expect(sel).not.toBeNull();
    expect(sel!.start).toBe(90);
    expect(sel!.end).toBe(10);
    expect(sel!.length).toBe(20);
    expect(sel!.wrapsOrigin).toBe(true);
    expect(sel!.sequence).toBe("A".repeat(20));
  });

  it("derives segments from start/end when a wrap feature has none", () => {
    const doc = makeDoc({ sequence: "A".repeat(100), circular: true });
    const wrapFeature: SequenceFeature = {
      id: "wrap2",
      name: "wrapGene",
      type: "gene",
      start: 90,
      end: 10,
      strand: 1,
      qualifiers: {},
    };
    const sel = fromFeatureSelection(wrapFeature, doc);
    expect(sel).not.toBeNull();
    expect(sel!.length).toBe(20);
    expect(sel!.wrapsOrigin).toBe(true);
    expect(sel!.sequence).toBe("A".repeat(20));
  });
});
