import type { SequenceDocument, SequenceFeature } from "../types";
import { fingerprintDocument } from "../agent/fingerprint";

export type DocumentHistorySource =
  | "manual"
  | "agent"
  | "annotation"
  | "selection"
  | "history";

export interface DocumentHistoryEntry {
  id: string;
  label: string;
  source: DocumentHistorySource;
  timestamp: number;
  before: SequenceDocument;
  after: SequenceDocument;
  beforeHash: string;
  afterHash: string;
}

// ── A-DATA-001: compact delta representation ─────────────────────────────
//
// Persisting every history entry with two full document snapshots is the
// dominant localStorage cost (up to MAX_DOCUMENT_HISTORY × 2 docs). The
// persisted form stores ONE full document (before) plus a delta describing
// how to reach `after`, so point mutations stay tiny while restore stays
// exact. The runtime DocumentHistoryEntry keeps both full docs; compaction
// happens only at the persistence boundary.

/**
 * Sequence difference expressed as common-prefix/suffix split:
 *   after = before.slice(0, prefixLen) + middle + before.slice(len - suffixLen)
 */
export interface SequenceDelta {
  prefixLen: number;
  suffixLen: number;
  middle: string;
}

export type FeatureDeltaOp =
  | { kind: "add"; feature: SequenceFeature }
  | { kind: "remove"; id: string }
  | { kind: "update"; feature: SequenceFeature };

export interface DocumentDelta {
  /** Present only when the document name changed. */
  name?: string;
  /** Present only when the topology changed. */
  circular?: boolean;
  /** Present only when the sequence changed. */
  sequence?: SequenceDelta;
  /** Present only when any feature changed. */
  featureOps?: FeatureDeltaOp[];
  /** `after.features` id order, present whenever featureOps is present. */
  featureOrder?: string[];
  /** Present only when the accession changed (null = removed). */
  accession?: string | null;
  /** Present only when the version changed (null = removed). */
  version?: string | null;
}

/** Compact persisted form of a history entry (before + delta). */
export interface PersistedHistoryEntry {
  id: string;
  label: string;
  source: DocumentHistorySource;
  timestamp: number;
  beforeHash: string;
  afterHash: string;
  before: SequenceDocument;
  delta: DocumentDelta;
}

function diffSequences(before: string, after: string): SequenceDelta | null {
  if (before === after) return null;
  const min = Math.min(before.length, after.length);
  let prefixLen = 0;
  while (prefixLen < min && before[prefixLen] === after[prefixLen]) {
    prefixLen += 1;
  }
  let suffixLen = 0;
  while (
    suffixLen < min - prefixLen &&
    before[before.length - 1 - suffixLen] === after[after.length - 1 - suffixLen]
  ) {
    suffixLen += 1;
  }
  return {
    prefixLen,
    suffixLen,
    middle: after.slice(prefixLen, after.length - suffixLen),
  };
}

function applySequenceDelta(before: string, delta: SequenceDelta): string {
  // Bounds-safety: a malformed delta must never corrupt the reconstructed
  // sequence. Non-integer or out-of-range prefix/suffix collapse to the safe
  // midpoint of the diff (same net result as a full replacement when invalid).
  const prefixLen =
    Number.isInteger(delta.prefixLen) &&
    delta.prefixLen >= 0 &&
    delta.prefixLen <= before.length
      ? delta.prefixLen
      : 0;
  const suffixLen =
    Number.isInteger(delta.suffixLen) &&
    delta.suffixLen >= 0 &&
    delta.suffixLen <= before.length - prefixLen
      ? delta.suffixLen
      : 0;
  return (
    before.slice(0, prefixLen) +
    delta.middle +
    before.slice(before.length - suffixLen)
  );
}

/**
 * Compute the minimal delta from `before` to `after`.
 * Returns null when the two documents are structurally identical.
 */
export function diffDocuments(
  before: SequenceDocument,
  after: SequenceDocument,
): DocumentDelta | null {
  const delta: DocumentDelta = {};

  if (before.name !== after.name) delta.name = after.name;
  if (before.circular !== after.circular) delta.circular = after.circular;
  if (before.accession !== after.accession) {
    delta.accession = after.accession ?? null;
  }
  if (before.version !== after.version) {
    delta.version = after.version ?? null;
  }

  const sequence = diffSequences(before.sequence, after.sequence);
  if (sequence) delta.sequence = sequence;

  const beforeById = new Map(before.features.map((f) => [f.id, f]));
  const afterById = new Map(after.features.map((f) => [f.id, f]));
  const featureOps: FeatureDeltaOp[] = [];
  for (const feature of after.features) {
    const previous = beforeById.get(feature.id);
    if (!previous) {
      featureOps.push({ kind: "add", feature });
    } else if (JSON.stringify(previous) !== JSON.stringify(feature)) {
      featureOps.push({ kind: "update", feature });
    }
  }
  for (const feature of before.features) {
    if (!afterById.has(feature.id)) {
      featureOps.push({ kind: "remove", id: feature.id });
    }
  }
  if (featureOps.length > 0) {
    delta.featureOps = featureOps;
    delta.featureOrder = after.features.map((f) => f.id);
  }

  return Object.keys(delta).length > 0 ? delta : null;
}

/** Reconstruct the `after` document from `before` + delta. */
export function applyDocumentDelta(
  before: SequenceDocument,
  delta: DocumentDelta,
): SequenceDocument {
  const featureMap = new Map(before.features.map((f) => [f.id, f]));
  for (const op of delta.featureOps ?? []) {
    if (op.kind === "remove") {
      featureMap.delete(op.id);
    } else {
      featureMap.set(op.feature.id, op.feature);
    }
  }
  const featureOrder = delta.featureOrder ?? [...featureMap.values()].map((f) => f.id);
  const features = featureOrder
    .map((id) => featureMap.get(id))
    .filter((f): f is SequenceFeature => Boolean(f));

  const accession =
    delta.accession !== undefined
      ? (delta.accession ?? undefined)
      : before.accession;
  const version =
    delta.version !== undefined
      ? (delta.version ?? undefined)
      : before.version;
  return {
    name: delta.name ?? before.name,
    sequence: delta.sequence
      ? applySequenceDelta(before.sequence, delta.sequence)
      : before.sequence,
    circular: delta.circular ?? before.circular,
    features,
    ...(accession !== undefined ? { accession } : {}),
    ...(version !== undefined ? { version } : {}),
  };
}

/** Compact a runtime history entry into its persisted (before + delta) form. */
export function toPersistedHistoryEntry(
  entry: DocumentHistoryEntry,
): PersistedHistoryEntry {
  return {
    id: entry.id,
    label: entry.label,
    source: entry.source,
    timestamp: entry.timestamp,
    beforeHash: entry.beforeHash,
    afterHash: entry.afterHash,
    before: entry.before,
    delta: diffDocuments(entry.before, entry.after) ?? {},
  };
}

/** Expand a persisted history entry back into the full runtime form. */
export function fromPersistedHistoryEntry(
  entry: PersistedHistoryEntry,
): DocumentHistoryEntry {
  return {
    id: entry.id,
    label: entry.label,
    source: entry.source,
    timestamp: entry.timestamp,
    beforeHash: entry.beforeHash,
    afterHash: entry.afterHash,
    before: entry.before,
    after: applyDocumentDelta(entry.before, entry.delta),
  };
}

export const MAX_DOCUMENT_HISTORY = 50;

function cloneDocument(doc: SequenceDocument): SequenceDocument {
  return {
    ...doc,
    features: doc.features.map((feature) => ({
      ...feature,
      qualifiers: Object.fromEntries(
        Object.entries(feature.qualifiers).map(([key, values]) => [key, [...values]]),
      ),
    })),
  };
}

export function createDocumentHistoryEntry(
  before: SequenceDocument,
  after: SequenceDocument,
  label: string,
  source: DocumentHistorySource,
  timestamp = Date.now(),
): DocumentHistoryEntry | null {
  const beforeHash = fingerprintDocument(before);
  const afterHash = fingerprintDocument(after);
  if (beforeHash === afterHash) return null;

  return {
    id: `history_${timestamp}_${Math.random().toString(36).slice(2, 8)}`,
    label,
    source,
    timestamp,
    before: cloneDocument(before),
    after: cloneDocument(after),
    beforeHash,
    afterHash,
  };
}

export function appendDocumentHistory(
  history: DocumentHistoryEntry[],
  entry: DocumentHistoryEntry | null,
): DocumentHistoryEntry[] {
  if (!entry) return history;
  return [...history, entry].slice(-MAX_DOCUMENT_HISTORY);
}

export function copyHistoryDocument(doc: SequenceDocument): SequenceDocument {
  return cloneDocument(doc);
}
