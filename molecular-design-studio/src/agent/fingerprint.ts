/**
 * Deterministic synchronous document content fingerprint.
 *
 * Uses FNV-1a 64-bit hash over stable-serialized document content.
 * This is a stale-document guard, not a cryptographic primitive.
 */

import type { SequenceDocument, SequenceFeature } from "../types";

// ── FNV-1a 64-bit ───────────────────────────────────────────

const FNV_OFFSET = BigInt("14695981039346656037");
const FNV_PRIME = BigInt("1099511628211");

function fnv1a64(data: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < data.length; i++) {
    hash ^= BigInt(data.charCodeAt(i));
    hash = (hash * FNV_PRIME) & BigInt("0xFFFFFFFFFFFFFFFF");
  }
  return hash.toString(16).padStart(16, "0");
}

// ── Stable serialization ────────────────────────────────────
// Uses JSON.stringify with stable key sorting to avoid delimiter ambiguity.

function stableQualifierValue(val: string[]): string[] {
  // Preserve value order; only keys are sorted.
  return val;
}

function serializeFeature(f: SequenceFeature): Record<string, unknown> {
  return {
    id: f.id,
    name: f.name,
    type: f.type,
    start: f.start,
    end: f.end,
    strand: f.strand,
    qualifiers: serializeQualifiers(f.qualifiers),
    ...(f.color !== undefined ? { color: f.color } : {}),
    ...(f.segments !== undefined ? { segments: f.segments } : {}),
  };
}

function serializeQualifiers(
  q: Record<string, string[]>,
): Record<string, string[]> {
  const keys = Object.keys(q).sort();
  const result: Record<string, string[]> = {};
  for (const key of keys) {
    result[key] = stableQualifierValue(q[key] ?? []);
  }
  return result;
}

function serializeDocument(doc: SequenceDocument): object {
  return {
    name: doc.name,
    sequence: doc.sequence,
    circular: doc.circular,
    accession: doc.accession ?? null,
    version: doc.version ?? null,
    features: doc.features.map(serializeFeature),
  };
}

// ── Public API ──────────────────────────────────────────────

const PREFIX = "fnv1a64-v1:";

/**
 * Compute a deterministic fingerprint for a SequenceDocument.
 * Identical documents always produce the same hash.
 */
export function fingerprintDocument(doc: SequenceDocument): string {
  return PREFIX + fnv1a64(JSON.stringify(serializeDocument(doc)));
}
