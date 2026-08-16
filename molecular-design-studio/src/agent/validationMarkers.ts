/**
 * validationMarkers — map remote validation results onto sequence coordinates.
 *
 * The remote check endpoints (RT-qPCR specificity, sgRNA/siRNA off-target)
 * return per-candidate summaries without direct open-sequence coordinates.
 * This module resolves marker regions from candidate binding positions when
 * available and falls back to locating the checked oligo/guide sequence in the
 * open document so the editor can show a colored track of validated regions.
 */

import type { ResultCandidate } from "./responseTypes";

export type ValidationTone = "pass" | "warning" | "fail" | "info";

export interface ValidationMarker {
  id: string;
  start: number;
  end: number;
  tone: ValidationTone;
  label: string;
  detail?: string;
  /** Index into the candidate list this marker was resolved from. */
  candidateIndex?: number;
}

export interface BuildValidationMarkersOptions {
  validationResults: Array<Record<string, unknown>>;
  candidates: ResultCandidate[];
  sequence: string;
  workspace?: string | null;
}

interface CheckSummary {
  status?: string;
  summary?: string;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickCheck(result: Record<string, unknown>): CheckSummary | null {
  const candidate =
    result.specificityCheck ??
    result.genomeOfftargetCheck ??
    result.transcriptomeOfftargetCheck;
  return isRecord(candidate) ? (candidate as CheckSummary) : null;
}

function toneFromStatus(status: unknown): ValidationTone {
  const normalized = typeof status === "string" ? status.toLowerCase() : "";
  if (normalized.includes("pass") || normalized.includes("low")) return "pass";
  if (normalized.includes("fail") || normalized.includes("high")) return "fail";
  if (normalized.includes("warn") || normalized.includes("review")) return "warning";
  return "info";
}

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validRange(start: number, end: number, length: number): boolean {
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end > start &&
    end <= length
  );
}

/**
 * Locate an oligo sequence (or its reverse complement) in the open document.
 * Exported so step-node locate actions can reuse the same resolution logic.
 */
export function locateSequence(sequence: string, oligo: string | undefined | null): { start: number; end: number } | null {
  if (!oligo || !sequence) return null;
  const query = oligo.replace(/[^A-Za-z]/g, "").toUpperCase();
  if (!query) return null;
  const index = sequence.toUpperCase().indexOf(query);
  if (index >= 0) return { start: index, end: index + query.length };

  // Try reverse complement
  const complement = { A: "T", T: "A", G: "C", C: "G", N: "N", U: "A", R: "N", Y: "N" } as Record<string, string>;
  const rc = query
    .split("")
    .reverse()
    .map((base) => complement[base] ?? base)
    .join("");
  const rcIndex = sequence.toUpperCase().indexOf(rc);
  if (rcIndex >= 0) return { start: rcIndex, end: rcIndex + query.length };
  return null;
}

/**
 * Build editor markers from validation results.
 *
 * Resolution order per candidate:
 * 1. Candidate binding positions (0-based half-open) when present.
 * 2. Subsequence lookup of the checked oligo (primer/guide/duplex) in the open
 *    document, including reverse-complement matching for primers.
 * 3. Nothing — the candidate is skipped when no coordinate can be resolved.
 */
export function buildValidationMarkers(options: BuildValidationMarkersOptions): ValidationMarker[] {
  const markers: ValidationMarker[] = [];
  const sequenceLength = options.sequence.length;

  options.validationResults.forEach((result, index) => {
    const check = pickCheck(result);
    const candidate = options.candidates[index];
    if (!candidate) return;

    const tone = check ? toneFromStatus(check.status) : "info";
    const detail = typeof check?.summary === "string" ? check.summary : undefined;
    const workspace = (options.workspace ?? candidate.workspace ?? "").toLowerCase();
    // One marker per (result, label): explicit binding coordinates take
    // priority, then sequence lookup fills in when no coordinates exist.
    const pushed = new Set<string>();

    const push = (start: number, end: number, label: string) => {
      if (pushed.has(label)) return;
      if (!validRange(start, end, sequenceLength)) return;
      pushed.add(label);
      markers.push({ id: `validate-${index}-${label}`, start, end, tone, label, detail, candidateIndex: index });
    };

    // 1. Explicit binding positions take priority (cloning / RT-qPCR / mutagenesis)
    const bindingForward =
      candidate.bindingStartForward != null && candidate.bindingEndForward != null
        ? { start: candidate.bindingStartForward, end: candidate.bindingEndForward }
        : null;
    const bindingReverse =
      candidate.bindingStartReverse != null && candidate.bindingEndReverse != null
        ? { start: candidate.bindingStartReverse, end: candidate.bindingEndReverse }
        : null;
    if (bindingForward) push(bindingForward.start, bindingForward.end, "Forward primer");
    if (bindingReverse) push(bindingReverse.start, bindingReverse.end, "Reverse primer");

    // 2. Sequence lookup of the checked oligo (only when no explicit coordinate)
    if (!bindingForward && workspace === "rtqpcr") {
      const fwd = locateSequence(options.sequence, candidate.forwardPrimer);
      if (fwd) push(fwd.start, fwd.end, "Forward primer");
    }
    if (!bindingReverse && workspace === "rtqpcr") {
      const rev = locateSequence(options.sequence, candidate.reversePrimer);
      if (rev) push(rev.start, rev.end, "Reverse primer");
    }
    if (workspace === "sgrna") {
      const guide = isRecord(candidate.raw) ? candidate.raw.seq : undefined;
      const located = locateSequence(
        options.sequence,
        typeof guide === "string" ? guide : undefined,
      );
      if (located) push(located.start, located.end, "sgRNA guide");
    } else if (workspace === "sirna") {
      const sense = isRecord(candidate.raw) ? candidate.raw.sense : undefined;
      const located = locateSequence(
        options.sequence,
        typeof sense === "string" ? sense : undefined,
      );
      if (located) push(located.start, located.end, "siRNA sense");
    }

    // 3. Check-result coordinates when present (siRNA target_start/end)
    if (workspace === "sirna" && candidate.raw) {
      const targetStart = safeNumber(result.target_start);
      const targetEnd = safeNumber(result.target_end);
      if (targetStart != null && targetEnd != null) {
        push(
          Math.max(0, targetStart - 1),
          Math.min(sequenceLength, targetEnd),
          "siRNA target region",
        );
      }
    }

    // Keep at least one marker even when only the status line matters
    if (pushed.size === 0 && check && check.status) {
      const located = isRecord(candidate.raw)
        ? locateSequence(
            options.sequence,
            typeof candidate.raw.seq === "string"
              ? candidate.raw.seq
              : candidate.forwardPrimer,
          )
        : null;
      if (located) push(located.start, located.end, "Validated region");
    }
  });

  return markers;
}
