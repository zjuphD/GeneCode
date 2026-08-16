/**
 * Run history persistence — stores completed Agent runs for later review.
 *
 * Each entry captures the run metadata, plan, candidates, recommendation,
 * and timeline so users can restore, compare, or copy old runs.
 */

import type { AgentRecommendation, ResultCandidate, RunRecord, TimelineEvent } from "./responseTypes";
import type { AgentMode, AgentWorkspace } from "./service";

function deriveRiskLevel(recommendation: AgentRecommendation | null): string {
  if (!recommendation) return "low";
  const riskCount = recommendation.risks?.length ?? 0;
  const confidence = recommendation.confidence ?? 50;
  if (riskCount === 0 && confidence >= 70) return "low";
  if (riskCount >= 3 || confidence < 40) return "high";
  return "medium";
}

const RUN_HISTORY_KEY = "molecular-design-studio.run-history.v1";
const MAX_HISTORY = 50;
export const RUN_HISTORY_UPDATED_EVENT = "molecular-design-studio:run-history-updated";

export interface RunHistoryEntry {
  id: string;
  runId: string;
  workspace: AgentWorkspace;
  agentMode: AgentMode;
  goal: string;
  timestamp: number;
  planSummary: string[];
  candidateCount: number;
  topCandidateTitle: string | null;
  recommendation: AgentRecommendation | null;
  riskLevel: string | null;
  timeline: TimelineEvent[];
  /** Full candidates for restore/compare. */
  candidates: ResultCandidate[];
  /** Original plan rows. */
  plan: Array<{ label: string; tool: string; status: string; summary: string }>;
}

export function compactRunGoal(goal: string): string {
  const normalized = String(goal || "").trim().replace(/\s+/g, " ");
  if (!normalized) return "Untitled run";
  const letters = normalized.replace(/[^A-Za-z]/g, "");
  const sequenceLetters = normalized.replace(/[^ACGTUNRYSWKMBDHV]/gi, "");
  if (normalized.length > 120 && letters.length > 0 && sequenceLetters.length / letters.length > 0.85) {
    return `Attached sequence design · ${sequenceLetters.length.toLocaleString()} bp`;
  }
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

interface PersistedHistory {
  version: 1;
  entries: RunHistoryEntry[];
}

function canPersist(): boolean {
  return typeof window !== "undefined" && import.meta.env.MODE !== "test";
}

export function loadRunHistory(): RunHistoryEntry[] {
  if (!canPersist()) return [];
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(RUN_HISTORY_KEY) ?? "null");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const value = raw as PersistedHistory;
    if (value.version !== 1 || !Array.isArray(value.entries)) return [];
    return value.entries;
  } catch {
    return [];
  }
}

export function saveRunHistoryEntry(entry: RunHistoryEntry): void {
  if (!canPersist()) return;
  try {
    const existing = loadRunHistory();
    const updated = [entry, ...existing.filter((e) => e.id !== entry.id)].slice(0, MAX_HISTORY);
    window.localStorage.setItem(RUN_HISTORY_KEY, JSON.stringify({ version: 1, entries: updated }));
    window.dispatchEvent(new Event(RUN_HISTORY_UPDATED_EVENT));
  } catch {
    // Storage can be disabled or full.
  }
}

export function clearRunHistory(): void {
  if (!canPersist()) return;
  window.localStorage.removeItem(RUN_HISTORY_KEY);
  window.dispatchEvent(new Event(RUN_HISTORY_UPDATED_EVENT));
}

/**
 * Build a RunHistoryEntry from the current session state.
 * Called when a run completes (execute response received).
 */
export function buildRunHistoryEntry(params: {
  runId: string;
  workspace: AgentWorkspace;
  agentMode: AgentMode;
  goal: string;
  plan: Array<{ label: string; tool: string; status: string; summary: string }>;
  candidates: ResultCandidate[];
  recommendation: AgentRecommendation | null;
  timeline: TimelineEvent[];
  runRecord?: RunRecord | null;
}): RunHistoryEntry {
  const top = params.candidates[0];
  return {
    id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    runId: params.runId,
    workspace: params.workspace,
    agentMode: params.agentMode,
    goal: compactRunGoal(params.goal),
    timestamp: Date.now(),
    planSummary: params.plan.map((p) => p.label || p.summary).filter(Boolean),
    candidateCount: params.candidates.length,
    topCandidateTitle: top?.title ?? null,
    recommendation: params.recommendation,
    riskLevel: deriveRiskLevel(params.recommendation),
    timeline: params.timeline.slice(-50),
    candidates: params.candidates,
    plan: params.plan,
  };
}
