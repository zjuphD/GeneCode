/**
 * Feature segment helpers (A-BIO-004).
 *
 * Canonical features express origin-spanning circular locations explicitly
 * with `segments` (start = first segment start, end = last segment end, so a
 * wrapping feature has start > end — mirroring SequenceSelection.wrapsOrigin).
 * These helpers are the single source of truth for deriving the effective
 * sub-ranges and length of a feature in either representation.
 */

import type { FeatureSegment, SequenceFeature } from "../types";

/**
 * True when the feature spans the circular origin (start > end).
 */
export function isWrappingFeature(feature: Pick<SequenceFeature, "start" | "end">): boolean {
  return feature.start > feature.end;
}

/**
 * Effective sub-ranges of a feature in ascending document order.
 *
 * - Explicit `segments` are returned as-is.
 * - A wrapping feature without explicit segments is normalized to the two
 *   canonical pieces [{start, seqLen}, {0, end}].
 * - Otherwise the feature is one contiguous [start, end) span.
 */
export function getFeatureSegments(
  feature: SequenceFeature,
  sequenceLength: number,
): FeatureSegment[] {
  if (feature.segments && feature.segments.length > 0) {
    return feature.segments;
  }
  if (isWrappingFeature(feature)) {
    return [
      { start: feature.start, end: sequenceLength },
      { start: 0, end: feature.end },
    ];
  }
  return [{ start: feature.start, end: feature.end }];
}

/**
 * Total covered length of a feature across all segments (sum of segment
 * lengths). For a wrapping feature this is (seqLen - start) + end.
 */
export function getFeatureLength(
  feature: SequenceFeature,
  sequenceLength: number,
): number {
  let total = 0;
  for (const segment of getFeatureSegments(feature, sequenceLength)) {
    if (segment.end > segment.start) {
      total += segment.end - segment.start;
    }
  }
  return total;
}

/**
 * Rebuild start/end from explicit segments so the invariant
 * `start === segments[0].start && end === segments[last].end` holds after a
 * segment remap. Returns a new feature; segments that become empty are
 * dropped, and a feature with no remaining segments returns null (caller
 * decides to drop it).
 */
export function featureFromSegments(
  feature: SequenceFeature,
  segments: FeatureSegment[],
  sequenceLength: number,
): SequenceFeature | null {
  const valid = segments.filter(
    (segment) =>
      Number.isInteger(segment.start) &&
      Number.isInteger(segment.end) &&
      segment.start >= 0 &&
      segment.end <= sequenceLength &&
      segment.end > segment.start,
  );
  if (valid.length === 0) {
    return null;
  }
  return {
    ...feature,
    start: valid[0]!.start,
    end: valid[valid.length - 1]!.end,
    segments: valid.length === 1 ? undefined : valid,
  };
}

/**
 * Canonical segments for a raw location list that follows OVE's zero-based
 * inclusive convention ([start, end] inclusive), e.g. from the engine or
 * bio-parsers. Converts each to the canonical half-open [start, end + 1).
 */
export function segmentsFromInclusive(
  locations: Array<{ start: number; end: number }>,
  sequenceLength: number,
): FeatureSegment[] | undefined {
  if (!locations || locations.length === 0) {
    return undefined;
  }
  const segments: FeatureSegment[] = [];
  for (const location of locations) {
    if (
      !Number.isInteger(location.start) ||
      !Number.isInteger(location.end) ||
      location.start < 0 ||
      location.end >= sequenceLength ||
      location.end < location.start
    ) {
      return undefined;
    }
    segments.push({ start: location.start, end: location.end + 1 });
  }
  return segments.length > 1 ? segments : undefined;
}
