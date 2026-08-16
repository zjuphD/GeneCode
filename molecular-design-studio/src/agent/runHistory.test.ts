import { describe, expect, it } from "vitest";
import { buildRunHistoryEntry, compactRunGoal } from "./runHistory";

describe("run history goal display", () => {
  it("collapses raw sequence goals into a readable label", () => {
    const rawSequence = "ATGC".repeat(200);
    expect(compactRunGoal(rawSequence)).toBe("Attached sequence design · 800 bp");
  });

  it("truncates long prose without exposing an oversized history row", () => {
    const goal = "Design and review a molecular cloning strategy ".repeat(8);
    const compact = compactRunGoal(goal);
    expect(compact.length).toBeLessThanOrEqual(180);
    expect(compact.endsWith("...")).toBe(true);
  });

  it("stores the compact goal in completed run history", () => {
    const entry = buildRunHistoryEntry({
      runId: "run-1",
      workspace: "cloning",
      agentMode: "plan",
      goal: "ATGC".repeat(200),
      plan: [],
      candidates: [],
      recommendation: null,
      timeline: [],
    });
    expect(entry.goal).toBe("Attached sequence design · 800 bp");
  });
});
