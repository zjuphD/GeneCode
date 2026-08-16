/**
 * sequenceDiff — pure sequence diff for the sandbox comparison view.
 *
 * Computes a character-level diff between two documents (original vs Agent
 * copy) and produces:
 * - aligned segments (equal / insert / delete / replace)
 * - display rows that pair left (original) and right (copy) chunks so the
 *   SandboxDiffDialog can render them side by side with highlights.
 *
 * Pure and serializable — no React, no DOM.
 */

export type DiffSegment =
  | { type: "equal"; text: string }
  | { type: "insert"; text: string }
  | { type: "delete"; text: string }
  | { type: "replace"; before: string; after: string };

export interface SequenceDiff {
  segments: DiffSegment[];
  beforeLength: number;
  afterLength: number;
  changedRegions: number;
  insertedBp: number;
  deletedBp: number;
}

export type DiffRowKind = "equal" | "insert" | "delete" | "before" | "after";

export interface DiffRow {
  left?: { text: string; kind: DiffRowKind };
  right?: { text: string; kind: DiffRowKind };
}

const CHUNK_SIZE = 80;

function chunk(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

/**
 * Myers O(ND) diff with full trace. Small D in practice (the copy differs from
 * the original in a handful of regions), so trace memory is bounded. Falls back
 * to a single replace segment when the edit distance explodes (unrelated
 * sequences), keeping memory predictable.
 */
export function diffSequences(before: string, after: string): SequenceDiff {
  const n = before.length;
  const m = after.length;
  const segments: DiffSegment[] = [];

  if (n === 0 && m === 0) {
    return { segments, beforeLength: 0, afterLength: 0, changedRegions: 0, insertedBp: 0, deletedBp: 0 };
  }
  if (n === 0) {
    segments.push({ type: "insert", text: after });
    return summarize(segments);
  }
  if (m === 0) {
    segments.push({ type: "delete", text: before });
    return summarize(segments);
  }

  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  v[offset + 1] = 0;
  const trace: Int32Array[] = [];
  let d = 0;
  let found = false;

  for (d = 0; d <= max; d += 1) {
    trace.push(new Int32Array(v));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) {
        x = v[offset + k + 1]!;
      } else {
        x = v[offset + k - 1]! + 1;
      }
      let y = x - k;
      while (x < n && y < m && before[x] === after[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
    if (found) break;
  }

  if (!found) {
    // Fallback for pathological inputs: treat the whole region as replaced.
    segments.push({ type: "replace", before, after });
    return summarize(segments);
  }

  // Backtrack the trace into per-character edits (reversed order).
  // trace[depth] holds the V state *before* level `depth` was computed, so the
  // previous level's V values for the decision at level `depth` live there.
  let x = n;
  let y = m;
  const edits: Array<{ type: "equal" | "insert" | "delete"; text: string }> = [];
  for (let depth = trace.length - 1; depth > 0; depth -= 1) {
    const prev = trace[depth]!;
    const k = x - y;
    let prevK: number;
    if (k === -depth || (k !== depth && prev[offset + k - 1]! < prev[offset + k + 1]!)) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = prev[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      edits.push({ type: "equal", text: before[x - 1]! });
      x -= 1;
      y -= 1;
    }
    if (x === prevX) {
      edits.push({ type: "insert", text: after[y - 1]! });
      y -= 1;
    } else {
      edits.push({ type: "delete", text: before[x - 1]! });
      x -= 1;
    }
  }
  while (x > 0 && y > 0) {
    edits.push({ type: "equal", text: before[x - 1]! });
    x -= 1;
    y -= 1;
  }
  edits.reverse();

  // Merge per-character edits into segments; coalesce adjacent delete+insert
  // (either order) into a single replace segment for side-by-side rendering.
  // Consecutive non-equal edits accumulate into one pending region, so a
  // multi-character replace like CCC→GGG stays one region. Pure insert/delete
  // keep their own segment types.
  const merged: DiffSegment[] = [];
  let pending: { before: string; after: string } | null = null;
  const flush = () => {
    if (!pending) return;
    if (pending.before && pending.after) {
      merged.push({ type: "replace", before: pending.before, after: pending.after });
    } else if (pending.after) {
      merged.push({ type: "insert", text: pending.after });
    } else if (pending.before) {
      merged.push({ type: "delete", text: pending.before });
    }
    pending = null;
  };
  for (const edit of edits) {
    if (edit.type === "equal") {
      flush();
      const last = merged[merged.length - 1];
      if (last && last.type === "equal") {
        merged[merged.length - 1] = { type: "equal", text: last.text + edit.text };
      } else {
        merged.push({ type: "equal", text: edit.text });
      }
      continue;
    }
    // delete or insert: accumulate into the pending changed region.
    if (pending) {
      if (edit.type === "delete") pending.before += edit.text;
      else pending.after += edit.text;
    } else {
      pending = {
        before: edit.type === "delete" ? edit.text : "",
        after: edit.type === "insert" ? edit.text : "",
      };
    }
  }
  flush();

  return summarize(merged);
}

function summarize(segments: DiffSegment[]): SequenceDiff {
  let insertedBp = 0;
  let deletedBp = 0;
  let beforeLength = 0;
  let afterLength = 0;
  let changedRegions = 0;
  for (const segment of segments) {
    if (segment.type === "equal") {
      beforeLength += segment.text.length;
      afterLength += segment.text.length;
    } else if (segment.type === "insert") {
      insertedBp += segment.text.length;
      afterLength += segment.text.length;
    } else if (segment.type === "delete") {
      deletedBp += segment.text.length;
      beforeLength += segment.text.length;
    } else {
      insertedBp += segment.after.length;
      deletedBp += segment.before.length;
      beforeLength += segment.before.length;
      afterLength += segment.after.length;
    }
    if (segment.type !== "equal") changedRegions += 1;
  }
  return { segments, beforeLength, afterLength, changedRegions, insertedBp, deletedBp };
}

/**
 * Build display rows pairing left (original) and right (copy) chunks.
 * Equal segments produce matching rows on both sides; insert/delete/replace
 * segments produce rows on their own side with filler rows on the other so the
 * two columns stay visually aligned.
 */
export function buildDiffRows(diff: SequenceDiff): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const segment of diff.segments) {
    if (segment.type === "equal") {
      for (const text of chunk(segment.text, CHUNK_SIZE)) {
        rows.push({ left: { text, kind: "equal" }, right: { text, kind: "equal" } });
      }
      continue;
    }
    if (segment.type === "insert") {
      for (const text of chunk(segment.text, CHUNK_SIZE)) {
        rows.push({ right: { text, kind: "insert" } });
      }
      continue;
    }
    if (segment.type === "delete") {
      for (const text of chunk(segment.text, CHUNK_SIZE)) {
        rows.push({ left: { text, kind: "delete" } });
      }
      continue;
    }
    // replace: pair before/after chunks as before+after rows.
    const beforeChunks = chunk(segment.before, CHUNK_SIZE);
    const afterChunks = chunk(segment.after, CHUNK_SIZE);
    const rowCount = Math.max(beforeChunks.length, afterChunks.length, 1);
    for (let index = 0; index < rowCount; index += 1) {
      rows.push({
        left: beforeChunks[index] !== undefined
          ? { text: beforeChunks[index]!, kind: "before" }
          : undefined,
        right: afterChunks[index] !== undefined
          ? { text: afterChunks[index]!, kind: "after" }
          : undefined,
      });
    }
  }
  return rows;
}
