/**
 * stepGraph — build a layered DAG from Agent session state.
 *
 * Turns the linear plan/runLog/timeline state into a graph of steps so the
 * panel can render a visual step-flow (DAG). Layers are assigned by stage:
 *   0 = plan steps, 1 = tool executions, 2 = validation, 3 = results.
 * Edges connect steps within a stage (chain) and the last step of a stage to
 * the first step of the next stage (handoff). Stages that have no data are
 * simply omitted, so the graph never renders empty columns.
 */

import type { PlanRow, RunLogRow, TimelineEvent } from "./responseTypes";
import type { RequestPhase } from "./useAgentSession";

export type StepTone = "done" | "active" | "waiting" | "error" | "skipped";

export interface StepNode {
  id: string;
  layer: number;
  order: number;
  label: string;
  tool: string;
  status: StepTone;
  detail?: string;
}

export interface StepEdge {
  from: string;
  to: string;
  /** true when both endpoints live in the same layer (chain edge). */
  vertical: boolean;
  /**
   * true for explicit ``dependsOn`` edges from LLM-planned executions. These
   * render dashed so the viewer can distinguish declared dependencies from
   * the derived chain/handoff edges (design doc §6.2).
   */
  dashed?: boolean;
}

export interface StepGraph {
  nodes: StepNode[];
  edges: StepEdge[];
}

export type ValidationStepStatus = "idle" | "running" | "completed" | "error";

export interface BuildStepGraphOptions {
  plan: PlanRow[];
  runLog: RunLogRow[];
  timeline: TimelineEvent[];
  phase: RequestPhase;
  validationStatus: ValidationStepStatus;
  hasResults: boolean;
}

function planTone(status: string): StepTone {
  if (status === "completed" || status === "done") return "done";
  if (status === "active" || status === "running") return "active";
  if (status === "error" || status === "failed") return "error";
  if (status === "skipped") return "skipped";
  return "waiting";
}

function runTone(status: string): StepTone {
  if (status === "completed" || status === "done") return "done";
  if (status === "running" || status === "active") return "active";
  if (status === "failed" || status === "error") return "error";
  return "waiting";
}

/** Map timeline events to additional tool observations when runLog is sparse. */
function timelineToolNodes(timeline: TimelineEvent[]): Array<{
  tool: string;
  status: string;
  summary: string;
}> {
  const seen = new Set<string>();
  const rows: Array<{ tool: string; status: string; summary: string }> = [];
  for (const event of timeline) {
    if (!event.tool) continue;
    if (seen.has(event.tool)) continue;
    seen.add(event.tool);
    rows.push({
      tool: event.tool,
      status: event.status,
      summary: event.summary,
    });
  }
  return rows;
}

/**
 * Build a layered step graph from Agent session state.
 *
 * The returned graph only contains stages with real data, but each stage keeps
 * its canonical layer index (0 = plan, 1 = tools, 2 = validation, 3 = results)
 * so column titles never drift when an empty stage is omitted:
 * - plan rows become plan nodes (chain within layer 0)
 * - runLog rows become tool nodes; if runLog is empty, timeline tool events
 *   are used as a fallback so the tool stage still appears
 * - a validation node appears whenever validation has started
 * - a results node appears whenever results exist
 */
export function buildStepGraph(options: BuildStepGraphOptions): StepGraph {
  const nodes: StepNode[] = [];
  const edges: StepEdge[] = [];
  const layers: string[][] = [];

  // Stage 0 — plan steps
  const planIds: string[] = [];
  options.plan.forEach((row, index) => {
    const id = `plan-${index}`;
    nodes.push({
      id,
      layer: 0,
      order: index,
      label: row.label || `Step ${index + 1}`,
      tool: row.tool,
      status: planTone(row.status),
      detail: row.summary || undefined,
    });
    planIds.push(id);
  });
  if (planIds.length > 0) layers.push(planIds);

  // Stage 1 — tool executions (runLog first, timeline fallback)
  const toolIds: string[] = [];
  if (options.runLog.length > 0) {
    options.runLog.forEach((row, index) => {
      // The synthetic ``llm_planner`` row (P2 ReAct-lite re-plan) is surfaced
      // by the runLog badge and timeline, not as a real tool step in the DAG.
      if (row.tool === "llm_planner") return;
      const id = `tool-${index}`;
      nodes.push({
        id,
        layer: 1,
        order: index,
        label: row.tool || row.step || `Tool ${index + 1}`,
        tool: row.tool,
        status: runTone(row.status),
        detail: row.message || undefined,
      });
      toolIds.push(id);
    });
  } else {
    timelineToolNodes(options.timeline).forEach((row, index) => {
      const id = `tool-${index}`;
      nodes.push({
        id,
        layer: 1,
        order: index,
        label: row.tool,
        tool: row.tool,
        status: runTone(row.status),
        detail: row.summary || undefined,
      });
      toolIds.push(id);
    });
  }
  if (toolIds.length > 0) layers.push(toolIds);

  // Stage 2 — validation
  const validationIds: string[] = [];
  if (options.validationStatus !== "idle") {
    const id = "validation";
    const running = options.validationStatus === "running";
    nodes.push({
      id,
      layer: 2,
      order: 0,
      label: "Validation",
      tool: "check",
      status: options.validationStatus === "error"
        ? "error"
        : running
          ? "active"
          : "done",
      detail:
        options.validationStatus === "error"
          ? "Remote validation failed"
          : running
            ? "Running remote specificity / off-target check"
            : "Remote validation complete",
    });
    validationIds.push(id);
    layers.push(validationIds);
  }

  // Stage 3 — results
  const resultIds: string[] = [];
  if (options.hasResults) {
    const id = "results";
    nodes.push({
      id,
      layer: 3,
      order: 0,
      label: "Results",
      tool: "results",
      status: options.phase === "executing" ? "active" : "done",
    });
    resultIds.push(id);
    layers.push(resultIds);
  }

  // Edges: chain within a stage + handoff to the next stage. The layers array
  // is ordered (plan < tools < validation < results) because stages are pushed
  // in canonical order, so cross-layer handoffs always connect the last node
  // of an earlier stage to the first node of the next present stage.
  for (let layer = 0; layer < layers.length; layer += 1) {
    const ids = layers[layer]!;
    for (let index = 0; index < ids.length - 1; index += 1) {
      edges.push({ from: ids[index]!, to: ids[index + 1]!, vertical: true });
    }
    if (layer < layers.length - 1) {
      edges.push({ from: ids[ids.length - 1]!, to: layers[layer + 1]![0]!, vertical: false });
    }
  }

  // Explicit dependsOn edges from LLM-planned executions (design doc §6.1).
  // Plan rows carry ``dependsOn`` as tool names of prerequisite steps; resolve
  // them to the corresponding plan node ids and add dashed edges.  Deduplicate
  // against the derived edges above so identical connections render once.
  const toolToPlanId = new Map<string, string>();
  options.plan.forEach((row, index) => {
    if (row.tool) toolToPlanId.set(row.tool, `plan-${index}`);
  });
  const derived = new Set(edges.map((edge) => `${edge.from}>${edge.to}`));
  options.plan.forEach((row, index) => {
    const toId = `plan-${index}`;
    for (const depTool of row.dependsOn ?? []) {
      const fromId = toolToPlanId.get(depTool);
      if (!fromId || fromId === toId) continue;
      const key = `${fromId}>${toId}`;
      if (derived.has(key)) continue;
      derived.add(key);
      // Both endpoints are plan nodes (layer 0) → same-layer explicit edge.
      edges.push({ from: fromId, to: toId, vertical: true, dashed: true });
    }
  });

  return { nodes, edges };
}
