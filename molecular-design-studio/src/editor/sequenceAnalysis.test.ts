import { describe, expect, it } from "vitest";
import type { SequenceDocument } from "../types";
import {
  analyzeSequence,
  findCommonFeatureAnnotations,
  findOpenReadingFrames,
  reverseComplementDocument,
  scanRestrictionSites,
} from "./sequenceAnalysis";
import { reverseComplement } from "./sequenceActions";

function makeDoc(sequence: string): SequenceDocument {
  return { name: "test", sequence, circular: false, features: [] };
}

describe("sequence analysis", () => {
  it("calculates base composition and GC percentage", () => {
    expect(analyzeSequence("AATGCCN")).toEqual({
      length: 7,
      gcPercent: 50,
      counts: { A: 2, T: 1, G: 1, C: 2, other: 1 },
    });
  });

  it("summarizes supported restriction sites", () => {
    expect(scanRestrictionSites("AAAAGAATTCTTTGGATCC")).toMatchObject([
      { enzyme: "EcoRI", positions: [4] },
      { enzyme: "BamHI", positions: [13] },
    ]);
  });

  it("detects known features on both strands", () => {
    const direct = "TAATACGACTCACTATAGGG";
    const reverse = reverseComplement(direct);
    expect(findCommonFeatureAnnotations(makeDoc(`${direct}AAAA${reverse}`))).toMatchObject([
      { name: "T7 promoter", strand: 1, start: 0, end: 20 },
      { name: "T7 promoter", strand: -1, start: 24, end: 44 },
    ]);
  });

  it("finds six-frame ORFs above the requested length", () => {
    const doc = makeDoc(`ATG${"AAA".repeat(30)}TAA`);
    const found = findOpenReadingFrames(doc, 30);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ start: 0, end: 96, strand: 1, type: "CDS" });
    expect(found[0]?.qualifiers.translation?.[0]).toHaveLength(31);
  });

  it("reverse-complements sequence and feature coordinates", () => {
    const doc = makeDoc("ATGCCCAA");
    doc.features = [{ id: "f1", name: "feature", type: "misc", start: 1, end: 4, strand: 1, qualifiers: {} }];
    expect(reverseComplementDocument(doc)).toMatchObject({
      sequence: "TTGGGCAT",
      features: [{ start: 4, end: 7, strand: -1 }],
    });
  });
});
