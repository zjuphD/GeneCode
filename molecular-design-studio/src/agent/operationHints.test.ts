import { describe, it, expect } from "vitest";
import { buildOperationHints, featureTypeLabel } from "./operationHints";
import type { PreviewOperationRow } from "./patchTypes";

function row(overrides: Partial<PreviewOperationRow>): PreviewOperationRow {
  return {
    operationId: "op1",
    kind: "insert",
    coordinates: "@0",
    reason: "test",
    lengthDelta: 0,
    ...overrides,
  } as PreviewOperationRow;
}

describe("buildOperationHints", () => {
  it("shows an ok GC badge for an insert with balanced GC", () => {
    const hints = buildOperationHints(row({
      kind: "insert",
      afterSequence: "ATGC",
      lengthDelta: 4,
    }));
    expect(hints).toHaveLength(1);
    expect(hints[0]!.tone).toBe("ok");
    expect(hints[0]!.label).toContain("插入 GC 50%");
    expect(hints[0]!.title).toContain("常用区间");
  });

  it("warns on extreme GC in an insert", () => {
    const hints = buildOperationHints(row({
      kind: "insert",
      afterSequence: "GCCC",
      lengthDelta: 4,
    }));
    expect(hints).toHaveLength(1);
    expect(hints[0]!.tone).toBe("warn");
    expect(hints[0]!.label).toContain("插入 GC 100%");
    expect(hints[0]!.title).toContain("超出常用区间");
  });

  it("shows before and after GC badges for a replace", () => {
    const hints = buildOperationHints(row({
      kind: "replace",
      beforeSequence: "ATGC",
      afterSequence: "GCCC",
      lengthDelta: 0,
    }));
    // Translation badges come first; GC badges follow.
    const gcHints = hints.filter((hint) => hint.id.endsWith("-gc"));
    expect(gcHints).toHaveLength(2);
    expect(gcHints[0]).toMatchObject({ id: "replace-before-gc", label: expect.stringContaining("替换前 GC") });
    expect(gcHints[1]).toMatchObject({ id: "replace-after-gc", tone: "warn" });
  });

  it("flags frameshift risk for a replace with non-multiple-of-3 length change", () => {
    const hints = buildOperationHints(row({
      kind: "replace",
      beforeSequence: "ATGCCCGGG",
      afterSequence: "ATGCC",
      lengthDelta: -4,
    }));
    const frameshift = hints.find((hint) => hint.id === "replace-frameshift");
    expect(frameshift).toBeDefined();
    expect(frameshift!.tone).toBe("warn");
    expect(frameshift!.label).toBe("移码风险");
  });

  it("shows a codon-change badge with the original→new codons for a replace", () => {
    const hints = buildOperationHints(row({
      kind: "replace",
      beforeSequence: "ATGCCC",
      afterSequence: "ATGGGG",
      lengthDelta: 0,
    }));
    const codons = hints.find((hint) => hint.id === "replace-codons");
    expect(codons).toBeDefined();
    expect(codons!.label).toBe("密码子 CCC→GGG");
    expect(codons!.title).toContain("CCC(P)");
    expect(codons!.title).toContain("GGG(G)");
  });

  it("flags an introduced stop codon in the replacement", () => {
    const hints = buildOperationHints(row({
      kind: "replace",
      beforeSequence: "ATGCAA",
      afterSequence: "ATGTAA",
      lengthDelta: 0,
    }));
    const stop = hints.find((hint) => hint.id === "replace-stop");
    expect(stop).toBeDefined();
    expect(stop!.tone).toBe("warn");
    expect(stop!.label).toBe("引入终止密码子");
    expect(stop!.title).toContain("CAA(Q)");
    expect(stop!.title).toContain("TAA(*)");
  });

  it("shows a GC badge for the deleted fragment", () => {
    const hints = buildOperationHints(row({
      kind: "delete",
      beforeSequence: "ATGC",
      lengthDelta: -4,
    }));
    expect(hints).toHaveLength(1);
    expect(hints[0]!.id).toBe("delete-gc");
    expect(hints[0]!.label).toContain("删除 GC 50%");
  });

  it("adds a feature-type info badge for add_feature", () => {
    const hints = buildOperationHints(row({
      kind: "add_feature",
      featureName: "GFP",
      featureType: "CDS",
      lengthDelta: 0,
    }));
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({ tone: "info", label: "新增 · CDS" });
    expect(hints[0]!.title).toContain("CDS");
  });

  it("adds a feature-type info badge for remove_feature", () => {
    const hints = buildOperationHints(row({
      kind: "remove_feature",
      featureName: "old tag",
      featureType: "misc_feature",
      lengthDelta: 0,
    }));
    expect(hints[0]).toMatchObject({ tone: "info", label: "移除 · 其他特征" });
  });

  it("returns no hints when sequence detail is missing", () => {
    expect(buildOperationHints(row({ kind: "insert" }))).toEqual([]);
    expect(buildOperationHints(row({ kind: "add_feature" }))).toEqual([]);
  });

  it("skips the GC badge for ambiguity-rich sequences instead of warning on Ns", () => {
    const hints = buildOperationHints(row({
      kind: "insert",
      afterSequence: "NNNNAT",
      lengthDelta: 6,
    }));
    // 4/6 non-ACGT (> 30%) — no misleading low-GC warning.
    expect(hints).toEqual([]);
  });

  it("humanizes known feature types and falls back to the raw type", () => {
    expect(featureTypeLabel("promoter")).toBe("启动子");
    expect(featureTypeLabel("rep_origin")).toBe("复制起点");
    expect(featureTypeLabel("custom_tag")).toBe("custom_tag");
  });
});
