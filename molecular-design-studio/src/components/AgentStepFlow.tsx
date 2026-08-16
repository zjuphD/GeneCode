import { useEffect, useMemo, useRef, useState } from "react";
import type { NodeTooltipContent } from "../agent/nodeLocate";
import type { RunLogRow, TimelineEvent } from "../agent/responseTypes";
import type { StepGraph, StepNode } from "../agent/stepGraph";
import type { RequestPhase, ValidationStatus } from "../agent/useAgentSession";
import { AgentStepDag } from "./AgentStepDag";

interface AgentStepFlowProps {
  graph: StepGraph;
  phase: RequestPhase;
  validationStatus: ValidationStatus;
  runLog: RunLogRow[];
  timeline: TimelineEvent[];
  isBusy: boolean;
  hasCompletedResult: boolean;
  error: string | null;
  onNodeClick?: (node: StepNode) => void;
  clickableNodeIds?: ReadonlySet<string>;
  nodeTooltips?: ReadonlyMap<string, NodeTooltipContent>;
}

function nodeTone(node: StepNode): string {
  return `agent-step-flow__event--${node.status}`;
}

function toneIcon(status: StepNode["status"]): string {
  if (status === "done") return "✓";
  if (status === "error") return "!";
  if (status === "active") return "·";
  return "○";
}

function statusText(
  isBusy: boolean,
  hasCompletedResult: boolean,
  error: string | null,
  hasActivity: boolean,
): string {
  if (error) return "执行失败";
  if (isBusy) return "处理中…";
  if (hasCompletedResult) return "处理完成";
  if (hasActivity) return "处理完成";
  return "等待 Agent";
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function eventLabel(node: StepNode): string {
  if (node.layer === 2) return "验证结果";
  if (node.layer === 3) return "结果可用";
  return node.label || node.tool || "执行步骤";
}

function nodeDetail(node: StepNode): string | null {
  if (node.detail) return node.detail;
  if (node.tool && node.tool !== node.label) return node.tool;
  return null;
}

function uniqueToolCount(runLog: RunLogRow[], timeline: TimelineEvent[]): number {
  const tools = new Set<string>();
  for (const row of runLog) {
    if (row.tool && row.tool !== "llm_planner") tools.add(row.tool);
  }
  for (const event of timeline) {
    if (event.tool && event.tool !== "llm_planner") tools.add(event.tool);
  }
  return tools.size;
}

function EventRow({
  node,
  onNodeClick,
  clickable,
  tooltip,
}: {
  node: StepNode;
  onNodeClick?: (node: StepNode) => void;
  clickable: boolean;
  tooltip?: NodeTooltipContent;
}) {
  const content = (
    <>
      <span className="agent-step-flow__event-icon" aria-hidden="true">
        {toneIcon(node.status)}
      </span>
      <span className="agent-step-flow__event-copy">
        <span className="agent-step-flow__event-title">
          {eventLabel(node)}
          {node.tool && node.tool !== eventLabel(node) && (
            <code>{node.tool}</code>
          )}
        </span>
        {nodeDetail(node) && (
          <span className="agent-step-flow__event-detail">{nodeDetail(node)}</span>
        )}
      </span>
    </>
  );

  if (clickable && onNodeClick) {
    return (
      <button
        type="button"
        className={`agent-step-flow__event ${nodeTone(node)} agent-step-flow__event--actionable`}
        data-step-id={node.id}
        title={tooltip?.lines.join(" · ")}
        onClick={() => onNodeClick(node)}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={`agent-step-flow__event ${nodeTone(node)}`} data-step-id={node.id}>
      {content}
    </div>
  );
}

/**
 * Chat-like execution stream. The graph remains mounted as an invisible
 * compatibility surface for existing locate/tooltip behavior, while this
 * renderer is the user-facing Step flow: status, elapsed thinking time,
 * compact tool summaries, and each step as it arrives from the stream.
 */
export function AgentStepFlow({
  graph,
  phase,
  validationStatus,
  runLog,
  timeline,
  isBusy,
  hasCompletedResult,
  error,
  onNodeClick,
  clickableNodeIds,
  nodeTooltips,
}: AgentStepFlowProps) {
  const startedAtRef = useRef<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!isBusy) {
      startedAtRef.current = null;
      setElapsedSeconds(0);
      return undefined;
    }
    if (startedAtRef.current === null) startedAtRef.current = Date.now();
    const update = () => {
      const startedAt = startedAtRef.current ?? Date.now();
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [isBusy]);

  const toolCount = uniqueToolCount(runLog, timeline);
  const completedTools = runLog.filter((row) =>
    ["completed", "success", "done"].includes(row.status),
  ).length;
  const summary = runLog.length > 0 || timeline.length > 0
    ? `已处理 ${completedTools || runLog.length || timeline.length} 个步骤 · 调用了 ${toolCount} 个工具`
    : graph.nodes.length > 0
      ? `已生成 ${graph.nodes.filter((node) => node.layer === 0).length} 个步骤 · 等待执行`
      : null;

  // Once tool events exist, show the tool stream as the primary narrative and
  // avoid repeating the same plan rows above it. During planning, the plan
  // rows remain visible until the first tool event arrives.
  const visibleNodes = graph.nodes.filter((node) => runLog.length === 0 || node.layer !== 0);

  const activeNode = visibleNodes.find((node) => node.status === "active");
  const thought = isBusy
    ? phase === "planning"
      ? "正在读取序列上下文，整理目标并生成可执行计划。"
      : activeNode
        ? `正在${eventLabel(activeNode)}，等待工具返回。`
        : validationStatus === "running"
          ? "正在验证候选结果和序列特异性。"
          : "正在执行序列分析。"
    : null;

  const timelineSummaries = useMemo(() => {
    const nodeDetails = new Set(graph.nodes.map((node) => node.detail).filter(Boolean));
    const seen = new Set<string>();
    return timeline.filter((event) => {
      const summaryText = event.summary.trim();
      if (!summaryText || nodeDetails.has(summaryText) || seen.has(summaryText)) return false;
      seen.add(summaryText);
      return true;
    });
  }, [graph.nodes, timeline]);

  return (
    <section className="agent-step-flow" aria-label="Step flow">
      <div className="agent-step-flow__status" aria-live="polite">
        <span className="agent-step-flow__label">Step flow</span>
        <span className={`agent-step-flow__status-mark${isBusy ? " agent-step-flow__status-mark--busy" : ""}`} aria-hidden="true">
          {isBusy ? "✦" : error ? "!" : hasCompletedResult ? "✓" : "·"}
        </span>
        <strong>{statusText(isBusy, hasCompletedResult, error, graph.nodes.length > 0)}</strong>
        {isBusy && <span className="agent-step-flow__elapsed">思考 {formatElapsed(elapsedSeconds)}</span>}
      </div>

      {thought && <p className="agent-step-flow__thought">{thought}</p>}

      {summary && (
        <div className="agent-step-flow__summary" aria-live="polite">
          <span className="agent-step-flow__summary-icon" aria-hidden="true">⌁</span>
          <span>{summary}</span>
        </div>
      )}

      {graph.nodes.length === 0 && isBusy && (
        <div className="agent-step-flow__waiting" role="status">
          <span className="agent-step-flow__waiting-dot" aria-hidden="true" />
          <span>等待 Agent 事件</span>
        </div>
      )}

      <div className="agent-step-flow__events" aria-live="polite" aria-atomic="false">
        {visibleNodes.map((node) => (
          <EventRow
            key={node.id}
            node={node}
            onNodeClick={onNodeClick}
            clickable={Boolean(clickableNodeIds?.has(node.id))}
            tooltip={nodeTooltips?.get(node.id)}
          />
        ))}
        {timelineSummaries.map((event) => (
          <div key={event.event_id || `${event.type}-${event.summary}`} className="agent-step-flow__timeline-event">
            <span className="agent-step-flow__event-icon" aria-hidden="true">⌁</span>
            <span className="agent-step-flow__event-copy">
              <span className="agent-step-flow__event-detail">{event.summary}</span>
            </span>
          </div>
        ))}
      </div>

      {isBusy && (
        <div className="agent-step-flow__thinking" role="status" aria-live="polite">
          <span aria-hidden="true">✦</span>
          <span>思考中···</span>
        </div>
      )}

      {/* Retain the graph for locate/tooltip regression coverage without
          exposing the dense DAG as a second visual workflow. */}
      <div className="agent-step-flow__legacy-graph" aria-hidden="true">
        <AgentStepDag
          graph={graph}
          onNodeClick={onNodeClick}
          clickableNodeIds={clickableNodeIds}
          nodeTooltips={nodeTooltips}
        />
      </div>
    </section>
  );
}
