import { describe, it, expect } from "vitest";
import { buildPatchDiffMarkers } from "./patchDiffMarkers";
import type { PatchPreview } from "./patchTypes";

function makePreview(overrides: Partial<PatchPreview> = {}): PatchPreview {
  return {
    patchId: "p1",
    title: "Test",
    summary: "test",
    baseHash: "h1",
    proposedHash: "h2",
    beforeLength: 100,
    afterLength: 104,
    operations: [],
    affectedFeatures: [],
    warnings: [],
    errors: [],
    proposedDocument: null,
    ...overrides,
  };
}

describe("buildPatchDiffMarkers", () => {
  it("maps an insert to a zero-width marker anchored at its position", () => {
    const markers = buildPatchDiffMarkers(makePreview({
      beforeLength: 100,
      operations: [{
        operationId: "op1",
        kind: "insert",
        coordinates: "@50",
        reason: "add MCS",
        lengthDelta: 4,
        position: 50,
      }],
    }));
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      id: "op1",
      kind: "insert",
      start: 50,
      end: 50,
      label: "插入 +4 bp",
      reason: "add MCS",
      lengthDelta: 4,
    });
  });

  it("maps delete/replace to their ranges with length-aware labels", () => {
    const markers = buildPatchDiffMarkers(makePreview({
      beforeLength: 100,
      operations: [
        {
          operationId: "d1",
          kind: "delete",
          coordinates: "[10, 20)",
          reason: "remove linker",
          lengthDelta: -10,
          start: 10,
          end: 20,
        },
        {
          operationId: "r1",
          kind: "replace",
          coordinates: "[30, 35)",
          reason: "swap codon",
          lengthDelta: 2,
          start: 30,
          end: 35,
        },
      ],
    }));
    expect(markers).toHaveLength(2);
    expect(markers[0]).toMatchObject({ start: 10, end: 20, label: "删除 10 bp" });
    expect(markers[1]).toMatchObject({ start: 30, end: 35, label: "替换 +2 bp" });
  });

  it("labels add/remove feature with the feature name", () => {
    const markers = buildPatchDiffMarkers(makePreview({
      beforeLength: 100,
      operations: [
        {
          operationId: "a1",
          kind: "add_feature",
          coordinates: "[40, 60)",
          reason: "mark CDS",
          lengthDelta: 0,
          start: 40,
          end: 60,
          featureName: "GFP",
        },
        {
          operationId: "rm1",
          kind: "remove_feature",
          coordinates: "f1",
          reason: "cleanup",
          lengthDelta: 0,
          start: 5,
          end: 8,
          featureName: "old tag",
        },
      ],
    }));
    expect(markers).toHaveLength(2);
    expect(markers[0]!.label).toBe("新增特征「GFP」");
    expect(markers[1]!.label).toBe("移除特征「old tag」");
  });

  it("clamps ranges to the before-length boundary", () => {
    const markers = buildPatchDiffMarkers(makePreview({
      beforeLength: 100,
      operations: [{
        operationId: "e1",
        kind: "replace",
        coordinates: "[95, 120)",
        reason: "extend tail",
        lengthDelta: 5,
        start: 95,
        end: 120,
      }],
    }));
    expect(markers).toHaveLength(1);
    expect(markers[0]!.start).toBe(95);
    expect(markers[0]!.end).toBe(100);
  });

  it("carries before/after sequences for the hover tooltip comparison", () => {
    const markers = buildPatchDiffMarkers(makePreview({
      beforeLength: 100,
      operations: [
        {
          operationId: "i1",
          kind: "insert",
          coordinates: "@50",
          reason: "add MCS",
          lengthDelta: 4,
          position: 50,
          afterSequence: "GGATCC",
        },
        {
          operationId: "d1",
          kind: "delete",
          coordinates: "[10, 20)",
          reason: "remove linker",
          lengthDelta: -10,
          start: 10,
          end: 20,
          beforeSequence: "GATCGATCGAT",
        },
        {
          operationId: "r1",
          kind: "replace",
          coordinates: "[30, 35)",
          reason: "swap codon",
          lengthDelta: 2,
          start: 30,
          end: 35,
          beforeSequence: "ATGCC",
          afterSequence: "GGATCC",
        },
      ],
    }));
    expect(markers).toHaveLength(3);
    expect(markers[0]).toMatchObject({ beforeSequence: undefined, afterSequence: "GGATCC" });
    expect(markers[1]).toMatchObject({ beforeSequence: "GATCGATCGAT", afterSequence: undefined });
    expect(markers[2]).toMatchObject({ beforeSequence: "ATGCC", afterSequence: "GGATCC" });
  });

  it("skips rows without resolvable geometry (e.g. unknown feature id)", () => {
    const markers = buildPatchDiffMarkers(makePreview({
      beforeLength: 100,
      operations: [{
        operationId: "x1",
        kind: "remove_feature",
        coordinates: "missing",
        reason: "cleanup",
        lengthDelta: 0,
      }],
    }));
    expect(markers).toHaveLength(0);
  });

  it("returns no markers for an operation-less preview", () => {
    expect(buildPatchDiffMarkers(makePreview())).toEqual([]);
  });
});
