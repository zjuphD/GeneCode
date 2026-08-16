/**
 * patchDiffMarkers — map a PatchPreview's operations onto sequence coordinates
 * for diff visualization.
 *
 * Produces a small, serializable marker list consumed by two surfaces:
 * 1. The in-panel diff track inside PatchPreview (animated blocks).
 * 2. The OVE editor's "Proposed" track above the canvas (click to locate).
 *
 * All coordinates are zero-based half-open [start, end) on the *before*
 * document. Inserts are zero-width ranges anchored at their position.
 */

import type { PatchPreview } from "./patchTypes";

export type PatchDiffKind =
  | "insert"
  | "delete"
  | "replace"
  | "add_feature"
  | "remove_feature";

export interface PatchDiffMarker {
  id: string;
  kind: PatchDiffKind;
  /** Zero-based half-open range on the before document. */
  start: number;
  end: number;
  /** Human label shown on hover / in the legend. */
  label: string;
  /** Operation reason for the tooltip. */
  reason: string;
  /** Net length delta of this operation (bp). */
  lengthDelta: number;
  /**
   * Sequence detail for the hover tooltip's before→after comparison.
   * - insert: afterSequence carries the inserted bases.
   * - delete: beforeSequence carries the fragment that will be removed.
   * - replace: beforeSequence (old) and afterSequence (new).
   */
  beforeSequence?: string;
  afterSequence?: string;
}

const KIND_LABEL: Record<PatchDiffKind, string> = {
  insert: "插入",
  delete: "删除",
  replace: "替换",
  add_feature: "新增特征",
  remove_feature: "移除特征",
};

function markerLabel(marker: {
  kind: PatchDiffKind;
  featureName?: string;
  lengthDelta: number;
}): string {
  const base = KIND_LABEL[marker.kind];
  if (marker.kind === "insert") {
    return `${base} +${marker.lengthDelta} bp`;
  }
  if (marker.kind === "delete") {
    return `${base} ${-marker.lengthDelta} bp`;
  }
  if (marker.kind === "replace") {
    const delta = marker.lengthDelta;
    return delta === 0
      ? base
      : `${base} ${delta > 0 ? "+" : ""}${delta} bp`;
  }
  if (marker.kind === "add_feature" || marker.kind === "remove_feature") {
    return marker.featureName ? `${base}「${marker.featureName}」` : base;
  }
  return base;
}

function clampRange(start: number, end: number, length: number): { start: number; end: number } | null {
  const s = Math.max(0, Math.min(length, start));
  const e = Math.max(s, Math.min(length, end));
  if (e < s) return null;
  return { start: s, end: e };
}

/**
 * Build positioned diff markers from a patch preview.
 * Rows without resolvable geometry (e.g. remove_feature for an id that no
 * longer exists in the base document) are skipped.
 */
export function buildPatchDiffMarkers(preview: PatchPreview): PatchDiffMarker[] {
  const length = Math.max(0, preview.beforeLength);
  const markers: PatchDiffMarker[] = [];

  for (const row of preview.operations) {
    const start = row.kind === "insert" ? row.position : row.start;
    const end = row.kind === "insert" ? (row.position ?? 0) : row.end;

    if (typeof start !== "number" || typeof end !== "number") continue;

    const clamped = clampRange(start, end, length);
    if (!clamped) continue;

    const kind = row.kind as PatchDiffKind;
    markers.push({
      id: row.operationId,
      kind,
      start: clamped.start,
      end: clamped.end,
      label: markerLabel({ kind, featureName: row.featureName, lengthDelta: row.lengthDelta }),
      reason: row.reason,
      lengthDelta: row.lengthDelta,
      beforeSequence: row.beforeSequence,
      afterSequence: row.afterSequence,
    });
  }

  return markers;
}
