/**
 * AgentStepDag — visual step-flow (DAG) for the Agent panel.
 *
 * Renders the layered graph produced by buildStepGraph as positioned nodes
 * with SVG connector edges. Layers are rendered as columns; nodes within a
 * layer are stacked top-to-bottom and centered. Edges are cubic Bézier curves
 * drawn between node anchors in a stretched viewBox so the graph scales with
 * the panel width without re-measuring the DOM.
 */

import { useEffect, useId, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import type { StepGraph, StepNode, StepTone } from "../agent/stepGraph";
import type { NodeTooltipContent } from "../agent/nodeLocate";

const TONE_CLASS: Record<StepTone, string> = {
  done: "agent-step-dag__node--done",
  active: "agent-step-dag__node--active",
  waiting: "agent-step-dag__node--waiting",
  error: "agent-step-dag__node--error",
  skipped: "agent-step-dag__node--skipped",
};

const TONE_LABEL: Record<StepTone, string> = {
  done: "done",
  active: "running",
  waiting: "waiting",
  error: "failed",
  skipped: "skipped",
};

interface PositionedNode {
  id: string;
  layer: number;
  order: number;
  x: number; // percent (0-100)
  y: number; // percent (0-100)
  label: string;
  tool: string;
  status: StepTone;
  detail?: string;
  toneLabel: string;
}

interface PositionedEdge {
  from: string;
  to: string;
  vertical: boolean;
  dashed?: boolean;
}

/** Unique key for an edge, used to track the open dependency popover. */
function edgeKey(edge: PositionedEdge): string {
  return `${edge.from}>${edge.to}`;
}

/** Status tone class for the dependency-edge popover status badge. */
const POPOVER_TONE_CLASS: Record<StepTone, string> = {
  done: "agent-step-dag__edge-popover-status--done",
  active: "agent-step-dag__edge-popover-status--active",
  waiting: "agent-step-dag__edge-popover-status--waiting",
  error: "agent-step-dag__edge-popover-status--error",
  skipped: "agent-step-dag__edge-popover-status--skipped",
};

interface Layout {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  /** Ordered layer ids for the column headers. */
  layers: string[];
}

/**
 * Lay out the graph in unit space (0-100) so the SVG can use a stretched
 * viewBox. Each layer is one column; nodes in a column are evenly spaced.
 */
function layoutGraph(graph: StepGraph): Layout {
  const layerIds: string[] = [];
  for (const node of graph.nodes) {
    if (!layerIds.includes(String(node.layer))) layerIds.push(String(node.layer));
  }
  layerIds.sort((a, b) => Number(a) - Number(b));

  const countByLayer = new Map<string, number>();
  for (const node of graph.nodes) {
    countByLayer.set(String(node.layer), (countByLayer.get(String(node.layer)) ?? 0) + 1);
  }

  const layerCount = Math.max(1, layerIds.length);    const nodes: PositionedNode[] = graph.nodes.map((node) => {
    const layerIndex = layerIds.indexOf(String(node.layer));
    const count = countByLayer.get(String(node.layer)) ?? 1;
    const x = layerCount === 1 ? 50 : (layerIndex / (layerCount - 1)) * 100;
    const y = count === 1 ? 50 : (node.order / (count - 1)) * 100;
    return {
      id: node.id,
      layer: node.layer,
      order: node.order,
      x,
      y,
      label: node.label,
      tool: node.tool,
      status: node.status,
      detail: node.detail,
      toneLabel: TONE_LABEL[node.status],
    };
  });

  const edges: PositionedEdge[] = graph.edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    vertical: edge.vertical,
    dashed: edge.dashed,
  }));

  return { nodes, edges, layers: layerIds };
}

/** Build an SVG path between two nodes with an orthogonal-ish Bézier. */
function edgePath(
  from: PositionedNode,
  to: PositionedNode,
  vertical: boolean,
): string {
  if (vertical) {
    const x = from.x;
    const y1 = from.y;
    const y2 = to.y;
    const mid = (y1 + y2) / 2;
    return `M ${x} ${y1} C ${x} ${mid}, ${x} ${mid}, ${x} ${y2}`;
  }
  // Horizontal handoff: route from the source edge toward the target's y so
  // the arrow lands on the target node even when layers have different counts.
  const x1 = from.x;
  const x2 = to.x;
  const y1 = from.y;
  const y2 = to.y;
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

const LAYER_TITLES: Record<string, string> = {
  "0": "Plan",
  "1": "Tools",
  "2": "Validation",
  "3": "Results",
};

function layerTitle(layer: string): string {
  return LAYER_TITLES[layer] ?? `Stage ${Number(layer) + 1}`;
}

/** Rebuild the source StepNode shape from a positioned node for clickbacks. */
function toStepNode(node: PositionedNode): StepNode {
  return {
    id: node.id,
    layer: node.layer,
    order: node.order,
    label: node.label,
    tool: node.tool,
    status: node.status,
    detail: node.detail,
  };
}

function NodeTooltip({ content, id, alignRight }: {
  content: NodeTooltipContent;
  id: string;
  alignRight?: boolean;
}) {
  return (
    <span
      id={id}
      className={`agent-step-dag__tooltip${alignRight ? " agent-step-dag__tooltip--align-right" : ""}`}
      role="tooltip"
    >
      {content.lines.map((line, index) => (
        <span key={index} className="agent-step-dag__tooltip-line">{line}</span>
      ))}
      <span className="agent-step-dag__tooltip-hint">{content.hint}</span>
    </span>
  );
}

/**
 * Render the Agent step graph. Collapses to a single centered node when the
 * graph has exactly one node; otherwise renders the layered DAG.
 *
 * Nodes listed in `clickableNodeIds` are rendered as buttons so the panel can
 * locate the corresponding result region in the editor when clicked. When
 * `nodeTooltips` provides content for a node id, the button shows a hover
 * tooltip summarizing the locatable regions.
 */
export function AgentStepDag({
  graph,
  onNodeClick,
  clickableNodeIds,
  nodeTooltips,
}: {
  graph: StepGraph;
  /** Fired with the node when a clickable node is activated. */
  onNodeClick?: (node: StepNode) => void;
  /** Node ids rendered as interactive buttons (locate-in-editor actions). */
  clickableNodeIds?: ReadonlySet<string>;
  /** Per-node hover tooltip content for clickable nodes. */
  nodeTooltips?: ReadonlyMap<string, NodeTooltipContent>;
}) {
  const gradientId = useId().replace(/:/g, "");
  const { nodes, edges, layers } = layoutGraph(graph);

  // Dependency-edge popover: clicking a dashed (dependsOn) edge opens a
  // tooltip summarizing the upstream step. Tracked by edge key so the popover
  // survives re-renders; Esc and any other click close it.
  const [openEdgeKey, setOpenEdgeKey] = useState<string | null>(null);

  useEffect(() => {
    if (!openEdgeKey) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenEdgeKey(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openEdgeKey]);

  if (nodes.length === 0) return null;

  const nodeClasses = (node: PositionedNode) =>
    `agent-step-dag__node ${TONE_CLASS[node.status]}${clickableNodeIds?.has(node.id) ? " agent-step-dag__node--actionable" : ""}`;
  const nodeAttrs = (node: PositionedNode) => ({
    "data-step-id": node.id,
    className: nodeClasses(node),
    title: depTitle(node),
    // Per-node CSS variable: staggered pop-in + animation delays keyed off the
    // node's position within its layer so the graph fills in left-to-right.
    style: { "--node-order": node.order } as CSSProperties,
  });
  const rightmostLayer = nodes.reduce((max, node) => Math.max(max, node.layer), -Infinity);
  const tooltipFor = (node: PositionedNode) => {
    const content = nodeTooltips?.get(node.id);
    if (!clickableNodeIds?.has(node.id) || !content) return null;
    return {
      content,
      id: `step-tooltip-${node.id}`,
      alignRight: node.layer === rightmostLayer,
    };
  };

  // Count incoming dashed (explicit dependsOn) edges per node so the node can
  // surface its declared prerequisites (design doc §6.2).
  const incomingDeps = new Map<string, number>();
  for (const edge of edges) {
    if (!edge.dashed) continue;
    incomingDeps.set(edge.to, (incomingDeps.get(edge.to) ?? 0) + 1);
  }
  const depTitle = (node: PositionedNode) => {
    const count = incomingDeps.get(node.id);
    return count ? `依赖 ${count} 个前置步骤` : undefined;
  };

  // Popover summarizing the upstream step of the open dependency edge. It is
  // anchored to the edge midpoint (unit-space %, matching the stretched
  // viewBox) so it stays attached to the connection regardless of layout.
  const edgePopover = (() => {
    if (!openEdgeKey) return null;
    const [fromId, toId] = openEdgeKey.split(">") as [string, string];
    const edge = edges.find((candidate) => edgeKey(candidate) === openEdgeKey);
    const from = nodes.find((node) => node.id === fromId);
    const to = nodes.find((node) => node.id === toId);
    if (!edge || !from || !to) return null;
    const x = edge.vertical ? from.x : (from.x + to.x) / 2;
    const y = (from.y + to.y) / 2;
    return (
      <div
        className="agent-step-dag__edge-popover"
        style={{ left: `${x}%`, top: `${y}%` }}
        role="tooltip"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="agent-step-dag__edge-popover-title">LLM 依赖关系</span>
        <div className="agent-step-dag__edge-popover-row">
          <span className="agent-step-dag__edge-popover-role">上游步骤</span>
          <code className="agent-step-dag__edge-popover-tool">
            {from.tool || from.label}
          </code>
          <span
            className={`agent-step-dag__edge-popover-status ${POPOVER_TONE_CLASS[from.status]}`}
          >
            {from.toneLabel}
          </span>
          {from.detail && (
            <span className="agent-step-dag__edge-popover-summary">{from.detail}</span>
          )}
        </div>
        <div className="agent-step-dag__edge-popover-row">
          <span className="agent-step-dag__edge-popover-role">下游步骤</span>
          <strong className="agent-step-dag__edge-popover-label">{to.label}</strong>
          {to.tool && <code className="agent-step-dag__edge-popover-tool">{to.tool}</code>}
        </div>
        <span className="agent-step-dag__edge-popover-hint">
          虚线边表示 LLM 显式声明的依赖 · 点击边或按 Esc 关闭
        </span>
      </div>
    );
  })();

  if (nodes.length === 1) {
    const node = nodes[0]!;
    const clickable = clickableNodeIds?.has(node.id);
    const tooltip = tooltipFor(node);
    const content = (
      <>
        <span className="agent-step-dag__status">{node.toneLabel}</span>
        <strong className="agent-step-dag__label">{node.label}</strong>
        {node.tool && <code className="agent-step-dag__tool">{node.tool}</code>}
        {node.detail && <span className="agent-step-dag__detail">{node.detail}</span>}
        {tooltip && <NodeTooltip {...tooltip} />}
      </>
    );
    return (
      <div className="agent-step-dag agent-step-dag--single">
        {clickable ? (
          <button
            type="button"
            {...nodeAttrs(node)}
            onClick={() => onNodeClick?.(toStepNode(node))}
            aria-label={`Locate ${node.label} in editor`}
            aria-describedby={tooltip ? tooltip.id : undefined}
          >
            {content}
          </button>
        ) : (
          <div {...nodeAttrs(node)}>{content}</div>
        )}
      </div>
    );
  }

  return (
    <div className="agent-step-dag" onClick={() => setOpenEdgeKey(null)}>
      <svg
        className="agent-step-dag__svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        focusable="false"
      >
        <defs aria-hidden="true">
          <marker
            id={`${gradientId}-arrow`}
            markerWidth="6"
            markerHeight="6"
            refX="5"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6 z" className="agent-step-dag__arrow" />
          </marker>
        </defs>
        {edges.map((edge) => {
          const from = nodes.find((node) => node.id === edge.from);
          const to = nodes.find((node) => node.id === edge.to);
          if (!from || !to) return null;
          const dashed = edge.dashed === true;
          const key = edgeKey(edge);
          return (
            <path
              key={key}
              d={edgePath(from, to, edge.vertical)}
              className={`agent-step-dag__edge${dashed ? " agent-step-dag__edge--dependency" : ""}${!dashed && (to.status === "done" || to.status === "active") ? " agent-step-dag__edge--drawn" : ""}`}
              pathLength={1}
              markerEnd={`url(#${gradientId}-arrow)`}
              aria-hidden={!dashed}
              role={dashed ? "button" : undefined}
              tabIndex={dashed ? 0 : undefined}
              aria-label={dashed ? `显示依赖关系：${from.label} → ${to.label}` : undefined}
              aria-expanded={dashed ? openEdgeKey === key : undefined}
              data-edge-key={dashed ? key : undefined}
              onClick={
                dashed
                  ? (event: ReactMouseEvent<SVGPathElement>) => {
                      event.stopPropagation();
                      setOpenEdgeKey((current) => (current === key ? null : key));
                    }
                  : undefined
              }
              onKeyDown={
                dashed
                  ? (event: ReactKeyboardEvent<SVGPathElement>) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setOpenEdgeKey((current) => (current === key ? null : key));
                      }
                    }
                  : undefined
              }
            />
          );
        })}
      </svg>
      {edgePopover}
      {layers.map((layer) => (
        <div key={layer} className="agent-step-dag__layer">
          <span className="agent-step-dag__layer-title">{layerTitle(layer)}</span>
          {nodes
            .filter((node) => String(node.layer) === layer)
            .map((node) => {
              const clickable = clickableNodeIds?.has(node.id);
              const tooltip = tooltipFor(node);
              const content = (
                <>
                  <span className="agent-step-dag__status">{node.toneLabel}</span>
                  <strong className="agent-step-dag__label" title={node.label}>
                    {node.label}
                  </strong>
                  {node.tool && <code className="agent-step-dag__tool">{node.tool}</code>}
                  {node.detail && (
                    <span className="agent-step-dag__detail" title={node.detail}>
                      {node.detail}
                    </span>
                  )}
                  {tooltip && <NodeTooltip {...tooltip} />}
                </>
              );
              return clickable ? (
                <button
                  key={node.id}
                  type="button"
                  {...nodeAttrs(node)}
                  onClick={() => onNodeClick?.(toStepNode(node))}
                  aria-label={`Locate ${node.label} in editor`}
                  aria-describedby={tooltip ? tooltip.id : undefined}
                >
                  {content}
                </button>
              ) : (
                <div key={node.id} {...nodeAttrs(node)}>
                  {content}
                </div>
              );
            })}
        </div>
      ))}
    </div>
  );
}
