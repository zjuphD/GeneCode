/**
 * OVE editor adapter.
 *
 * Converts canonical SequenceDocument data into OVE's data format and back.
 *
 * Coordinate convention:
 *   Canonical: zero-based half-open [start, end)
 *   OVE:       zero-based inclusive [start, end]
 *
 * Forward: OVE end = canonical end - 1
 * Reverse: canonical end = OVE end + 1
 */

import type { SequenceDocument, SequenceFeature } from "../types";
import type { OveSequenceData, OveFeature } from "@teselagen/ove";
import {
  isWrappingFeature,
  segmentsFromInclusive,
} from "./featureSegments";

/**
 * OVE's default electric-blue fallback colors.
 * Features using these (or having no color) are eligible for remapping.
 */
const OVE_FALLBACK_COLORS = new Set(["#0b17bd", "#006fef"]);

/**
 * Restrained scientific palette inspired by GenePad's daytime aesthetic.
 * Each color retains readable white OVE labels.
 * Order matters: source/backbone features hash to medium blue (index 2).
 */
const DISPLAY_PALETTE = [
  "#5e8c6a", // sage green
  "#c17c3e", // muted orange
  "#4a7fb5", // medium blue — source/backbone default
  "#3d8b8b", // teal
  "#7a68a0", // muted violet
  "#b05a5a", // muted red
] as const;

/**
 * Determine whether a feature color is an OVE fallback default eligible
 * for display-color remapping.
 */
export function isOveFallbackColor(color: string | undefined): boolean {
  if (!color) return true;
  return OVE_FALLBACK_COLORS.has(color.toLowerCase());
}

/**
 * Deterministic string hash with strong avalanche mixing.
 * Uses FNV-1a as a base, then applies a three-pass murmur-style avalanche
 * so that similar prefixes (e.g. multiple `misc_feature::` entries) produce
 * well-spread palette indices instead of clustering.
 */
function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h >>>= 0;
  // Murmur3-style finalizer — three mixing rounds.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Reserved blue for source/backbone features (infrastructure, not biological).
 */
const SOURCE_BACKBONE_COLOR = "#4a7fb5";

/**
 * Resolve a deterministic display color for a feature.
 *
 * - Explicit user/file colors that are not OVE fallbacks are returned unchanged.
 * - Source/backbone features always get a muted medium blue.
 * - All other fallback-eligible features are mapped into the palette via a
 *   deterministic hash of type+name, so the same identity always receives the
 *   same color (stable across circular/linear views and across renders).
 */
export function resolveDisplayColor(feature: SequenceFeature): string {
  if (!isOveFallbackColor(feature.color)) {
    return feature.color!;
  }

  if (feature.type === "source" || feature.type === "rep_origin") {
    return SOURCE_BACKBONE_COLOR;
  }

  const key = `${feature.type}::${feature.name}`;
  const index = hashString(key) % DISPLAY_PALETTE.length;
  return DISPLAY_PALETTE[index]!;
}

/**
 * Convert a canonical SequenceDocument to OVE's SequenceData format.
 * When viewMode is "linear", forces circular=false so OVE renders linearly.
 */
export function toOveData(doc: SequenceDocument, viewMode?: "circular" | "linear"): OveSequenceData {
  return {
    name: doc.name,
    sequence: doc.sequence,
    circular: viewMode === "linear" ? false : doc.circular,
    features: doc.features.map(toOveFeature),
  };
}

/**
 * Convert a canonical SequenceFeature to OVE's feature format.
 * Maps [start, end) -> [start, end-1] for OVE's inclusive convention.
 *
 * A-BIO-004: an origin-spanning feature keeps start > end (OVE's native
 * "spans origin" convention, `doesRangeSpanOrigin`) and its explicit segments
 * are forwarded as `locations` so the engine draws each piece as its own arc.
 */
export function toOveFeature(feature: SequenceFeature): OveFeature {
  const oveFeature: OveFeature = {
    id: feature.id,
    name: feature.name,
    type: feature.type,
    start: feature.start,
    // Canonical end is exclusive; OVE end is inclusive -> subtract 1.
    end: feature.end - 1,
    strand: feature.strand,
    forward: feature.strand === 1,
    notes: feature.qualifiers,
    color: resolveDisplayColor(feature),
  };
  if (feature.segments && feature.segments.length > 0) {
    oveFeature.locations = feature.segments.map((segment) => ({
      start: segment.start,
      end: segment.end - 1,
    }));
  } else if (isWrappingFeature(feature)) {
    // Defensive: a wrap feature that lost its segments is still expressed as
    // a joined location so the engine renders both arcs.
    oveFeature.locations = [
      { start: feature.start, end: feature.end - 1 },
    ];
  }
  return oveFeature;
}

/**
 * Convert an OVE inclusive end back to canonical exclusive end.
 * Useful for round-tripping data from OVE back into the canonical model.
 */
export function oveEndToCanonicalEnd(oveEnd: number): number {
  return oveEnd + 1;
}

/**
 * Validation error produced during OVE-to-canonical conversion.
 */
export interface ConversionError {
  readonly message: string;
}

/**
 * Result of an OVE-to-canonical conversion.
 * On success, `doc` is set. On failure, `errors` contains at least one error.
 */
export type ConversionResult =
  | { ok: true; doc: SequenceDocument }
  | { ok: false; errors: readonly ConversionError[] };

function getOveFeatures(features: unknown): OveFeature[] {
  if (Array.isArray(features)) return features as OveFeature[];
  if (features && typeof features === "object") {
    return Object.values(features as Record<string, OveFeature>);
  }
  return [];
}

/**
 * Validate a single OVE feature and convert to canonical form.
 * Returns the canonical feature or an error message.
 *
 * When `originalFeature` is provided, compares the OVE-returned color with the
 * derived display color. If they match (user didn't change the color in OVE),
 * the original canonical color is preserved rather than persisting the display
 * fallback. A genuinely changed OVE color is kept.
 */
function validateAndConvertFeature(
  f: OveFeature,
  index: number,
  sequenceLength: number,
  originalFeature?: SequenceFeature,
  circular = false,
): SequenceFeature | string {
  if (!Number.isFinite(f.start) || !Number.isFinite(f.end)) {
    return `Feature "${f.name ?? index}": start and end must be finite numbers`;
  }
  if (!Number.isInteger(f.start) || !Number.isInteger(f.end)) {
    return `Feature "${f.name ?? index}": start and end must be integers`;
  }
  if (f.start < 0) {
    return `Feature "${f.name ?? index}": start ${f.start} is negative`;
  }
  // A-BIO-004: OVE expresses an origin-spanning feature as start > end (its
  // native spans-origin convention, only meaningful on circular molecules).
  const wraps = f.end < f.start;
  if (wraps && !circular) {
    return `Feature "${f.name ?? index}": end ${f.end} is before start ${f.start} on a linear sequence`;
  }
  if (f.start >= sequenceLength) {
    return `Feature "${f.name ?? index}": start ${f.start} >= sequence length ${sequenceLength}`;
  }
  if (f.end >= sequenceLength) {
    return `Feature "${f.name ?? index}": inclusive end ${f.end} >= sequence length ${sequenceLength}`;
  }

  // Determine the canonical color: if the OVE-returned color matches the
  // display fallback we would have sent, the user didn't change it, so
  // preserve the original canonical color. Otherwise keep the new color.
  let color: string | undefined = f.color;
  if (originalFeature) {
    const displayColor = resolveDisplayColor(originalFeature);
    if (
      f.color &&
      f.color.toLowerCase() === displayColor.toLowerCase()
    ) {
      // Color unchanged from our display fallback — preserve original.
      color = originalFeature.color;
    }
    // else: user explicitly changed the color in OVE — keep the new value.
  }

  // A-BIO-004: explicit join pieces from the engine (zero-based inclusive)
  // become canonical segments; start/end are rebuilt from their bounding box.
  const explicitSegments = segmentsFromInclusive(f.locations ?? [], sequenceLength);
  const canonicalStart = explicitSegments
    ? explicitSegments[0]!.start
    : f.start;
  const canonicalEnd = explicitSegments
    ? explicitSegments[explicitSegments.length - 1]!.end
    : f.end + 1;
  const segments =
    explicitSegments ??
    (wraps
      ? [{ start: f.start, end: sequenceLength }, { start: 0, end: f.end + 1 }]
      : undefined);

  return {
    id: f.id || `feature-${index}`,
    name: f.name || `feature_${index}`,
    type: f.type || "misc_feature",
    start: canonicalStart,
    end: canonicalEnd,
    // OVE may represent orientation with `forward` (boolean) or `strand`
    // (numeric). Reverse when either representation says reverse.
    strand: f.strand === -1 || f.forward === false ? -1 : 1,
    qualifiers: f.notes ?? {},
    color,
    ...(segments ? { segments } : {}),
  };
}

/**
 * Convert OVE sequence data back to the canonical SequenceDocument model.
 *
 * Validates every feature coordinate. If any feature is invalid, returns
 * an error result without producing a partial document.
 *
 * Preserves accession and version from the original document when provided.
 */
export function fromOveData(
  oveData: OveSequenceData,
  original?: SequenceDocument,
): ConversionResult {
  const errors: ConversionError[] = [];

  if (!oveData.sequence || oveData.sequence.length === 0) {
    return { ok: false, errors: [{ message: "Sequence is empty" }] };
  }

  const sequenceLength = oveData.sequence.length;

  const originalById = new Map<string, SequenceFeature>();
  if (original) {
    for (const of_ of original.features) {
      originalById.set(of_.id, of_);
    }
  }

  const oveFeatures = getOveFeatures(oveData.features);
  const features: SequenceFeature[] = [];
  const circular = oveData.circular;
  for (let i = 0; i < oveFeatures.length; i++) {
    const f = oveFeatures[i]!;
    const origFeature = f.id ? originalById.get(f.id) : undefined;
    const result = validateAndConvertFeature(f, i, sequenceLength, origFeature, circular);
    if (typeof result === "string") {
      errors.push({ message: result });
    } else {
      features.push(result);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    doc: {
      name: oveData.name,
      sequence: oveData.sequence.toUpperCase(),
      circular: oveData.circular,
      features,
      accession: original?.accession,
      version: original?.version,
    },
  };
}

/** Minimum dimension to avoid zero-size OVE rendering. */
const MIN_MAP_SIZE = 100;

/**
 * Normalize raw width/height to valid OVE dimensions.
 * Clamps to minimum and floors to integers.
 */
export function normalizeMapSize(
  width: number,
  height: number,
): { width: number; height: number } {
  return {
    width: Math.max(MIN_MAP_SIZE, Math.floor(width)),
    height: Math.max(MIN_MAP_SIZE, Math.floor(height)),
  };
}
