/**
 * Tests for nodeLocate — step-graph node → editor region / candidate resolution.
 */

import { describe, it, expect } from "vitest";
import { buildStepGraph } from "./stepGraph";
import {
  buildNodeTooltip,
  resolveCandidateRegions,
  resolveNodeTarget,
} from "./nodeLocate";
import type { ResultCandidate } from "./responseTypes";

const SEQUENCE = "ATGCCGTAAGCGGCTAGCTAGCGATCGATCGTAGCTAG";

function makeCandidate(overrides: Partial<ResultCandidate> = {}): ResultCandidate {
  return {
    title: "Top candidate",
    summary: null,
    forwardPrimer: "ATGCCGTAA",
    reversePrimer: "GCTAGCTAGC",
    tmForward: 60,
    tmReverse: 61,
    gcForward: 50,
    gcReverse: 51,
    fullLengthForward: 9,
    fullLengthReverse: 10,
    insertLength: null,
    tmDelta: null,
    crossDimer: false,
    annealTemp: null,
    extensionSec: null,
    workspace: "rtqpcr",
    sequenceRows: [],
    metrics: [],
    ...overrides,
  };
}

function graphFor(runLog: Array<{ tool: string; status: string; message: string }>) {
  return buildStepGraph({
    plan: [],
    runLog: runLog.map((row, index) => ({ step: String(index + 1), ...row })),
    timeline: [],
    phase: "idle",
    validationStatus: "completed",
    hasResults: true,
  });
}

describe("resolveCandidateRegions", () => {
  it("uses explicit binding coordinates when present", () => {
    const candidate = makeCandidate({
      bindingStartForward: 0,
      bindingEndForward: 9,
      bindingStartReverse: 10,
      bindingEndReverse: 20,
    });
    const regions = resolveCandidateRegions(candidate, SEQUENCE, "cloning");
    expect(regions).toEqual([
      { start: 0, end: 9, label: "Forward primer" },
      { start: 10, end: 20, label: "Reverse primer" },
    ]);
  });

  it("locates RT-qPCR primers by sequence lookup when coordinates are missing", () => {
    const candidate = makeCandidate({ forwardPrimer: "ATGCCGTAA", reversePrimer: "GCTAGCTAGC" });
    const regions = resolveCandidateRegions(candidate, SEQUENCE, "rtqpcr");
    expect(regions.length).toBe(2);
    expect(regions[0]).toEqual({ start: 0, end: 9, label: "Forward primer" });
    expect(regions[1]).toEqual({ start: 12, end: 22, label: "Reverse primer" });
  });

  it("falls back to primer lookup for cloning candidates without coordinates", () => {
    const candidate = makeCandidate({
      workspace: "cloning",
      forwardPrimer: "ATGCCGTAA",
      reversePrimer: "GCTAGCTAGC",
    });
    const regions = resolveCandidateRegions(candidate, SEQUENCE, "cloning");
    expect(regions.length).toBe(2);
    expect(regions[0]).toEqual({ start: 0, end: 9, label: "Forward primer" });
    expect(regions[1]).toEqual({ start: 12, end: 22, label: "Reverse primer" });
  });

  it("uses the sgRNA cut site plus guide binding region", () => {
    const candidate = makeCandidate({
      workspace: "sgrna",
      raw: { seq: "GCCGTAAGCGGCTAGCTAGC", cut: 10 },
    });
    const regions = resolveCandidateRegions(candidate, SEQUENCE, "sgrna");
    expect(regions.map((region) => region.label)).toContain("sgRNA cut site");
    expect(regions.map((region) => region.label)).toContain("sgRNA guide");
    const cut = regions.find((region) => region.label === "sgRNA cut site")!;
    expect(cut.start).toBe(8);
    expect(cut.end).toBe(13);
  });

  it("skips out-of-range coordinates and unmatched primers", () => {
    const candidate = makeCandidate({
      bindingStartForward: 500,
      bindingEndForward: 510,
      forwardPrimer: "TTTTTTTTTT", // not present in the open sequence
      reversePrimer: "CCCCCCCCCC",
    });
    const regions = resolveCandidateRegions(candidate, SEQUENCE, "cloning");
    expect(regions.length).toBe(0);
  });

  it("resolves nothing for an empty sequence", () => {
    const candidate = makeCandidate({ forwardPrimer: "ATGCCGTAA" });
    expect(resolveCandidateRegions(candidate, "", "rtqpcr").length).toBe(0);
  });
});

describe("resolveNodeTarget", () => {
  it("maps a design tool node to the first locatable candidate", () => {
    const graph = graphFor([
      { tool: "primer3", status: "success", message: "ok" },
    ]);
    const node = graph.nodes.find((entry) => entry.id === "tool-0")!;
    const target = resolveNodeTarget({
      node,
      candidates: [makeCandidate({ bindingStartForward: 0, bindingEndForward: 9 })],
      markers: [],
      sequence: SEQUENCE,
      workspace: "cloning",
    });
    expect(target).not.toBeNull();
    expect(target!.candidateIndex).toBe(0);
    expect(target!.regions[0]!.start).toBe(0);
  });

  it("maps a check tool node to validation markers", () => {
    const graph = graphFor([
      { tool: "check_rt_specificity", status: "success", message: "ok" },
    ]);
    const node = graph.nodes.find((entry) => entry.id === "tool-0")!;
    const target = resolveNodeTarget({
      node,
      candidates: [makeCandidate()],
      markers: [
        { id: "validate-0-F", start: 0, end: 9, tone: "pass", label: "Forward primer", candidateIndex: 0 },
      ],
      sequence: SEQUENCE,
      workspace: "rtqpcr",
    });
    expect(target).not.toBeNull();
    expect(target!.candidateIndex).toBe(0);
    expect(target!.regions[0]!.start).toBe(0);
  });

  it("maps the validation node to markers for the marker candidate", () => {
    const graph = graphFor([]);
    graph.nodes.push({
      id: "validation",
      layer: 2,
      order: 0,
      label: "Validation",
      tool: "check",
      status: "done",
    });
    const node = graph.nodes.find((entry) => entry.id === "validation")!;
    const target = resolveNodeTarget({
      node,
      candidates: [makeCandidate()],
      markers: [
        { id: "validate-0-F", start: 0, end: 9, tone: "pass", label: "Forward primer", candidateIndex: 0 },
      ],
      sequence: SEQUENCE,
      workspace: "rtqpcr",
    });
    expect(target).not.toBeNull();
    expect(target!.regions[0]!.label).toBe("Forward primer");
  });

  it("returns null for plan nodes and unlocatable tools", () => {
    const graph = buildStepGraph({
      plan: [{ label: "Analyze", tool: "context_probe", status: "done", summary: "" }],
      runLog: [{ step: "1", tool: "context_probe", status: "success", message: "" }],
      timeline: [],
      phase: "idle",
      validationStatus: "idle",
      hasResults: false,
    });
    const planNode = graph.nodes.find((entry) => entry.id === "plan-0")!;
    const toolNode = graph.nodes.find((entry) => entry.id === "tool-0")!;
    const options = {
      candidates: [] as ResultCandidate[],
      markers: [] as Array<{ id: string; start: number; end: number; tone: "pass" | "warning" | "fail" | "info"; label: string }>,
      sequence: SEQUENCE,
      workspace: "cloning",
    };
    expect(resolveNodeTarget({ node: planNode, ...options })).toBeNull();
    expect(resolveNodeTarget({ node: toolNode, ...options })).toBeNull();
  });
});

describe("buildNodeTooltip", () => {
  const target = {
    regions: [
      { start: 0, end: 9, label: "Forward primer" },
      { start: 12, end: 22, label: "Reverse primer" },
    ],
    candidateIndex: 0,
  };

  it("renders region coordinates as 1-based plus the locate hint", () => {
    const tooltip = buildNodeTooltip(target, null);
    expect(tooltip).not.toBeNull();
    expect(tooltip!.lines).toEqual(["Forward primer 1–9", "Reverse primer 13–22"]);
    expect(tooltip!.hint).toBe("点击定位到编辑器");
  });

  it("prepends the validation status line for check-like nodes", () => {
    const tooltip = buildNodeTooltip(target, "Pass · specific");
    expect(tooltip!.lines[0]).toBe("Pass · specific");
    expect(tooltip!.lines).toContain("Forward primer 1–9");
  });

  it("returns null when there are no locatable regions", () => {
    const tooltip = buildNodeTooltip({ regions: [], candidateIndex: null }, null);
    expect(tooltip).toBeNull();
  });
});
