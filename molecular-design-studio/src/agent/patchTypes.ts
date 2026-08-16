/**
 * Discriminated-union patch schema for Agent sequence changes.
 *
 * All coordinates are zero-based half-open [start, end).
 * Every operation carries a stable id and a user-facing reason.
 */

import type { SequenceFeature } from "../types";

// ── Operations ──────────────────────────────────────────────

export interface InsertOperation {
  kind: "insert";
  id: string;
  reason: string;
  /** Zero-based position to insert before. */
  position: number;
  /** IUPAC DNA sequence to insert (will be uppercased). */
  sequence: string;
}

export interface DeleteOperation {
  kind: "delete";
  id: string;
  reason: string;
  /** Half-open [start, end) range to delete. */
  start: number;
  end: number;
  /** Expected sequence at [start, end), compared case-insensitively. */
  expectedSequence: string;
}

export interface ReplaceOperation {
  kind: "replace";
  id: string;
  reason: string;
  /** Half-open [start, end) range to replace. */
  start: number;
  end: number;
  /** Expected sequence at [start, end), compared case-insensitively. */
  expectedSequence: string;
  /** New IUPAC DNA sequence (will be uppercased). */
  sequence: string;
}

export interface AddFeatureOperation {
  kind: "add_feature";
  id: string;
  reason: string;
  /** Complete canonical feature to add. */
  feature: SequenceFeature;
}

export interface RemoveFeatureOperation {
  kind: "remove_feature";
  id: string;
  reason: string;
  /** ID of the existing feature to remove. */
  featureId: string;
}

export type SequencePatchOperation =
  | InsertOperation
  | DeleteOperation
  | ReplaceOperation
  | AddFeatureOperation
  | RemoveFeatureOperation;

// ── Patch ───────────────────────────────────────────────────

export interface SequencePatch {
  schemaVersion: 1;
  id: string;
  title: string;
  summary: string;
  /** Fingerprint of the document this patch targets. */
  baseHash: string;
  operations: SequencePatchOperation[];
}

// ── Preview ─────────────────────────────────────────────────

export interface PreviewOperationRow {
  operationId: string;
  kind: SequencePatchOperation["kind"];
  coordinates: string;
  reason: string;
  lengthDelta: number;
  /**
   * Numeric geometry for diff visualization (zero-based, on the *before*
   * document coordinate space). Optional because some operations may not
   * resolve to a range (e.g. removing an unknown feature id).
   * - insert: position marks the insertion point (zero-width range).
   * - delete / replace / add_feature / remove_feature: [start, end).
   */
  start?: number;
  end?: number;
  position?: number;
  /** Resolved feature name for add_feature / remove_feature rows. */
  featureName?: string;
  /** Resolved feature type for add_feature / remove_feature rows. */
  featureType?: string;
  /**
   * Sequence detail for the hover tooltip's before→after comparison.
   * - insert: afterSequence carries the inserted bases.
   * - delete: beforeSequence carries the fragment that will be removed.
   * - replace: beforeSequence (old) and afterSequence (new).
   * Feature operations carry no sequence (0-length on the sequence itself).
   */
  beforeSequence?: string;
  afterSequence?: string;
}

export interface PreviewFeatureRow {
  featureId: string;
  featureName: string;
  action: "transformed" | "removed" | "added";
  detail: string;
}

export interface PatchPreview {
  patchId: string;
  title: string;
  summary: string;
  baseHash: string;
  proposedHash: string | null;
  beforeLength: number;
  afterLength: number | null;
  operations: PreviewOperationRow[];
  affectedFeatures: PreviewFeatureRow[];
  warnings: string[];
  errors: string[];
  proposedDocument: import("../types").SequenceDocument | null;
}

// ── Validation result ───────────────────────────────────────

export type PatchValidationResult =
  | { ok: true; document: import("../types").SequenceDocument; warnings: string[]; affectedFeatures: PreviewFeatureRow[] }
  | { ok: false; errors: string[] };
