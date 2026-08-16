/**
 * RunHistoryPanel — browse and restore past Agent runs.
 *
 * Shows a list of completed runs with workspace, goal, timestamp,
 * candidate count, and risk level. Supports restore and copy.
 */

import { useState, useEffect, useCallback } from "react";
import {
  loadRunHistory,
  compactRunGoal,
  RUN_HISTORY_UPDATED_EVENT,
  type RunHistoryEntry,
} from "../agent/runHistory";

interface RunHistoryPanelProps {
  onRestore?: (entry: RunHistoryEntry) => void;
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

function RiskDot({ level }: { level?: string | null }) {
  const color = !level || level === "low"
    ? "var(--color-success, #4caf50)"
    : level === "medium"
      ? "var(--color-warning, #ff9800)"
      : "var(--color-danger, #f44336)";
  return <span className="run-history__dot" style={{ background: color }} />;
}

export function RunHistoryPanel({ onRestore }: RunHistoryPanelProps) {
  const [entries, setEntries] = useState<RunHistoryEntry[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => setEntries(loadRunHistory());
    refresh();
    window.addEventListener(RUN_HISTORY_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(RUN_HISTORY_UPDATED_EVENT, refresh);
  }, []);

  const handleCopy = useCallback((entry: RunHistoryEntry) => {
    const text = [
      `# Run ${entry.runId}`,
      `Goal: ${entry.goal}`,
      `Workspace: ${entry.workspace}`,
      `Mode: ${entry.agentMode}`,
      `Time: ${new Date(entry.timestamp).toLocaleString()}`,
      "",
      "## Plan",
      ...entry.planSummary.map((s) => `- ${s}`),
      "",
      "## Candidates",
      ...entry.candidates.map((c, i) => `${i + 1}. ${c.title ?? "Untitled"} — ${c.summary ?? ""}`),
      "",
      entry.recommendation ? `## Recommendation\n${entry.recommendation.title}\n${entry.recommendation.summary}` : "",
    ].filter(Boolean).join("\n");
    navigator.clipboard.writeText(text).catch(() => {});
  }, []);

  if (entries.length === 0) {
    return (
      <div className="run-history">
        <p className="run-history__empty">No completed runs yet. Results appear here after Agent execution.</p>
      </div>
    );
  }

  return (
    <div className="run-history">
      {entries.map((entry) => (
        <div key={entry.id} className={`run-history__item${expanded === entry.id ? " run-history__item--expanded" : ""}`}>
          <div
            className="run-history__summary"
            onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
          >
            <RiskDot level={entry.riskLevel} />
            <div className="run-history__info">
              <span className="run-history__goal">{compactRunGoal(entry.goal)}</span>
              <span className="run-history__meta">
                {entry.workspace} · {entry.candidateCount} candidate(s) · {timeAgo(entry.timestamp)}
              </span>
            </div>
          </div>
          {expanded === entry.id && (
            <div className="run-history__details">
              {entry.planSummary.length > 0 && (
                <div className="run-history__plan">
                  {entry.planSummary.slice(0, 5).map((step, i) => (
                    <div key={i} className="run-history__step">✓ {step}</div>
                  ))}
                </div>
              )}
              {entry.recommendation && (
                <div className="run-history__rec">
                  <strong>{entry.recommendation.title}</strong>
                  <p>{entry.recommendation.summary}</p>
                </div>
              )}
              <div className="run-history__actions">
                {onRestore && (
                  <button
                    type="button"
                    className="agent-btn agent-btn--secondary"
                    onClick={() => onRestore(entry)}
                  >
                    Restore candidates
                  </button>
                )}
                <button
                  type="button"
                  className="agent-btn agent-btn--secondary"
                  onClick={() => handleCopy(entry)}
                >
                  Copy run note
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
