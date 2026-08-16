import { reverseComplement } from "./sequenceActions";

export type VerificationOrientation = "forward" | "reverse";
export type VerificationChangeKind = "substitution" | "insertion" | "deletion";

export interface VerificationChange {
  kind: VerificationChangeKind;
  referencePosition: number | null;
  queryPosition: number | null;
  referenceBase: string;
  queryBase: string;
}

export interface SequenceVerificationResult {
  orientation: VerificationOrientation;
  method: "gapped" | "ungapped";
  score: number;
  identityPercent: number;
  referenceCoveragePercent: number;
  queryCoveragePercent: number;
  referenceStart: number;
  referenceEnd: number;
  wrapsOrigin: boolean;
  matches: number;
  substitutions: number;
  insertions: number;
  deletions: number;
  ambiguous: number;
  alignedReference: string;
  alignedQuery: string;
  changes: VerificationChange[];
}

const MATCH_SCORE = 2;
const MISMATCH_SCORE = -2;
const GAP_SCORE = -5;
const MAX_GAPPED_CELLS = 12_000_000;

export function normalizeVerificationSequence(value: string): string {
  return value.replace(/[\s\d.-]/g, "").toUpperCase().replace(/U/g, "T");
}

function validateSequence(value: string, label: string): string {
  const normalized = normalizeVerificationSequence(value);
  if (!normalized) throw new Error(`${label} sequence is empty`);
  if (!/^[ACGTN]+$/.test(normalized)) {
    throw new Error(`${label} sequence contains unsupported characters`);
  }
  return normalized;
}

function buildSearchReference(reference: string, queryLength: number, circular: boolean): string {
  if (!circular) return reference;
  return reference + reference.slice(0, Math.min(reference.length, queryLength + 100));
}

function summarizeAlignment(
  alignedReference: string,
  alignedQuery: string,
  orientation: VerificationOrientation,
  score: number,
  startIndex: number,
  endIndex: number,
  referenceLength: number,
  queryLength: number,
  circular: boolean,
  method: "gapped" | "ungapped",
): SequenceVerificationResult {
  let referenceCursor = startIndex;
  let queryCursor = 0;
  let matches = 0;
  let substitutions = 0;
  let insertions = 0;
  let deletions = 0;
  let ambiguous = 0;
  let consumedReference = 0;
  let consumedQuery = 0;
  const changes: VerificationChange[] = [];

  for (let index = 0; index < alignedReference.length; index += 1) {
    const referenceBase = alignedReference[index]!;
    const queryBase = alignedQuery[index]!;
    const referencePosition = referenceBase === "-" ? null : referenceCursor % referenceLength;
    const queryPosition = queryBase === "-" ? null : queryCursor;

    if (referenceBase !== "-") {
      referenceCursor += 1;
      consumedReference += 1;
    }
    if (queryBase !== "-") {
      queryCursor += 1;
      consumedQuery += 1;
    }

    if (referenceBase === "-") {
      insertions += 1;
      changes.push({ kind: "insertion", referencePosition, queryPosition, referenceBase, queryBase });
    } else if (queryBase === "-") {
      deletions += 1;
      changes.push({ kind: "deletion", referencePosition, queryPosition, referenceBase, queryBase });
    } else if (referenceBase === "N" || queryBase === "N") {
      ambiguous += 1;
    } else if (referenceBase === queryBase) {
      matches += 1;
    } else {
      substitutions += 1;
      changes.push({ kind: "substitution", referencePosition, queryPosition, referenceBase, queryBase });
    }
  }

  const comparable = matches + substitutions + insertions + deletions;
  const identityPercent = comparable ? (matches / comparable) * 100 : 0;
  const uniqueReferenceBases = Math.min(consumedReference, referenceLength);
  const normalizedStart = ((startIndex % referenceLength) + referenceLength) % referenceLength;
  const normalizedEnd = ((endIndex % referenceLength) + referenceLength) % referenceLength;

  return {
    orientation,
    method,
    score,
    identityPercent,
    referenceCoveragePercent: referenceLength ? (uniqueReferenceBases / referenceLength) * 100 : 0,
    queryCoveragePercent: queryLength ? (consumedQuery / queryLength) * 100 : 0,
    referenceStart: normalizedStart,
    referenceEnd: normalizedEnd,
    wrapsOrigin: circular && (endIndex > referenceLength || normalizedEnd < normalizedStart),
    matches,
    substitutions,
    insertions,
    deletions,
    ambiguous,
    alignedReference,
    alignedQuery,
    changes,
  };
}

function alignSemiglobal(
  reference: string,
  query: string,
  orientation: VerificationOrientation,
  circular: boolean,
): SequenceVerificationResult {
  const searchReference = buildSearchReference(reference, query.length, circular);
  const columns = searchReference.length + 1;
  const rows = query.length + 1;
  const directions = new Uint8Array(rows * columns);
  let previous = new Int32Array(columns);
  let current = new Int32Array(columns);

  for (let row = 1; row < rows; row += 1) {
    current[0] = row * GAP_SCORE;
    directions[row * columns] = 2;
    const queryBase = query[row - 1]!;
    for (let column = 1; column < columns; column += 1) {
      const referenceBase = searchReference[column - 1]!;
      const diagonal = previous[column - 1]! + (
        referenceBase === "N" || queryBase === "N"
          ? 0
          : referenceBase === queryBase ? MATCH_SCORE : MISMATCH_SCORE
      );
      const up = previous[column]! + GAP_SCORE;
      const left = current[column - 1]! + GAP_SCORE;
      if (diagonal >= up && diagonal >= left) {
        current[column] = diagonal;
        directions[row * columns + column] = 1;
      } else if (up >= left) {
        current[column] = up;
        directions[row * columns + column] = 2;
      } else {
        current[column] = left;
        directions[row * columns + column] = 3;
      }
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  let endColumn = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  const maxEndColumn = circular ? Math.min(columns - 1, reference.length + query.length + 100) : columns - 1;
  for (let column = 0; column <= maxEndColumn; column += 1) {
    if (previous[column]! > bestScore) {
      bestScore = previous[column]!;
      endColumn = column;
    }
  }

  let row = query.length;
  let column = endColumn;
  const alignedReference: string[] = [];
  const alignedQuery: string[] = [];
  while (row > 0) {
    const direction = directions[row * columns + column];
    if (direction === 1) {
      alignedReference.push(searchReference[column - 1]!);
      alignedQuery.push(query[row - 1]!);
      row -= 1;
      column -= 1;
    } else if (direction === 2 || column === 0) {
      alignedReference.push("-");
      alignedQuery.push(query[row - 1]!);
      row -= 1;
    } else {
      alignedReference.push(searchReference[column - 1]!);
      alignedQuery.push("-");
      column -= 1;
    }
  }

  const startColumn = column;
  alignedReference.reverse();
  alignedQuery.reverse();
  return summarizeAlignment(
    alignedReference.join(""),
    alignedQuery.join(""),
    orientation,
    bestScore,
    startColumn,
    endColumn,
    reference.length,
    query.length,
    circular,
    "gapped",
  );
}

function alignUngapped(
  reference: string,
  query: string,
  orientation: VerificationOrientation,
  circular: boolean,
): SequenceVerificationResult {
  const searchReference = buildSearchReference(reference, query.length, circular);
  const minimumOverlap = Math.max(1, Math.ceil(Math.min(reference.length, query.length) * 0.5));
  let best = { score: Number.NEGATIVE_INFINITY, offset: 0, queryStart: 0, overlap: 0 };
  const minimumOffset = circular ? 0 : -query.length + minimumOverlap;
  const maximumOffset = circular ? reference.length - 1 : reference.length - minimumOverlap;

  for (let offset = minimumOffset; offset <= maximumOffset; offset += 1) {
    const referenceStart = Math.max(0, offset);
    const queryStart = Math.max(0, -offset);
    const overlap = Math.min(searchReference.length - referenceStart, query.length - queryStart);
    if (overlap < minimumOverlap) continue;
    let score = 0;
    for (let index = 0; index < overlap; index += 1) {
      const referenceBase = searchReference[referenceStart + index]!;
      const queryBase = query[queryStart + index]!;
      score += referenceBase === "N" || queryBase === "N"
        ? 0
        : referenceBase === queryBase ? MATCH_SCORE : MISMATCH_SCORE;
    }
    if (score > best.score) best = { score, offset, queryStart, overlap };
  }

  const referenceStart = Math.max(0, best.offset);
  const alignedReference = searchReference.slice(referenceStart, referenceStart + best.overlap);
  const alignedQuery = query.slice(best.queryStart, best.queryStart + best.overlap);
  return summarizeAlignment(
    alignedReference,
    alignedQuery,
    orientation,
    best.score,
    referenceStart,
    referenceStart + best.overlap,
    reference.length,
    query.length,
    circular,
    "ungapped",
  );
}

function alignOneOrientation(
  reference: string,
  query: string,
  orientation: VerificationOrientation,
  circular: boolean,
): SequenceVerificationResult {
  const searchLength = buildSearchReference(reference, query.length, circular).length;
  return (query.length + 1) * (searchLength + 1) <= MAX_GAPPED_CELLS
    ? alignSemiglobal(reference, query, orientation, circular)
    : alignUngapped(reference, query, orientation, circular);
}

export function verifySequence(
  referenceValue: string,
  queryValue: string,
  circular = false,
): SequenceVerificationResult {
  const reference = validateSequence(referenceValue, "Reference");
  const query = validateSequence(queryValue, "Query");
  if (circular && query.length > reference.length * 1.25) {
    throw new Error("For a circular reference, the query must be no more than 1.25 times the reference length");
  }
  const forward = alignOneOrientation(reference, query, "forward", circular);
  const reverse = alignOneOrientation(reference, reverseComplement(query), "reverse", circular);
  if (forward.score !== reverse.score) return forward.score > reverse.score ? forward : reverse;
  return forward.identityPercent >= reverse.identityPercent ? forward : reverse;
}
