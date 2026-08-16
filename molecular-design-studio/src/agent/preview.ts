/**
 * Preview model builder.
 *
 * Produces a serializable PatchPreview from a patch and its validation result.
 */

import type { SequenceDocument } from "../types";
import type {
  SequencePatch,
  PatchValidationResult,
  PatchPreview,
  PreviewOperationRow,
} from "./patchTypes";
import { fingerprintDocument } from "./fingerprint";

function opCoordinates(
  op: SequencePatch["operations"][number],
): string {
  switch (op.kind) {
    case "insert":
      return `@${op.position}`;
    case "delete":
      return `[${op.start}, ${op.end})`;
    case "replace":
      return `[${op.start}, ${op.end})`;
    case "add_feature":
      return `[${op.feature.start}, ${op.feature.end})`;
    case "remove_feature":
      return op.featureId;
  }
}

function opLengthDelta(
  op: SequencePatch["operations"][number],
): number {
  switch (op.kind) {
    case "insert":
      return op.sequence.length;
    case "delete":
      return -(op.end - op.start);
    case "replace":
      return op.sequence.length - (op.end - op.start);
    case "add_feature":
      return 0;
    case "remove_feature":
      return 0;
  }
}

/**
 * Numeric geometry and sequence detail for diff visualization, on the
 * *before* document coordinate space. remove_feature only carries an id, so
 * the range is resolved against the base document features here where the
 * document is available.
 *
 * beforeSequence / afterSequence feed the hover tooltip's before→after
 * comparison: insert → the inserted bases, delete → the removed fragment,
 * replace → old and new fragments. Feature ops carry no sequence.
 */
function opGeometry(
  op: SequencePatch["operations"][number],
  document: SequenceDocument,
): {
  start?: number;
  end?: number;
  position?: number;
  featureName?: string;
  featureType?: string;
  beforeSequence?: string;
  afterSequence?: string;
} {
  switch (op.kind) {
    case "insert":
      return { position: op.position, afterSequence: op.sequence };
    case "delete":
      return {
        start: op.start,
        end: op.end,
        beforeSequence: op.expectedSequence,
      };
    case "replace":
      return {
        start: op.start,
        end: op.end,
        beforeSequence: op.expectedSequence,
        afterSequence: op.sequence,
      };
    case "add_feature":
      return {
        start: op.feature.start,
        end: op.feature.end,
        featureName: op.feature.name,
        featureType: op.feature.type,
      };
    case "remove_feature": {
      const feature = document.features.find((f) => f.id === op.featureId);
      return feature
        ? {
            start: feature.start,
            end: feature.end,
            featureName: feature.name,
            featureType: feature.type,
          }
        : {};
    }
  }
}

/**
 * Build a preview from a patch and its validation result.
 */
export function buildPreview(
  patch: SequencePatch,
  document: SequenceDocument,
  result: PatchValidationResult,
): PatchPreview {
  const beforeLength = document.sequence.length;

  const operationRows: PreviewOperationRow[] = patch.operations.map((op) => {
    const geometry = opGeometry(op, document);
    return {
      operationId: op.id,
      kind: op.kind,
      coordinates: opCoordinates(op),
      reason: op.reason,
      lengthDelta: opLengthDelta(op),
      start: geometry.start,
      end: geometry.end,
      position: geometry.position,
      featureName: geometry.featureName,
      featureType: geometry.featureType,
      beforeSequence: geometry.beforeSequence,
      afterSequence: geometry.afterSequence,
    };
  });

  if (result.ok) {
    return {
      patchId: patch.id,
      title: patch.title,
      summary: patch.summary,
      baseHash: patch.baseHash,
      proposedHash: fingerprintDocument(result.document),
      beforeLength,
      afterLength: result.document.sequence.length,
      operations: operationRows,
      affectedFeatures: result.affectedFeatures,
      warnings: result.warnings,
      errors: [],
      proposedDocument: result.document,
    };
  }

  return {
    patchId: patch.id,
    title: patch.title,
    summary: patch.summary,
    baseHash: patch.baseHash,
    proposedHash: null,
    beforeLength,
    afterLength: null,
    operations: operationRows,
    affectedFeatures: [],
    warnings: [],
    errors: result.errors,
    proposedDocument: null,
  };
}
