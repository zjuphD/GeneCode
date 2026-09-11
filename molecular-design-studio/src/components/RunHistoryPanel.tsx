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
import {
  getAgentArtifact,
  listAgentRuns,
  type AgentArtifactRead,
  type AgentJournalRun,
} from "../agent/service";

interface RunHistoryPanelProps {
  onRestore?: (entry: RunHistoryEntry) => void;
  onBackendCount?: (count: number) => void;
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
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

function formatArtifactPreview(artifact: AgentArtifactRead): string {
  if (artifact.dataPreview) return artifact.dataPreview;
  if (artifact.data) {
    try {
      return JSON.stringify(artifact.data, null, 2).slice(0, 3_000);
    } catch {
      return "无法显示此 Artifact 预览。";
    }
  }
  return "此 Artifact 只有 metadata，尚未加载正文。";
}

function backendStatusLabel(status: string): string {
  return {
    completed: "已完成",
    interrupted: "已中断",
    failed: "失败",
    cancelled: "已取消",
    planning: "规划中",
    executing: "执行中",
    awaiting_input: "等待输入",
  }[status] ?? status;
}

export function RunHistoryPanel({ onRestore, onBackendCount }: RunHistoryPanelProps) {
  const [entries, setEntries] = useState<RunHistoryEntry[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [backendRuns, setBackendRuns] = useState<AgentJournalRun[]>([]);
  const [backendLoading, setBackendLoading] = useState(false);
  const [expandedBackend, setExpandedBackend] = useState<string | null>(null);
  const [artifactLoading, setArtifactLoading] = useState<string | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [artifactPreviews, setArtifactPreviews] = useState<Record<string, AgentArtifactRead>>({});

  useEffect(() => {
    const refresh = () => setEntries(loadRunHistory());
    refresh();
    window.addEventListener(RUN_HISTORY_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(RUN_HISTORY_UPDATED_EVENT, refresh);
  }, []);

  useEffect(() => {
    if (import.meta.env.MODE === "test") return undefined;
    const controller = new AbortController();
    setBackendLoading(true);
    void listAgentRuns(50, controller.signal)
      .then((runs) => {
        if (!controller.signal.aborted) {
          setBackendRuns(runs);
          onBackendCount?.(runs.length);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setBackendRuns([]);
          onBackendCount?.(0);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBackendLoading(false);
      });
    return () => controller.abort();
  }, [onBackendCount]);

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

  const localRunIds = new Set(entries.map((entry) => entry.runId));
  const remoteRuns = backendRuns.filter((run) => !localRunIds.has(run.run_id));

  const loadArtifactPreview = async (run: AgentJournalRun, artifactId: string) => {
    const key = `${run.run_id}:${artifactId}`;
    setArtifactLoading(key);
    setArtifactError(null);
    try {
      const artifact = await getAgentArtifact(run.run_id, artifactId, { preview: true });
      setArtifactPreviews((current) => ({ ...current, [key]: artifact }));
    } catch (error) {
      setArtifactError(error instanceof Error ? error.message : "Artifact 读取失败");
    } finally {
      setArtifactLoading(null);
    }
  };

  if (entries.length === 0 && remoteRuns.length === 0) {
    return (
      <div className="run-history">
        <p className="run-history__empty">
          {backendLoading ? "正在读取本地 Run Journal…" : "还没有可查看的 Agent 运行记录。"}
        </p>
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
                  {entry.workspace} · {entry.candidateCount} 个候选 · {timeAgo(entry.timestamp)}
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
                    恢复候选
                  </button>
                )}
                <button
                  type="button"
                  className="agent-btn agent-btn--secondary"
                  onClick={() => handleCopy(entry)}
                >
                  复制运行摘要
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
      {remoteRuns.length > 0 && (
        <section className="run-history__remote" aria-label="后端 Run Journal">
          <div className="run-history__remote-heading">
            <span>Sidecar Run Journal</span>
            <small>{remoteRuns.length} 条记录</small>
          </div>
          {remoteRuns.map((run) => {
            const open = expandedBackend === run.run_id;
            const artifacts = (run.artifacts ?? []).filter((artifact) => {
              const id = artifact.artifact_id ?? artifact.artifactId;
              return typeof id === "string" && id.length > 0;
            });
            return (
              <article key={run.run_id} className={`run-history__remote-item${open ? " is-expanded" : ""}`}>
                <button
                  type="button"
                  className="run-history__remote-summary"
                  onClick={() => setExpandedBackend(open ? null : run.run_id)}
                  aria-expanded={open}
                >
                  <RiskDot level={run.status === "completed" ? "low" : "medium"} />
                  <span className="run-history__info">
                    <strong>{run.workspace || "分子设计"} · {backendStatusLabel(run.status)}</strong>
                    <small>{run.run_id} · {run.events?.length ?? 0} 个事件</small>
                  </span>
                  <span aria-hidden="true">{open ? "⌃" : "⌄"}</span>
                </button>
                {open && (
                  <div className="run-history__remote-details">
                    <div className="run-history__remote-meta">
                      <span>模式：{run.mode || "—"}</span>
                      {run.updated_at ? <span>{timeAgo(run.updated_at * 1000)}</span> : null}
                    </div>
                    {(run.events ?? []).slice(-6).map((event, index) => (
                      <div key={`${String(event.event_id ?? "event")}-${index}`} className="run-history__remote-event">
                        <span className="run-history__remote-event-dot" />
                        <span>{String(event.summary || event.output_summary || event.detail || event.type || "事件")}</span>
                      </div>
                    ))}
                    {artifacts.length > 0 && (
                      <div className="run-history__artifacts">
                        <strong>Artifacts</strong>
                        {artifacts.map((artifact) => {
                          const artifactId = String(artifact.artifact_id ?? artifact.artifactId);
                          const key = `${run.run_id}:${artifactId}`;
                          const preview = artifactPreviews[key];
                          return (
                            <div key={artifactId} className="run-history__artifact">
                              <div className="run-history__artifact-head">
                                <span>{String(artifact.title ?? artifact.type ?? "Artifact")}</span>
                                <button
                                  type="button"
                                  className="agent-btn agent-btn--secondary"
                                  onClick={() => void loadArtifactPreview(run, artifactId)}
                                  disabled={artifactLoading === key}
                                >
                                  {artifactLoading === key ? "读取中…" : preview ? "刷新预览" : "预览"}
                                </button>
                              </div>
                              {preview && <pre className="run-history__artifact-preview">{formatArtifactPreview(preview)}</pre>}
                              {preview?.dataTruncated && <small className="run-history__artifact-note">仅显示受限预览，正文未加载。</small>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {artifactError && <p className="run-history__artifact-error" role="alert">{artifactError}</p>}
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
