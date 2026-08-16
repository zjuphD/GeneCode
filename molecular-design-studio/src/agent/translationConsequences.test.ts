import { describe, it, expect } from "vitest";
import { analyzeReplaceTranslation } from "./translationConsequences";

describe("analyzeReplaceTranslation", () => {
  it("flags frameshift risk when the length change is not a multiple of 3", () => {
    const result = analyzeReplaceTranslation("ATGCCCGGG", "ATGCC");
    expect(result.frameshiftRisk).toBe(true);
    expect(result.lengthDelta).toBe(-4);
  });

  it("does not flag frameshift for in-frame length changes", () => {
    const result = analyzeReplaceTranslation("ATGCCC", "ATGGGG");
    expect(result.frameshiftRisk).toBe(false);
    expect(result.lengthDelta).toBe(0);
  });

  it("lists aligned codon changes with amino-acid consequences", () => {
    const result = analyzeReplaceTranslation("ATGCCC", "ATGGGG");
    expect(result.codonChanges).toEqual([
      {
        index: 2,
        before: "CCC",
        after: "GGG",
        beforeAa: "P",
        afterAa: "G",
      },
    ]);
    expect(result.beforeTranslation).toBe("MP");
    expect(result.afterTranslation).toBe("MG");
  });

  it("reports a silent (synonymous) substitution as no codon change", () => {
    // GCA and GCC both encode Alanine (A).
    const result = analyzeReplaceTranslation("ATGGCA", "ATGGCC");
    expect(result.codonChanges).toEqual([
      {
        index: 2,
        before: "GCA",
        after: "GCC",
        beforeAa: "A",
        afterAa: "A",
      },
    ]);
    expect(result.introducedStopIndex).toBeNull();
  });

  it("detects an introduced stop codon (CAA→TAA)", () => {
    const result = analyzeReplaceTranslation("ATGCAA", "ATGTAA");
    expect(result.introducedStopIndex).toBe(2);
    expect(result.introducedStop).toMatchObject({
      index: 2,
      before: "CAA",
      after: "TAA",
      beforeAa: "Q",
      afterAa: "*",
    });
  });

  it("does not report a stop that was already present", () => {
    const result = analyzeReplaceTranslation("ATGTAA", "ATGTAG");
    expect(result.introducedStopIndex).toBeNull();
  });

  it("detects a stop codon appended beyond the original region length", () => {
    // before has 1 codon (ATG); after appends TAA as a 2nd codon. The stop is
    // newly introduced even though no before-codon existed to compare with.
    const result = analyzeReplaceTranslation("ATG", "ATGTAA");
    expect(result.introducedStopIndex).toBe(2);
    expect(result.introducedStop).toMatchObject({
      index: 2,
      before: "—",
      after: "TAA",
      afterAa: "*",
    });
  });

  it("does not flag an appended non-stop codon as a stop or a change", () => {
    // The appended GGG codon is an addition, not a replacement of an existing
    // codon — no before-codon existed to compare with, so no codon change.
    const result = analyzeReplaceTranslation("ATG", "ATGGGG");
    expect(result.introducedStopIndex).toBeNull();
    expect(result.codonChanges).toEqual([]);
  });

  it("handles ambiguity-rich sequences by skipping codon detail", () => {
    const result = analyzeReplaceTranslation("ATNNNN", "ATGGGG");
    expect(result.codonChanges).toEqual([]);
    expect(result.introducedStopIndex).toBeNull();
  });

  it("returns empty consequence for empty sequences", () => {
    const result = analyzeReplaceTranslation("", "ATGGGG");
    expect(result.codonChanges).toEqual([]);
    expect(result.introducedStopIndex).toBeNull();
  });

  it("handles RNA input (U treated as T)", () => {
    const result = analyzeReplaceTranslation("AUGCCC", "AUGGGC");
    expect(result.codonChanges).toEqual([
      {
        index: 2,
        before: "CCC",
        after: "GGC",
        beforeAa: "P",
        afterAa: "G",
      },
    ]);
  });

  it("does not treat U-rich RNA as ambiguity-rich", () => {
    // U is a real RNA base: U-rich sequences must still translate.
    const result = analyzeReplaceTranslation("AUUGCC", "AUUGGU");
    expect(result.codonChanges.length).toBeGreaterThan(0);
    expect(result.codonChanges[0]).toMatchObject({ before: "GCC", after: "GGU" });
  });

  it("skips codon detail for genuinely ambiguous sequences", () => {
    const result = analyzeReplaceTranslation("ATNNNN", "ATGGGG");
    expect(result.codonChanges).toEqual([]);
    expect(result.introducedStopIndex).toBeNull();
  });
});
