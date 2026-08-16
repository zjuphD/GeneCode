/**
 * nodeLocate — resolve a step-graph node to an editor region + candidate card.
 *
 * Clicking a tool/validation/results node in the step DAG should locate the
 * corresponding result region in the sequence editor (primer binding span,
 * sgRNA cut site, validated region) and highlight the candidate card it came
 * from. This module keeps that resolution pure and testable:
 *
 * - tool (design) nodes → the first candidate that has resolvable regions
 * - tool (check) nodes → the validation markers for the marker's candidate
 * - validation nodes   → validation markers (grouped by the marker candidate)
 * - results nodes      → the top candidate's regions
 *
 * A node without any resolvable region resolves to null (not clickable).
 */

import type { StepNode } from "./stepGraph";
import type { ResultCandidate } from "./responseTypes";
import { locateSequence, type ValidationMarker } from "./validationMarkers";

export interface NodeRegion {
  start: number;
  end: number;
  label: string;
}

export interface NodeLocateTarget {
  regions: NodeRegion[];
  /** Candidate card to highlight; null when the node maps to no candidate. */
  candidateIndex: number | null;
}

export interface NodeLocateOptions {
  node: StepNode;
  candidates: ResultCandidate[];
  markers: ValidationMarker[];
  sequence: string;
  workspace: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function pushRegion(
  regions: NodeRegion[],
  start: number,
  end: number,
  label: string,
  length: number,
): void {
  if (!validRange(start, end, length)) return;
  regions.push({ start, end, label });
}

/**
 * Resolve the editor regions for one candidate, workspace-aware:
 * - primer binding coordinates when present (cloning / RT-qPCR / mutagenesis)
 * - sgRNA cut site (raw.cut, 0-based) + guide binding region
 * - siRNA sense duplex binding
 * - sequence lookup fallback for primers when no explicit coordinates exist
 */
export function resolveCandidateRegions(
  candidate: ResultCandidate,
  sequence: string,
  workspace: string | null,
): NodeRegion[] {
  const regions: NodeRegion[] = [];
  const length = sequence.length;
  const ws = (workspace ?? "").toLowerCase();
  const raw = isRecord(candidate.raw) ? candidate.raw : {};

  // 1. Explicit primer binding coordinates take priority.
  if (candidate.bindingStartForward != null && candidate.bindingEndForward != null) {
    pushRegion(
      regions,
      candidate.bindingStartForward,
      candidate.bindingEndForward,
      "Forward primer",
      length,
    );
  }
  if (candidate.bindingStartReverse != null && candidate.bindingEndReverse != null) {
    pushRegion(
      regions,
      candidate.bindingStartReverse,
      candidate.bindingEndReverse,
      "Reverse primer",
      length,
    );
  }

  // 2. sgRNA — cut site plus guide binding region.
  if (ws === "sgrna") {
    const cut = safeNumber(raw.cut ?? raw.cut_site);
    if (cut != null) {
      pushRegion(
        regions,
        Math.max(0, cut - 2),
        Math.min(length, cut + 3),
        "sgRNA cut site",
        length,
      );
    }
    const guide =
      typeof raw.seq === "string"
        ? raw.seq
        : typeof raw.guide === "string"
          ? raw.guide
          : undefined;
    const guideRegion = locateSequence(sequence, guide);
    if (guideRegion) pushRegion(regions, guideRegion.start, guideRegion.end, "sgRNA guide", length);
  } else if (ws === "sirna") {
    const sense =
      typeof raw.sense === "string"
        ? raw.sense
        : typeof raw.sense_duplex === "string"
          ? raw.sense_duplex
          : undefined;
    const senseRegion = locateSequence(sequence, sense);
    if (senseRegion) pushRegion(regions, senseRegion.start, senseRegion.end, "siRNA sense", length);
  } else if (regions.length === 0) {
    // 3. No explicit coordinates (cloning / RT-qPCR / mutagenesis): locate the
    //    primers in the document so the node stays clickable.
    const fwd = locateSequence(sequence, candidate.forwardPrimer);
    if (fwd) pushRegion(regions, fwd.start, fwd.end, "Forward primer", length);
    const rev = locateSequence(sequence, candidate.reversePrimer);
    if (rev) pushRegion(regions, rev.start, rev.end, "Reverse primer", length);
  }

  return regions;
}

/** Validation markers grouped for the marker's candidate (usually candidate 0). */
function resolveValidationTarget(
  options: NodeLocateOptions,
): NodeLocateTarget | null {
  const { markers } = options;
  if (markers.length === 0) return null;
  const index = markers[0]?.candidateIndex ?? 0;
  const regions = markers
    .filter((marker) => (marker.candidateIndex ?? 0) === index)
    .map((marker) => ({ start: marker.start, end: marker.end, label: marker.label }));
  if (regions.length === 0) return null;
  return { regions, candidateIndex: index };
}

// ── Hover tooltip content ───────────────────────────────────

export interface NodeTooltipContent {
  /** Region + validation summary lines, e.g. "Forward primer 1–9". */
  lines: string[];
  /** Standalone hint line rendered at the bottom of the tooltip. */
  hint: string;
}

/**
 * Build the hover tooltip for a clickable node: a short validation status
 * line when relevant, the resolved regions as 1-based coordinates, and a
 * locate-in-editor hint. Returns null when the node has nothing to locate.
 */
export function buildNodeTooltip(
  target: NodeLocateTarget,
  validationStatus: string | null,
): NodeTooltipContent | null {
  if (target.regions.length === 0) return null;
  const lines: string[] = [];
  if (validationStatus && validationStatus.trim().length > 0) {
    lines.push(validationStatus);
  }
  for (const region of target.regions) {
    lines.push(`${region.label} ${region.start + 1}–${region.end}`);
  }
  return { lines, hint: "点击定位到编辑器" };
}

/**
 * Resolve a node to its editor target. Returns null when nothing locatable
 * backs the node (plan steps and tool runs without results are not clickable).
 */
export function resolveNodeTarget(options: NodeLocateOptions): NodeLocateTarget | null {
  const { node, candidates, sequence, workspace } = options;

  // Validation stage → marker regions for the marker candidate.
  if (node.layer === 2) return resolveValidationTarget(options);

  // Results stage → top candidate's regions.
  if (node.layer === 3) {
    const candidate = candidates[0];
    if (!candidate) return null;
    const regions = resolveCandidateRegions(candidate, sequence, workspace);
    if (regions.length === 0) return null;
    return { regions, candidateIndex: 0 };
  }

  // Tool stage: check tools map to validation markers; design tools map to the
  // first candidate that has resolvable regions (candidates[0] in practice).
  if (node.layer === 1) {
    const tool = (node.tool || "").toLowerCase();
    if (tool.startsWith("check")) return resolveValidationTarget(options);
    for (let index = 0; index < candidates.length; index += 1) {
      const regions = resolveCandidateRegions(candidates[index]!, sequence, workspace);
      if (regions.length > 0) return { regions, candidateIndex: index };
    }
    return null;
  }

  return null;
}
