/**
 * Deterministic patch validation and application engine.
 *
 * Operations execute sequentially against a working clone.
 * Input documents and patch objects are never mutated.
 * All coordinates are zero-based half-open [start, end).
 */

import type { SequenceDocument, SequenceFeature } from "../types";
import type {
  SequencePatch,
  SequencePatchOperation,
  PatchValidationResult,
  PreviewFeatureRow,
} from "./patchTypes";
import { fingerprintDocument } from "./fingerprint";

// ── Runtime schema boundary ──────────────────────────────────
// Validates untrusted (e.g. LLM-produced) JSON safely — never throws.

const SUPPORTED_OP_KINDS = new Set([
  "insert",
  "delete",
  "replace",
  "add_feature",
  "remove_feature",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Result of parsing untrusted input.
 * On success: a fully normalized SequencePatch + the validation result.
 * On failure: errors only — no typed patch is produced.
 */
export type ParseResult =
  | { ok: true; patch: SequencePatch; result: PatchValidationResult }
  | { ok: false; errors: string[] };

/**
 * Parse and validate an untrusted patch object.
 * Returns either a fully normalized SequencePatch or errors.
 * Never throws for malformed input.
 */
export function parseAndValidatePatch(
  input: unknown,
  document: SequenceDocument,
): ParseResult {
  const errors: string[] = [];

  if (!isPlainObject(input)) {
    return { ok: false, errors: ["Patch must be a non-null object"] };
  }

  if (input.schemaVersion !== 1) {
    return { ok: false, errors: [`Unsupported schema version: ${String(input.schemaVersion)}`] };
  }

  if (!isNonEmptyString(input.id)) {
    errors.push("Patch id must be a non-empty string");
  }
  if (!isNonEmptyString(input.title)) {
    errors.push("Patch title must be a non-empty string");
  }
  if (!isNonEmptyString(input.summary)) {
    errors.push("Patch summary must be a non-empty string");
  }
  if (!isNonEmptyString(input.baseHash)) {
    errors.push("Patch baseHash must be a non-empty string");
  }

  if (!Array.isArray(input.operations) || input.operations.length === 0) {
    errors.push("Patch operations must be a non-empty array");
    return { ok: false, errors };
  }

  // Validate and normalize operations
  const normalizedOps: SequencePatchOperation[] = [];

  for (let i = 0; i < input.operations.length; i++) {
    const op = input.operations[i] as unknown;
    const prefix = `Operation ${i}`;

    if (!isPlainObject(op)) {
      errors.push(`${prefix}: must be a non-null object`);
      continue;
    }

    if (typeof op.kind !== "string") {
      errors.push(`${prefix}: kind must be a string`);
      continue;
    }

    if (!SUPPORTED_OP_KINDS.has(op.kind)) {
      errors.push(`${prefix}: unsupported operation kind "${op.kind}"`);
      continue;
    }

    if (!isNonEmptyString(op.id)) {
      errors.push(`${prefix}: id must be a non-empty string`);
    }
    if (!isNonEmptyString(op.reason)) {
      errors.push(`${prefix}: reason must be a non-empty string`);
    }

    switch (op.kind) {
      case "insert":
        if (typeof op.position !== "number" || !Number.isInteger(op.position)) {
          errors.push(`${prefix}: position must be an integer`);
        }
        if (typeof op.sequence !== "string" || op.sequence.length === 0) {
          errors.push(`${prefix}: sequence must be a non-empty string`);
        }
        if (errors.length === 0 || !errors.some((e) => e.startsWith(prefix))) {
          normalizedOps.push({
            kind: "insert",
            id: String(op.id),
            reason: String(op.reason),
            position: op.position as number,
            sequence: String(op.sequence),
          });
        }
        break;
      case "delete":
        if (typeof op.start !== "number" || !Number.isInteger(op.start)) {
          errors.push(`${prefix}: start must be an integer`);
        }
        if (typeof op.end !== "number" || !Number.isInteger(op.end)) {
          errors.push(`${prefix}: end must be an integer`);
        }
        if (typeof op.expectedSequence !== "string" || op.expectedSequence.length === 0) {
          errors.push(`${prefix}: expectedSequence must be a non-empty string`);
        }
        if (errors.length === 0 || !errors.some((e) => e.startsWith(prefix))) {
          normalizedOps.push({
            kind: "delete",
            id: String(op.id),
            reason: String(op.reason),
            start: op.start as number,
            end: op.end as number,
            expectedSequence: String(op.expectedSequence),
          });
        }
        break;
      case "replace":
        if (typeof op.start !== "number" || !Number.isInteger(op.start)) {
          errors.push(`${prefix}: start must be an integer`);
        }
        if (typeof op.end !== "number" || !Number.isInteger(op.end)) {
          errors.push(`${prefix}: end must be an integer`);
        }
        if (typeof op.expectedSequence !== "string" || op.expectedSequence.length === 0) {
          errors.push(`${prefix}: expectedSequence must be a non-empty string`);
        }
        if (typeof op.sequence !== "string" || op.sequence.length === 0) {
          errors.push(`${prefix}: replacement sequence must be a non-empty string`);
        }
        if (errors.length === 0 || !errors.some((e) => e.startsWith(prefix))) {
          normalizedOps.push({
            kind: "replace",
            id: String(op.id),
            reason: String(op.reason),
            start: op.start as number,
            end: op.end as number,
            expectedSequence: String(op.expectedSequence),
            sequence: String(op.sequence),
          });
        }
        break;
      case "add_feature": {
        if (!isPlainObject(op.feature)) {
          errors.push(`${prefix}: feature must be a non-null object`);
          break;
        }
        const f = op.feature;
        if (!isNonEmptyString(f.id)) {
          errors.push(`${prefix}: feature.id must be a non-empty string`);
        }
        if (!isNonEmptyString(f.name)) {
          errors.push(`${prefix}: feature.name must be a non-empty string`);
        }
        if (!isNonEmptyString(f.type)) {
          errors.push(`${prefix}: feature.type must be a non-empty string`);
        }
        if (typeof f.start !== "number" || !Number.isInteger(f.start)) {
          errors.push(`${prefix}: feature.start must be an integer`);
        }
        if (typeof f.end !== "number" || !Number.isInteger(f.end)) {
          errors.push(`${prefix}: feature.end must be an integer`);
        }
        if (f.strand !== 1 && f.strand !== -1) {
          errors.push(`${prefix}: feature.strand must be 1 or -1`);
        }
        // Normalize qualifiers: missing → {}, validate values are string[]
        let qualifiers: Record<string, string[]> = {};
        if (f.qualifiers !== undefined) {
          if (!isPlainObject(f.qualifiers)) {
            errors.push(`${prefix}: feature.qualifiers must be an object if present`);
          } else {
            for (const [key, val] of Object.entries(f.qualifiers)) {
              if (!Array.isArray(val) || !val.every((v: unknown) => typeof v === "string")) {
                errors.push(`${prefix}: feature.qualifiers.${key} must be an array of strings`);
              }
            }
            qualifiers = f.qualifiers as Record<string, string[]>;
          }
        }
        // Validate optional color
        if (f.color !== undefined && typeof f.color !== "string") {
          errors.push(`${prefix}: feature.color must be a string if present`);
        }
        if (errors.length === 0 || !errors.some((e) => e.startsWith(prefix))) {
          const feature: SequenceFeature = {
            id: String(f.id),
            name: String(f.name),
            type: String(f.type),
            start: f.start as number,
            end: f.end as number,
            strand: f.strand as 1 | -1,
            qualifiers,
          };
          if (typeof f.color === "string") {
            feature.color = f.color;
          }
          normalizedOps.push({
            kind: "add_feature",
            id: String(op.id),
            reason: String(op.reason),
            feature,
          });
        }
        break;
      }
      case "remove_feature":
        if (!isNonEmptyString(op.featureId)) {
          errors.push(`${prefix}: featureId must be a non-empty string`);
        }
        if (errors.length === 0 || !errors.some((e) => e.startsWith(prefix))) {
          normalizedOps.push({
            kind: "remove_feature",
            id: String(op.id),
            reason: String(op.reason),
            featureId: String(op.featureId),
          });
        }
        break;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // All structural checks passed — build normalized patch and validate semantically.
  const patch: SequencePatch = {
    schemaVersion: 1,
    id: String(input.id),
    title: String(input.title),
    summary: String(input.summary),
    baseHash: String(input.baseHash),
    operations: normalizedOps,
  };

  const result = validatePatch({ patch, document });
  return { ok: true, patch, result };
}

// ── IUPAC DNA validation ────────────────────────────────────

const IUPAC_RE = /^[ATGCRYSWKMBDHVN]+$/i;

function isIupacDna(s: string): boolean {
  return IUPAC_RE.test(s);
}

// ── Feature coordinate transform ────────────────────────────

interface TransformResult {
  features: SequenceFeature[];
  warnings: string[];
  affectedFeatures: PreviewFeatureRow[];
}

function transformFeaturesForInsert(
  features: SequenceFeature[],
  position: number,
  insertLen: number,
): TransformResult {
  const result: SequenceFeature[] = [];
  const warnings: string[] = [];
  const affected: PreviewFeatureRow[] = [];

  for (const f of features) {
    if (position <= f.start) {
      // Insertion before feature — shift right
      result.push({ ...f, start: f.start + insertLen, end: f.end + insertLen });
      affected.push({
        featureId: f.id,
        featureName: f.name,
        action: "transformed",
        detail: `shifted right by ${insertLen}bp (insertion before)`,
      });
    } else if (position < f.end) {
      // Insertion inside feature — expand end
      result.push({ ...f, end: f.end + insertLen });
      const warn = `Feature "${f.name}" expanded: insertion at position ${position} is inside [${f.start}, ${f.end})`;
      warnings.push(warn);
      affected.push({
        featureId: f.id,
        featureName: f.name,
        action: "transformed",
        detail: `expanded end by ${insertLen}bp (insertion inside)`,
      });
    } else {
      // Insertion after feature — no change
      result.push({ ...f });
    }
  }

  return { features: result, warnings, affectedFeatures: affected };
}

function transformFeaturesForDelete(
  features: SequenceFeature[],
  delStart: number,
  delEnd: number,
): TransformResult {
  const result: SequenceFeature[] = [];
  const warnings: string[] = [];
  const affected: PreviewFeatureRow[] = [];
  const delLen = delEnd - delStart;

  for (const f of features) {
    if (delEnd <= f.start) {
      // Deletion before feature — shift left
      result.push({ ...f, start: f.start - delLen, end: f.end - delLen });
      affected.push({
        featureId: f.id,
        featureName: f.name,
        action: "transformed",
        detail: `shifted left by ${delLen}bp (deletion before)`,
      });
    } else if (delStart >= f.end) {
      // Deletion after feature — no change
      result.push({ ...f });
    } else if (delStart <= f.start && delEnd >= f.end) {
      // Full deletion of feature — remove
      const warn = `Feature "${f.name}" removed: deletion [${delStart}, ${delEnd}) fully covers [${f.start}, ${f.end})`;
      warnings.push(warn);
      affected.push({
        featureId: f.id,
        featureName: f.name,
        action: "removed",
        detail: `fully covered by deletion [${delStart}, ${delEnd})`,
      });
    } else if (delStart <= f.start && delEnd < f.end) {
      // Partial overlap: deletion clips start
      // Surviving segment is [delEnd, f.end) in original coords → [delStart, f.end - delLen) after shift
      const removedFromStart = delEnd - f.start;
      result.push({ ...f, start: delStart, end: f.end - delLen });
      const warn = `Feature "${f.name}" clipped: deletion [${delStart}, ${delEnd}) overlaps start of [${f.start}, ${f.end})`;
      warnings.push(warn);
      affected.push({
        featureId: f.id,
        featureName: f.name,
        action: "transformed",
        detail: `start clipped by ${removedFromStart}bp`,
      });
    } else if (delStart > f.start && delEnd >= f.end) {
      // Partial overlap: deletion clips end
      const removedFromEnd = f.end - delStart;
      result.push({ ...f, end: f.end - removedFromEnd });
      const warn = `Feature "${f.name}" clipped: deletion [${delStart}, ${delEnd}) overlaps end of [${f.start}, ${f.end})`;
      warnings.push(warn);
      affected.push({
        featureId: f.id,
        featureName: f.name,
        action: "transformed",
        detail: `end clipped by ${removedFromEnd}bp`,
      });
    } else {
      // Deletion fully inside feature — shrink
      result.push({ ...f, end: f.end - delLen });
      affected.push({
        featureId: f.id,
        featureName: f.name,
        action: "transformed",
        detail: `shrunk by ${delLen}bp (deletion inside)`,
      });
    }
  }

  return { features: result, warnings, affectedFeatures: affected };
}

function transformFeaturesForReplace(
  features: SequenceFeature[],
  repStart: number,
  repEnd: number,
  newLen: number,
): TransformResult {
  // Replace = delete then insert at same position
  const delResult = transformFeaturesForDelete(features, repStart, repEnd);
  const insResult = transformFeaturesForInsert(
    delResult.features,
    repStart,
    newLen,
  );

  return {
    features: insResult.features,
    warnings: [...delResult.warnings, ...insResult.warnings],
    affectedFeatures: [...delResult.affectedFeatures, ...insResult.affectedFeatures],
  };
}

// ── Validation helpers ──────────────────────────────────────

function collectOpIds(operations: SequencePatchOperation[]): {
  ids: Set<string>;
  duplicates: string[];
} {
  const ids = new Set<string>();
  const duplicates: string[] = [];
  for (const op of operations) {
    if (ids.has(op.id)) {
      duplicates.push(op.id);
    }
    ids.add(op.id);
  }
  return { ids, duplicates };
}

// ── Core: validate and apply ────────────────────────────────

function applyOperations(
  doc: SequenceDocument,
  operations: SequencePatchOperation[],
): PatchValidationResult {
  let sequence = doc.sequence;
  let features = [...doc.features];
  const allWarnings: string[] = [];
  const allAffected: PreviewFeatureRow[] = [];
  const errors: string[] = [];
  const addedFeatureIds = new Set<string>();
  const removedFeatureIds = new Set<string>();

  // Check duplicate operation IDs
  const { duplicates } = collectOpIds(operations);
  if (duplicates.length > 0) {
    return { ok: false, errors: [`Duplicate operation IDs: ${duplicates.join(", ")}`] };
  }

  for (const op of operations) {
    switch (op.kind) {
      case "insert": {
        if (!Number.isInteger(op.position) || op.position < 0 || op.position > sequence.length) {
          errors.push(`Op "${op.id}": position ${op.position} is out of range [0, ${sequence.length}]`);
          break;
        }
        if (!op.sequence || op.sequence.length === 0) {
          errors.push(`Op "${op.id}": insert sequence is empty`);
          break;
        }
        if (!isIupacDna(op.sequence)) {
          errors.push(`Op "${op.id}": insert sequence contains non-IUPAC characters`);
          break;
        }
        const upper = op.sequence.toUpperCase();
        const t = transformFeaturesForInsert(features, op.position, upper.length);
        sequence = sequence.slice(0, op.position) + upper + sequence.slice(op.position);
        features = t.features;
        allWarnings.push(...t.warnings);
        allAffected.push(...t.affectedFeatures);
        break;
      }
      case "delete": {
        if (!Number.isInteger(op.start) || !Number.isInteger(op.end)) {
          errors.push(`Op "${op.id}": start and end must be integers`);
          break;
        }
        if (op.start < 0 || op.end > sequence.length || op.start >= op.end) {
          errors.push(`Op "${op.id}": invalid range [${op.start}, ${op.end}) for length ${sequence.length}`);
          break;
        }
        if (!op.expectedSequence) {
          errors.push(`Op "${op.id}": expectedSequence is required`);
          break;
        }
        const actual = sequence.slice(op.start, op.end);
        if (actual.toUpperCase() !== op.expectedSequence.toUpperCase()) {
          errors.push(`Op "${op.id}": expectedSequence mismatch at [${op.start}, ${op.end})`);
          break;
        }
        const t = transformFeaturesForDelete(features, op.start, op.end);
        sequence = sequence.slice(0, op.start) + sequence.slice(op.end);
        features = t.features;
        allWarnings.push(...t.warnings);
        allAffected.push(...t.affectedFeatures);
        break;
      }
      case "replace": {
        if (!Number.isInteger(op.start) || !Number.isInteger(op.end)) {
          errors.push(`Op "${op.id}": start and end must be integers`);
          break;
        }
        if (op.start < 0 || op.end > sequence.length || op.start >= op.end) {
          errors.push(`Op "${op.id}": invalid range [${op.start}, ${op.end}) for length ${sequence.length}`);
          break;
        }
        if (!op.expectedSequence) {
          errors.push(`Op "${op.id}": expectedSequence is required`);
          break;
        }
        if (!op.sequence || op.sequence.length === 0) {
          errors.push(`Op "${op.id}": replacement sequence is empty`);
          break;
        }
        if (!isIupacDna(op.sequence)) {
          errors.push(`Op "${op.id}": replacement sequence contains non-IUPAC characters`);
          break;
        }
        const actual = sequence.slice(op.start, op.end);
        if (actual.toUpperCase() !== op.expectedSequence.toUpperCase()) {
          errors.push(`Op "${op.id}": expectedSequence mismatch at [${op.start}, ${op.end})`);
          break;
        }
        const upper = op.sequence.toUpperCase();
        const t = transformFeaturesForReplace(features, op.start, op.end, upper.length);
        sequence = sequence.slice(0, op.start) + upper + sequence.slice(op.end);
        features = t.features;
        allWarnings.push(...t.warnings);
        allAffected.push(...t.affectedFeatures);
        break;
      }
      case "add_feature": {
        const f = op.feature;
        if (!f.id || !f.name || !f.type) {
          errors.push(`Op "${op.id}": feature must have id, name, and type`);
          break;
        }
        if (!Number.isInteger(f.start) || !Number.isInteger(f.end)) {
          errors.push(`Op "${op.id}": feature start and end must be integers`);
          break;
        }
        if (f.start < 0 || f.end > sequence.length || f.start >= f.end) {
          errors.push(`Op "${op.id}": feature range [${f.start}, ${f.end}) is invalid for length ${sequence.length}`);
          break;
        }
        if (f.strand !== 1 && f.strand !== -1) {
          errors.push(`Op "${op.id}": feature strand must be 1 or -1`);
          break;
        }
        if (addedFeatureIds.has(f.id)) {
          errors.push(`Op "${op.id}": duplicate added feature ID "${f.id}"`);
          break;
        }
        if (features.some((ef) => ef.id === f.id)) {
          errors.push(`Op "${op.id}": feature ID "${f.id}" already exists`);
          break;
        }
        addedFeatureIds.add(f.id);
        features = [...features, { ...f }];
        allAffected.push({
          featureId: f.id,
          featureName: f.name,
          action: "added",
          detail: "added",
        });
        break;
      }
      case "remove_feature": {
        if (!op.featureId) {
          errors.push(`Op "${op.id}": featureId is required`);
          break;
        }
        const idx = features.findIndex((f) => f.id === op.featureId);
        if (idx === -1) {
          errors.push(`Op "${op.id}": feature "${op.featureId}" not found`);
          break;
        }
        if (removedFeatureIds.has(op.featureId)) {
          errors.push(`Op "${op.id}": feature "${op.featureId}" already removed`);
          break;
        }
        removedFeatureIds.add(op.featureId);
        const removed = features[idx]!;
        features = features.filter((f) => f.id !== op.featureId);
        allAffected.push({
          featureId: removed.id,
          featureName: removed.name,
          action: "removed",
          detail: "removed by agent",
        });
        break;
      }
      default: {
        const _exhaustive: never = op;
        errors.push(`Op "${(_exhaustive as SequencePatchOperation).id}": unknown operation kind`);
      }
    }

    // Stop on first error — atomic
    if (errors.length > 0) break;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const proposed: SequenceDocument = {
    name: doc.name,
    sequence,
    circular: doc.circular,
    features,
    accession: doc.accession,
    version: doc.version,
  };

  return { ok: true, document: proposed, warnings: allWarnings, affectedFeatures: allAffected };
}

// ── Public API ──────────────────────────────────────────────

export interface ValidatePatchOptions {
  patch: SequencePatch;
  document: SequenceDocument;
}

/**
 * Validate a patch against a document without mutating either.
 * Returns the proposed document on success, or errors on failure.
 */
export function validatePatch({ patch, document }: ValidatePatchOptions): PatchValidationResult {
  // Schema version
  if (patch.schemaVersion !== 1) {
    return { ok: false, errors: [`Unsupported schema version: ${patch.schemaVersion}`] };
  }

  // Empty patch
  if (patch.operations.length === 0) {
    return { ok: false, errors: ["Patch contains no operations"] };
  }

  // Stale hash
  const currentHash = fingerprintDocument(document);
  if (patch.baseHash !== currentHash) {
    return { ok: false, errors: ["Patch baseHash does not match current document hash"] };
  }

  return applyOperations(document, patch.operations);
}

export interface ApplyPatchOptions {
  patch: SequencePatch;
  document: SequenceDocument;
}

/**
 * Validate and apply a patch. On success returns the new document.
 * On failure returns errors and no document.
 */
export function applyPatch({ patch, document }: ApplyPatchOptions): PatchValidationResult {
  return validatePatch({ patch, document });
}
