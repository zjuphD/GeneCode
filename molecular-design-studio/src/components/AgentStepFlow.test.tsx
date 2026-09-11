import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { buildStepGraph } from "../agent/stepGraph";
import { AgentStepFlow } from "./AgentStepFlow";

function emptyGraph() {
  return buildStepGraph({
    plan: [],
    runLog: [],
    timeline: [],
    phase: "planning",
    validationStatus: "idle",
    hasResults: false,
  });
}

describe("AgentStepFlow", () => {
  it("expands failed tool records without hiding the failure state", () => {
    const { getByRole } = render(<AgentStepFlow graph={emptyGraph()} phase="idle" validationStatus="idle" runLog={[]} timeline={[]} isBusy={false} hasCompletedResult={false} error="Service unavailable" />);
    const flow = getByRole("region", { name: "任务流程" });
    expect(flow.querySelector("details")?.open).toBe(true);
    expect(within(flow).getByText("执行失败")).toBeDefined();
  });
  it("shows the chat-like thinking and waiting state before the first event", () => {
    const { getByRole, getByText } = render(
      <AgentStepFlow
        graph={emptyGraph()}
        phase="planning"
        validationStatus="idle"
        runLog={[]}
        timeline={[]}
        isBusy
        hasCompletedResult={false}
        error={null}
      />,
    );

    const flow = getByRole("region", { name: "任务流程" });
    expect(within(flow).getByText("处理中…")).toBeDefined();
    expect(within(flow).getByText("等待 Agent 事件")).toBeDefined();
    expect(flow.querySelector('.agent-step-flow__thought[role="status"]')?.textContent).toContain("正在读取序列上下文");
    expect(flow.querySelector("details")?.open).toBe(false);
    expect(getByText("正在读取序列上下文，整理目标并生成可执行计划。")).toBeDefined();
  });

  it("renders tool events as a compact stream and removes duplicate plan rows", () => {
    const graph = buildStepGraph({
      plan: [{ label: "读取序列", tool: "read_open_sequence", status: "done", summary: "" }],
      runLog: [{ step: "读取序列", tool: "read_open_sequence", status: "running", message: "正在读取" }],
      timeline: [],
      phase: "executing",
      validationStatus: "idle",
      hasResults: false,
    });
    const { getByRole } = render(
      <AgentStepFlow
        graph={graph}
        phase="executing"
        validationStatus="idle"
        runLog={[{ step: "读取序列", tool: "read_open_sequence", status: "running", message: "正在读取" }]}
        timeline={[]}
        isBusy
        hasCompletedResult={false}
        error={null}
      />,
    );

    const flow = getByRole("region", { name: "任务流程" });
    const events = flow.querySelector(".agent-step-flow__events") as HTMLElement;
    expect(within(events).getByText("读取当前序列")).toBeDefined();
    expect(within(events).getByText("正在读取")).toBeDefined();
    expect(events.textContent).not.toContain("read_open_sequence");
  });

  it("keeps locate actions on streamed tool events", () => {
    const graph = buildStepGraph({
      plan: [],
      runLog: [{ step: "1", tool: "primer3", status: "success", message: "found 1" }],
      timeline: [],
      phase: "idle",
      validationStatus: "idle",
      hasResults: false,
    });
    const onNodeClick = vi.fn();
    const { getByRole } = render(
      <AgentStepFlow
        graph={graph}
        phase="idle"
        validationStatus="idle"
        runLog={[{ step: "1", tool: "primer3", status: "success", message: "found 1" }]}
        timeline={[]}
        isBusy={false}
        hasCompletedResult={false}
        error={null}
        onNodeClick={onNodeClick}
        clickableNodeIds={new Set(["tool-0"])}
      />,
    );

    const flow = getByRole("region", { name: "任务流程" });
    const tool = flow.querySelector(".agent-step-flow__events [data-step-id=\"tool-0\"]");
    expect(tool?.tagName).toBe("BUTTON");
    fireEvent.click(tool as Element);
    expect(onNodeClick).toHaveBeenCalledWith(expect.objectContaining({ tool: "primer3" }));
  });
});
