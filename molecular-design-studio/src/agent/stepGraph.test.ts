/**
 * Tests for the step-DAG builder used by the visual step-flow view.
 */

import { describe, it, expect } from "vitest";
import { buildStepGraph } from "./stepGraph";
import type { PlanRow, RunLogRow, TimelineEvent } from "./responseTypes";

const plan = (rows: PlanRow[]) => rows;
const runLog = (rows: RunLogRow[]) => rows;
const timeline = (rows: TimelineEvent[]) => rows;

describe("buildStepGraph", () => {
  it("returns an empty graph when there is no activity", () => {
    const graph = buildStepGraph({
      plan: [],
      runLog: [],
      timeline: [],
      phase: "idle",
      validationStatus: "idle",
      hasResults: false,
    });
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it("creates plan nodes chained in layer 0", () => {
    const graph = buildStepGraph({
      plan: plan([
        { label: "Analyze", tool: "analyze", status: "pending", summary: "" },
        { label: "Design", tool: "primer3", status: "pending", summary: "" },
      ]),
      runLog: [],
      timeline: [],
      phase: "planning",
      validationStatus: "idle",
      hasResults: false,
    });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[0]!.layer).toBe(0);
    expect(graph.nodes[1]!.layer).toBe(0);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ from: "plan-0", to: "plan-1", vertical: true });
  });

  it("creates tool nodes from runLog in layer 1 with a handoff edge", () => {
    const graph = buildStepGraph({
      plan: plan([{ label: "Plan", tool: "plan", status: "done", summary: "" }]),
      runLog: runLog([{ step: "1", tool: "primer3", status: "success", message: "ok" }]),
      timeline: [],
      phase: "idle",
      validationStatus: "idle",
      hasResults: false,
    });
    expect(graph.nodes).toHaveLength(2);
    const tool = graph.nodes.find((node) => node.id === "tool-0");
    expect(tool).toBeDefined();
    expect(tool!.layer).toBe(1);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ from: "plan-0", to: "tool-0", vertical: false }),
    );
  });

  it("excludes synthetic llm_planner replan rows from the tool stage", () => {
    const graph = buildStepGraph({
      plan: plan([{ label: "解析序列", tool: "parse_sequence", status: "done", summary: "" }]),
      runLog: runLog([
        { step: "解析序列", tool: "parse_sequence", status: "failed", message: "长度不足 30 bp。" },
        { step: "LLM 重新规划", tool: "llm_planner", status: "completed", message: "失败后重规划完成，共 1 个新步骤。" },
        { step: "设计引物", tool: "design_rtqpcr", status: "completed", message: "引物设计完成。" },
      ]),
      timeline: [],
      phase: "idle",
      validationStatus: "idle",
      hasResults: false,
    });
    // Plan node + the two real tool rows only — no llm_planner node.
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes.some((node) => node.tool === "llm_planner")).toBe(false);
    expect(graph.nodes.some((node) => node.tool === "parse_sequence")).toBe(true);
    expect(graph.nodes.some((node) => node.tool === "design_rtqpcr")).toBe(true);
  });

  it("falls back to timeline tool events when runLog is empty", () => {
    const graph = buildStepGraph({
      plan: [],
      runLog: [],
      timeline: timeline([
        { event_id: "e1", type: "step", tool: "blast", status: "ok", summary: "checked", timestamp: 1 },
        { event_id: "e2", type: "step", tool: "blast", status: "ok", summary: "checked", timestamp: 2 },
      ]),
      phase: "idle",
      validationStatus: "idle",
      hasResults: false,
    });
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]!.label).toBe("blast");
  });

  it("adds a validation node when validation has started", () => {
    const graph = buildStepGraph({
      plan: [],
      runLog: runLog([{ step: "1", tool: "primer3", status: "success", message: "ok" }]),
      timeline: [],
      phase: "idle",
      validationStatus: "running",
      hasResults: false,
    });
    const validation = graph.nodes.find((node) => node.id === "validation");
    expect(validation).toBeDefined();
    expect(validation!.status).toBe("active");
    // Validation keeps its canonical layer index even when the plan stage is
    // empty and omitted, so column titles never drift.
    expect(validation!.layer).toBe(2);
  });

  it("marks completed validation as done", () => {
    const graph = buildStepGraph({
      plan: [],
      runLog: [],
      timeline: [],
      phase: "idle",
      validationStatus: "completed",
      hasResults: false,
    });
    const validation = graph.nodes.find((node) => node.id === "validation");
    expect(validation).toBeDefined();
    expect(validation!.status).toBe("done");
  });

  it("adds a results node when results exist", () => {
    const graph = buildStepGraph({
      plan: [],
      runLog: [],
      timeline: [],
      phase: "idle",
      validationStatus: "idle",
      hasResults: true,
    });
    const results = graph.nodes.find((node) => node.id === "results");
    expect(results).toBeDefined();
    expect(results!.status).toBe("done");
  });

  it("chains validation and results at the end of the flow", () => {
    const graph = buildStepGraph({
      plan: [],
      runLog: runLog([{ step: "1", tool: "primer3", status: "success", message: "ok" }]),
      timeline: [],
      phase: "idle",
      validationStatus: "completed",
      hasResults: true,
    });
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ from: "tool-0", to: "validation", vertical: false }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ from: "validation", to: "results", vertical: false }),
    );
  });

  it("maps plan and run log statuses to tones", () => {
    const graph = buildStepGraph({
      plan: plan([
        { label: "A", tool: "a", status: "done", summary: "" },
        { label: "B", tool: "b", status: "error", summary: "" },
        { label: "C", tool: "c", status: "skipped", summary: "" },
      ]),
      runLog: runLog([
        { step: "1", tool: "t", status: "running", message: "" },
        { step: "2", tool: "u", status: "failed", message: "" },
      ]),
      timeline: [],
      phase: "executing",
      validationStatus: "idle",
      hasResults: false,
    });
    expect(graph.nodes.find((node) => node.id === "plan-0")!.status).toBe("done");
    expect(graph.nodes.find((node) => node.id === "plan-1")!.status).toBe("error");
    expect(graph.nodes.find((node) => node.id === "plan-2")!.status).toBe("skipped");
    expect(graph.nodes.find((node) => node.id === "tool-0")!.status).toBe("active");
    expect(graph.nodes.find((node) => node.id === "tool-1")!.status).toBe("error");
  });

  it("carries plan summary and runLog message into node details", () => {
    const graph = buildStepGraph({
      plan: plan([{ label: "P", tool: "p", status: "done", summary: "checked 3" }]),
      runLog: runLog([{ step: "1", tool: "t", status: "success", message: "found 2" }]),
      timeline: [],
      phase: "idle",
      validationStatus: "idle",
      hasResults: false,
    });
    expect(graph.nodes.find((node) => node.id === "plan-0")!.detail).toBe("checked 3");
    expect(graph.nodes.find((node) => node.id === "tool-0")!.detail).toBe("found 2");
  });

  it("adds dashed dependsOn edges only for non-adjacent LLM dependencies", () => {
    // Adjacent dependsOn (resolve→design, design→check) coincides with the
    // derived chain edge and is deduplicated (non-dashed). Only the skip
    // dependency (resolve→stats) produces a dashed explicit edge.
    const graph = buildStepGraph({
      plan: plan([
        { label: "Resolve", tool: "resolve_rt_target", status: "completed", summary: "" },
        { label: "Design", tool: "design_rtqpcr", status: "completed", summary: "", dependsOn: ["resolve_rt_target"] },
        { label: "Check", tool: "check_rt_specificity", status: "completed", summary: "", dependsOn: ["design_rtqpcr"] },
        { label: "Stats", tool: "sequence_stats", status: "completed", summary: "", dependsOn: ["resolve_rt_target"] },
      ]),
      runLog: [],
      timeline: [],
      phase: "idle",
      validationStatus: "idle",
      hasResults: false,
    });
    const dashed = graph.edges.filter((edge) => edge.dashed);
    expect(dashed).toHaveLength(1);
    expect(dashed).toContainEqual(expect.objectContaining({ from: "plan-0", to: "plan-3", dashed: true }));
    // Adjacent dependencies stayed as the derived non-dashed chain edges.
    const chain = graph.edges.filter((edge) => !edge.dashed);
    expect(chain).toContainEqual(expect.objectContaining({ from: "plan-0", to: "plan-1" }));
    expect(chain).toContainEqual(expect.objectContaining({ from: "plan-1", to: "plan-2" }));
  });

  it("deduplicates dependsOn edges against derived chain edges", () => {
    // Adjacent dependsOn equals the derived chain edge — must render once.
    const graph = buildStepGraph({
      plan: plan([
        { label: "A", tool: "a", status: "done", summary: "" },
        { label: "B", tool: "b", status: "done", summary: "", dependsOn: ["a"] },
      ]),
      runLog: [],
      timeline: [],
      phase: "idle",
      validationStatus: "idle",
      hasResults: false,
    });
    const edges = graph.edges.filter((edge) => edge.from === "plan-0" && edge.to === "plan-1");
    expect(edges).toHaveLength(1);
    expect(edges[0]!.dashed).toBeUndefined(); // kept the non-dashed derived edge
  });

  it("adds a dashed skip edge when dependsOn jumps over a step", () => {
    const graph = buildStepGraph({
      plan: plan([
        { label: "A", tool: "a", status: "done", summary: "" },
        { label: "B", tool: "b", status: "done", summary: "" },
        { label: "C", tool: "c", status: "done", summary: "", dependsOn: ["a"] },
      ]),
      runLog: [],
      timeline: [],
      phase: "idle",
      validationStatus: "idle",
      hasResults: false,
    });
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ from: "plan-0", to: "plan-2", dashed: true }),
    );
  });
});
