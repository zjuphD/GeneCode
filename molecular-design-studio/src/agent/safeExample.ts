/**
 * Safe annotation-only example proposal.
 *
 * Adds a misc_feature marker to the current document.
 * Does not invent or modify biological sequence.
 */

import type { SequenceDocument } from "../types";
import type { SequencePatch } from "./patchTypes";
import { fingerprintDocument } from "./fingerprint";

let counter = 0;

/**
 * Build a safe example patch for the given document.
 * Annotation-only: adds a misc_feature spanning [0, min(20, seqLen)).
 */
export function buildSafeExample(document: SequenceDocument): SequencePatch {
  counter++;
  const span = Math.min(20, document.sequence.length);
  const featureId = `agent-marker-${counter}`;
  const patchId = `safe-example-${counter}`;

  return {
    schemaVersion: 1,
    id: patchId,
    title: "Example: review marker",
    summary:
      "This is a safe example proposal. It adds a review marker annotation without modifying any sequence.",
    baseHash: fingerprintDocument(document),
    operations: [
      {
        kind: "add_feature",
        id: `op-add-marker-${counter}`,
        reason: "Add a visible marker for Agent review demonstration",
        feature: {
          id: featureId,
          name: "Agent review marker",
          type: "misc_feature",
          start: 0,
          end: span,
          strand: 1,
          qualifiers: { note: ["Safe example — annotation only"] },
        },
      },
    ],
  };
}
