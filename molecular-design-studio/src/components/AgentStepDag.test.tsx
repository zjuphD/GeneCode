/**
 * Tests for the AgentStepDag component.
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AgentStepDag } from "./AgentStepDag";
import { buildStepGraph } from "../agent/stepGraph";
import type { PlanRow, RunLogRow } from "../agent/responseTypes";

describe("AgentStepDag", () => {
  it("renders nothing for an empty graph", () => {
    const graph = buildStepGraph({
      plan: [],
      runLog: [],
      timeline: [],
      phase: "idle",
      validationStatus: "idle",
      hasResults: false,
    });
    const { container } = render(<AgentStepDag graph={graph} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a single centered node", () => {
    const graph = buildStepGraph({
      plan: [{ label: "Analyze", tool: "analyze", status: "pending", summary: "" }],
      runLog: [],
      timeline: [],
      phase: "planning",
      validationStatus: "idle",
      hasResults: false,
    });
    render(<AgentStepDag graph={graph} />);
    expect(screen.getByText("Analyze")).toBeDefined();
    expect(screen.getByText("analyze")).toBeDefined();
    expect(screen.getByText("waiting")).toBeDefined();
  });

  it("renders layered nodes with layer titles", () => {
    const graph = buildStepGraph({
      plan: [{ label: "Plan step", tool: "plan", status: "done", summary: "" }],
      runLog: [{ step: "1", tool: "primer3", status: "success", message: "found 3" }],
      timeline: [],
      phase: "idle",
      validationStatus: "completed",
      hasResults: true,
    });
    const { container } = render(<AgentStepDag graph={graph} />);
    // Layer titles are unique
    const titles = Array.from(
      container.querySelectorAll(".agent-step-dag__layer-title"),
    ).map((el) => el.textContent);
    expect(titles).toEqual(["Plan", "Tools", "Validation", "Results"]);
    // Node labels and details
    expect(container.querySelector('[data-step-id="plan-0"]')!.textContent).toContain("Plan step");
    expect(screen.getAllByText("primer3").length).toBeGreaterThan(0);
    expect(screen.getByText("found 3")).toBeDefined();
  });

  it("exposes step ids as data attributes", () => {
    const graph = buildStepGraph({
      plan: [{ label: "Plan", tool: "plan", status: "done", summary: "" }],
      runLog: [{ step: "1", tool: "primer3", status: "running", message: "" }],
      timeline: [],
      phase: "executing",
      validationStatus: "idle",
      hasResults: false,
    });
    const { container } = render(<AgentStepDag graph={graph} />);
    expect(container.querySelector('[data-step-id="plan-0"]')).not.toBeNull();
    expect(container.querySelector('[data-step-id="tool-0"]')).not.toBeNull();
  });

  it("renders clickable nodes as buttons and fires onNodeClick", () => {
    const graph = buildStepGraph({
      plan: [{ label: "Plan", tool: "plan", status: "done", summary: "" }],
      runLog: [{ step: "1", tool: "primer3", status: "success", message: "" }],
      timeline: [],
      phase: "idle",
      validationStatus: "completed",
      hasResults: true,
    });
    const onNodeClick = vi.fn();
    const clickable = new Set(["tool-0", "validation"]);
    const { container } = render(
      <AgentStepDag graph={graph} onNodeClick={onNodeClick} clickableNodeIds={clickable} />,
    );
    const toolButton = container.querySelector('[data-step-id="tool-0"]');
    expect(toolButton).not.toBeNull();
    expect(toolButton!.tagName).toBe("BUTTON");
    fireEvent.click(toolButton as Element);
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick.mock.calls[0]![0]).toMatchObject({ id: "tool-0", tool: "primer3" });
    // Plan node without a target stays a plain element
    const planNode = container.querySelector('[data-step-id="plan-0"]');
    expect(planNode!.tagName).toBe("DIV");
  });

  it("renders a single clickable node as a button", () => {
    const graph = buildStepGraph({
      plan: [],
      runLog: [{ step: "1", tool: "check", status: "success", message: "ok" }],
      timeline: [],
      phase: "idle",
      validationStatus: "idle",
      hasResults: false,
    });
    const onNodeClick = vi.fn();
    const { container } = render(
      <AgentStepDag graph={graph} onNodeClick={onNodeClick} clickableNodeIds={new Set(["tool-0"])} />,
    );
    const node = container.querySelector('[data-step-id="tool-0"]');
    expect(node!.tagName).toBe("BUTTON");
    fireEvent.click(node as Element);
    expect(onNodeClick).toHaveBeenCalledTimes(1);
  });

  it("renders hover tooltip content for clickable nodes", () => {
    const graph = buildStepGraph({
      plan: [{ label: "Plan", tool: "plan", status: "done", summary: "" }],
      runLog: [{ step: "1", tool: "primer3", status: "success", message: "" }],
      timeline: [],
      phase: "idle",
      validationStatus: "completed",
      hasResults: true,
    });
    const nodeTooltips = new Map([
      ["tool-0", { lines: ["Forward primer 1–9"], hint: "点击定位到编辑器" }],
    ]);
    const { container } = render(
      <AgentStepDag
        graph={graph}
        onNodeClick={vi.fn()}
        clickableNodeIds={new Set(["tool-0"])}
        nodeTooltips={nodeTooltips}
      />,
    );
    const tooltip = container.querySelector('[data-step-id="tool-0"] .agent-step-dag__tooltip');
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).toContain("Forward primer 1–9");
    expect(tooltip!.textContent).toContain("点击定位到编辑器");
  });

  it("omits the tooltip when the map has no content for a node", () => {
    const graph = buildStepGraph({
      plan: [{ label: "Plan", tool: "plan", status: "done", summary: "" }],
      runLog: [{ step: "1", tool: "primer3", status: "success", message: "" }],
      timeline: [],
      phase: "idle",
      validationStatus: "idle",
      hasResults: false,
    });
    const { container } = render(
      <AgentStepDag
        graph={graph}
        onNodeClick={vi.fn()}
        clickableNodeIds={new Set(["tool-0"])}
        nodeTooltips={new Map()}
      />,
    );
    const tooltip = container.querySelector('[data-step-id="tool-0"] .agent-step-dag__tooltip');
    expect(tooltip).toBeNull();
  });

  it("renders an active tool node during execution", () => {
    const graph = buildStepGraph({
      plan: [],
      runLog: [{ step: "1", tool: "blast", status: "running", message: "" }],
      timeline: [],
      phase: "executing",
      validationStatus: "idle",
      hasResults: false,
    });
    render(<AgentStepDag graph={graph} />);
    expect(screen.getByText("running")).toBeDefined();
  });

  it("adds the live-pulse tone class to the active node", () => {
    const graph = buildStepGraph({
      plan: [],
      runLog: [{ step: "1", tool: "blast", status: "running", message: "" }],
      timeline: [],
      phase: "executing",
      validationStatus: "idle",
      hasResults: false,
    });
    const { container } = render(<AgentStepDag graph={graph} />);
    const node = container.querySelector('[data-step-id="tool-0"]');
    expect(node).not.toBeNull();
    expect(node!.className).toContain("agent-step-dag__node--active");
  });

  it("stamps a --node-order CSS variable for staggered pop-in", () => {
    const graph = buildStepGraph({
      plan: [{ label: "A", tool: "a", status: "done", summary: "" }],
      runLog: [{ step: "1", tool: "b", status: "success", message: "" }],
      timeline: [],
      phase: "idle",
      validationStatus: "completed",
      hasResults: true,
    });
    const { container } = render(<AgentStepDag graph={graph} />);
    const node = container.querySelector('[data-step-id="plan-0"]') as HTMLElement;
    expect(node).not.toBeNull();
    expect(node.style.getPropertyValue("--node-order")).toBe("0");
  });

  it("marks edges into completed/active nodes as drawn", () => {
    const graph = buildStepGraph({
      plan: [{ label: "A", tool: "a", status: "done", summary: "" }],
      runLog: [{ step: "1", tool: "b", status: "completed", message: "" }],
      timeline: [],
      phase: "idle",
      validationStatus: "idle",
      hasResults: false,
    });
    const { container } = render(<AgentStepDag graph={graph} />);
    const drawn = container.querySelectorAll(".agent-step-dag__edge--drawn");
    // plan-0 → tool-0 handoff edge lands on a completed node
    expect(drawn.length).toBeGreaterThan(0);
  });
});

describe("buildStepGraph with realistic plan/runLog", () => {
  const plan: PlanRow[] = [
    { label: "Analyze vector", tool: "context_probe", status: "done", summary: "read 2686 bp" },
    { label: "Design primers", tool: "primer3", status: "done", summary: "" },
  ];
  const runLog: RunLogRow[] = [
    { step: "Design primers", tool: "primer3", status: "success", message: "found 3 primers" },
  ];

  it("produces a connected graph across all stages", () => {
    const graph = buildStepGraph({
      plan,
      runLog,
      timeline: [],
      phase: "idle",
      validationStatus: "completed",
      hasResults: true,
    });
    expect(graph.nodes).toHaveLength(5); // 2 plan + 1 tool + 1 validation + 1 results
    // Every node is reachable in the edge chain: plan-0 → plan-1 → tool-0 → validation → results
    const ids = new Set(graph.nodes.map((node) => node.id));
    for (const edge of graph.edges) {
      expect(ids.has(edge.from)).toBe(true);
      expect(ids.has(edge.to)).toBe(true);
    }
    expect(graph.edges).toHaveLength(4);
  });
});

describe("dependency edge popover", () => {
  // A non-adjacent dependsOn (plan-0 → plan-2) produces a dashed edge that is
  // not covered by the derived chain edges.
  const plan: PlanRow[] = [
    {
      label: "解析转录本",
      tool: "resolve_rt_target",
      status: "done",
      summary: "NM_001123 25.7 kb",
    },
    {
      label: "评估模板",
      tool: "context_probe",
      status: "done",
      summary: "read 2686 bp",
    },
    {
      label: "设计引物",
      tool: "design_rtqpcr",
      status: "done",
      summary: "3 对引物",
      dependsOn: ["resolve_rt_target"],
    },
  ];
  const graph = () =>
    buildStepGraph({
      plan,
      runLog: [],
      timeline: [],
      phase: "idle",
      validationStatus: "idle",
      hasResults: false,
    });

  it("shows the upstream step summary when a dependency edge is clicked", () => {
    const { container } = render(<AgentStepDag graph={graph()} />);
    const edge = container.querySelector(".agent-step-dag__edge--dependency");
    expect(edge).not.toBeNull();
    fireEvent.click(edge as Element);
    const popover = container.querySelector(".agent-step-dag__edge-popover");
    expect(popover).not.toBeNull();
    expect(popover!.textContent).toContain("resolve_rt_target");
    expect(popover!.textContent).toContain("done");
    expect(popover!.textContent).toContain("NM_001123 25.7 kb");
    expect(popover!.textContent).toContain("design_rtqpcr");
  });

  it("closes the popover when the same edge is clicked again", () => {
    const { container } = render(<AgentStepDag graph={graph()} />);
    const edge = container.querySelector(".agent-step-dag__edge--dependency") as Element;
    fireEvent.click(edge);
    expect(container.querySelector(".agent-step-dag__edge-popover")).not.toBeNull();
    fireEvent.click(edge);
    expect(container.querySelector(".agent-step-dag__edge-popover")).toBeNull();
  });

  it("does not open a popover for regular chain edges", () => {
    const { container } = render(<AgentStepDag graph={graph()} />);
    const chain = container.querySelector(
      ".agent-step-dag__edge:not(.agent-step-dag__edge--dependency)",
    );
    expect(chain).not.toBeNull();
    fireEvent.click(chain as Element);
    expect(container.querySelector(".agent-step-dag__edge-popover")).toBeNull();
  });

  it("closes the popover when clicking elsewhere in the graph", () => {
    const { container } = render(<AgentStepDag graph={graph()} />);
    fireEvent.click(container.querySelector(".agent-step-dag__edge--dependency") as Element);
    expect(container.querySelector(".agent-step-dag__edge-popover")).not.toBeNull();
    fireEvent.click(container.querySelector(".agent-step-dag") as Element);
    expect(container.querySelector(".agent-step-dag__edge-popover")).toBeNull();
  });

  it("closes the popover on Escape", () => {
    const { container } = render(<AgentStepDag graph={graph()} />);
    fireEvent.click(container.querySelector(".agent-step-dag__edge--dependency") as Element);
    expect(container.querySelector(".agent-step-dag__edge-popover")).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector(".agent-step-dag__edge-popover")).toBeNull();
  });

  it("opens the popover from the keyboard (Enter)", () => {
    const { container } = render(<AgentStepDag graph={graph()} />);
    const edge = container.querySelector(".agent-step-dag__edge--dependency") as Element;
    fireEvent.keyDown(edge, { key: "Enter" });
    expect(container.querySelector(".agent-step-dag__edge-popover")).not.toBeNull();
  });
});
