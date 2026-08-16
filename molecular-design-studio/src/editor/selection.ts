/**
 * OVE selection-to-canonical conversion.
 *
 * OVE selection coordinates are zero-based inclusive [start, end].
 * Canonical coordinates are zero-based half-open [start, end).
 *
 * A caret event is represented by OVE as { start: -1, end: -1 }.
 * A valid one-base selection is { start: N, end: N } (inclusive).
 * This helper returns null for caret-only, missing, invalid, empty-document,
 * or out-of-range selections.
 */

import type {
  SequenceDocument,
  SequenceFeature,
  SequenceSelection,
} from "../types";
import {
  getFeatureSegments,
  isWrappingFeature,
} from "./featureSegments";

/**
 * Raw selection layer data from OVE's onSelectionOrCaretChanged callback.
 * Only the fields we consume are typed; the rest is unknown.
 */
export interface OveSelectionLayer {
  start?: number;
  end?: number;
  [key: string]: unknown;
}

/**
 * Convert a saved annotation into the same canonical selection shape used by
 * the editor and Agent context.
 *
 * A-BIO-004: an origin-spanning feature (start > end) becomes a wrapping
 * selection with the tail+head bases concatenated, matching
 * SequenceSelection.wrapsOrigin semantics.
 */
export function fromFeatureSelection(
  feature: SequenceFeature,
  doc: SequenceDocument,
): SequenceSelection | null {
  const sequenceLength = doc.sequence.length;
  if (sequenceLength === 0) return null;
  if (!Number.isInteger(feature.start) || !Number.isInteger(feature.end)) return null;
  if (feature.start < 0 || feature.end > sequenceLength) return null;

  if (isWrappingFeature(feature)) {
    if (feature.end < 0) return null;
    const segments = getFeatureSegments(feature, sequenceLength);
    const sequence = segments
      .map((segment) => doc.sequence.slice(segment.start, segment.end))
      .join("");
    return {
      start: feature.start,
      end: feature.end,
      length: sequence.length,
      wrapsOrigin: true,
      sequence,
    };
  }

  if (feature.end <= feature.start) return null;
  return {
    start: feature.start,
    end: feature.end,
    length: feature.end - feature.start,
    wrapsOrigin: false,
    sequence: doc.sequence.slice(feature.start, feature.end),
  };
}

/**
 * Convert a raw OVE selection layer into a canonical SequenceSelection.
 *
 * Returns null when:
 * - The selection layer is missing or has no start/end
 * - The selection is a caret event (start === -1 and end === -1)
 * - The document is empty
 * - Coordinates are out of range or invalid
 *
 * @param layer - The raw selection-layer object from OVE.
 * @param doc   - The current canonical document.
 */
export function fromOveSelection(
  layer: unknown,
  doc: SequenceDocument,
): SequenceSelection | null {
  if (!layer || typeof layer !== "object") return null;

  const raw = layer as OveSelectionLayer;
  if (typeof raw.start !== "number" || typeof raw.end !== "number") return null;
  if (!Number.isFinite(raw.start) || !Number.isFinite(raw.end)) return null;
  if (!Number.isInteger(raw.start) || !Number.isInteger(raw.end)) return null;

  const seqLen = doc.sequence.length;
  if (seqLen === 0) return null;

  // Caret event: OVE uses { start: -1, end: -1 } for caret-only
  if (raw.start === -1 && raw.end === -1) return null;

  // Validate bounds
  if (raw.start < 0 || raw.start >= seqLen) return null;
  if (raw.end < 0 || raw.end >= seqLen) return null;

  // OVE inclusive end -> canonical exclusive end
  const oveStart = raw.start;
  const oveEndInclusive = raw.end;

  // Inverted range (start > end) is only valid for circular origin wrap
  if (oveStart > oveEndInclusive && !doc.circular) return null;

  if (doc.circular && oveStart > oveEndInclusive) {
    // Circular origin wrap: selection crosses position zero.
    // OVE start=10, end=2 on a 100-bp sequence means bases 10..99 then 0..2
    // -> canonical [10, 102) wrapping, length = (seqLen - 10) + (2 + 1)
    const tailLen = seqLen - oveStart;
    const headLen = oveEndInclusive + 1;
    const length = tailLen + headLen;
    const tail = doc.sequence.slice(oveStart);
    const head = doc.sequence.slice(0, oveEndInclusive + 1);
    return {
      start: oveStart,
      end: oveEndInclusive + 1,
      length,
      wrapsOrigin: true,
      sequence: tail + head,
    };
  }

  // Normal (non-wrapping) selection
  const canonicalEnd = oveEndInclusive + 1;
  if (canonicalEnd > seqLen) return null;

  return {
    start: oveStart,
    end: canonicalEnd,
    length: canonicalEnd - oveStart,
    wrapsOrigin: false,
    sequence: doc.sequence.slice(oveStart, canonicalEnd),
  };
}
