/**
 * Canonical sequence model for GeneCode.
 *
 * All coordinates are zero-based half-open intervals [start, end).
 * This is the internal representation; the OVE adapter converts to
 * OVE's zero-based inclusive convention.
 */

/** Topology of a DNA molecule. */
export type Topology = "circular" | "linear";

/** Strand orientation for a feature. */
export type Strand = 1 | -1;

/**
 * A contiguous sub-range of a feature. Zero-based half-open [start, end).
 */
export interface FeatureSegment {
  /** Zero-based half-open start position. */
  start: number;
  /** Zero-based half-open end position (exclusive). */
  end: number;
}

/**
 * A single annotation feature on a sequence.
 *
 * For a circular feature that crosses the sequence origin (A-BIO-004) the
 * canonical model expresses the location explicitly with `segments`:
 *   start = segments[0].start
 *   end   = segments[segments.length - 1].end   (may be < start → wraps origin)
 *   segments = [{ start, seqLen }, { 0, end }]
 * This mirrors SequenceSelection.wrapsOrigin. When `segments` is absent the
 * feature is a single contiguous [start, end) span with start <= end.
 */
export interface SequenceFeature {
  /** Stable unique identifier for this feature. */
  id: string;
  /** Display name (e.g. gene name, primer name). */
  name: string;
  /** Feature type (e.g. "gene", "CDS", "rep_origin"). */
  type: string;
  /** Zero-based half-open start position. */
  start: number;
  /** Zero-based half-open end position (exclusive). */
  end: number;
  /** Strand: 1 for forward, -1 for reverse. */
  strand: Strand;
  /** Key-value qualifiers from the source record. */
  qualifiers: Record<string, string[]>;
  /** Optional annotation color (hex). */
  color?: string;
  /**
   * Explicit sub-ranges in ascending document order (A-BIO-004). Present for
   * origin-spanning circular features (start > end); otherwise the feature is
   * one contiguous span. Derivable from start/end when absent.
   */
  segments?: FeatureSegment[];
}

/** A feature ready to be inserted into a document. */
export type SequenceFeatureInput = Omit<SequenceFeature, "id">;

/** A complete sequence document in the canonical model. */
export interface SequenceDocument {
  /** Display name of the sequence. */
  name: string;
  /** Nucleotide sequence string (A, T, G, C, N). */
  sequence: string;
  /** Whether the molecule is circular. */
  circular: boolean;
  /** Annotation features on this sequence. */
  features: SequenceFeature[];
  /** Optional accession identifier. */
  accession?: string;
  /** Optional version string. */
  version?: string;
}

/**
 * Canonical selection on a sequence.
 *
 * Coordinates are zero-based half-open [start, end).
 * A circular selection that crosses the origin has `start > end` and
 * `wrapsOrigin: true`.
 */
export interface SequenceSelection {
  /** Zero-based half-open start position. */
  start: number;
  /** Zero-based half-open end position (exclusive). */
  end: number;
  /** Number of selected bases. */
  length: number;
  /** True when the selection wraps past the sequence origin (circular only). */
  wrapsOrigin: boolean;
  /** The exact selected bases, concatenated tail+head when wrapping. */
  sequence: string;
  /** True when this is a zero-width insertion cursor rather than a base range. */
  cursor?: boolean;
}
