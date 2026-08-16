import { describe, it, expect } from "vitest";
import { diffSequences, buildDiffRows } from "./sequenceDiff";

function joined(diff: ReturnType<typeof diffSequences>): string[] {
  return diff.segments.map((segment) => {
    switch (segment.type) {
      case "equal": return `=${segment.text}`;
      case "insert": return `+${segment.text}`;
      case "delete": return `-${segment.text}`;
      case "replace": return `~${segment.before}>${segment.after}`;
    }
  });
}

describe("diffSequences", () => {
  it("returns no changes for identical sequences", () => {
    const diff = diffSequences("ATGCATGC", "ATGCATGC");
    expect(diff.changedRegions).toBe(0);
    expect(diff.insertedBp).toBe(0);
    expect(diff.deletedBp).toBe(0);
    expect(joined(diff)).toEqual(["=ATGCATGC"]);
  });

  it("detects a pure insert", () => {
    const diff = diffSequences("ATGC", "ATGGGC");
    expect(diff.insertedBp).toBe(2);
    expect(diff.deletedBp).toBe(0);
    expect(diff.changedRegions).toBe(1);
    expect(joined(diff)).toContain("+GG");
  });

  it("detects a pure delete", () => {
    const diff = diffSequences("ATGGGC", "ATGC");
    expect(diff.deletedBp).toBe(2);
    expect(diff.changedRegions).toBe(1);
    expect(joined(diff)).toContain("-GG");
  });

  it("detects a replace at the end", () => {
    const diff = diffSequences("ATGCCC", "ATGGGG");
    expect(diff.changedRegions).toBe(1);
    expect(diff.insertedBp).toBe(3);
    expect(diff.deletedBp).toBe(3);
    expect(joined(diff)).toContain("~CCC>GGG");
  });

  it("detects multiple separate changed regions", () => {
    const diff = diffSequences("AAATTTGGGCCC", "AACTTTGGTCCC");
    expect(diff.changedRegions).toBeGreaterThanOrEqual(1);
    // The unchanged core stays in an equal segment.
    expect(joined(diff).some((segment) => segment.startsWith("=") && segment.includes("TTTGG"))).toBe(true);
  });

  it("reports correct totals for mixed changes", () => {
    const diff = diffSequences("AAACCCGGGTTT", "AAAACCGGGTT");
    expect(diff.beforeLength).toBe(12);
    expect(diff.afterLength).toBe(11);
    expect(diff.insertedBp).toBe(1);
    expect(diff.deletedBp).toBe(2);
  });

  it("handles empty inputs", () => {
    expect(diffSequences("", "").changedRegions).toBe(0);
    expect(diffSequences("", "AT").insertedBp).toBe(2);
    expect(diffSequences("AT", "").deletedBp).toBe(2);
  });

  it("handles a large shift with mostly identical sequence", () => {
    const before = "A".repeat(1000) + "TTTT" + "C".repeat(1000);
    const after = "A".repeat(1000) + "GG" + "C".repeat(1000);
    const diff = diffSequences(before, after);
    expect(diff.changedRegions).toBe(1);
    expect(diff.insertedBp).toBe(2);
    expect(diff.deletedBp).toBe(4);
  });
});

describe("buildDiffRows", () => {
  it("pairs equal chunks on both sides", () => {
    const diff = diffSequences("A".repeat(200), "A".repeat(200));
    const rows = buildDiffRows(diff);
    expect(rows.length).toBe(3); // 200 / 80 → 3 chunks
    expect(rows[0]!.left!.text).toBe("A".repeat(80));
    expect(rows[0]!.right!.text).toBe("A".repeat(80));
    expect(rows.every((row) => row.left!.kind === "equal" && row.right!.kind === "equal")).toBe(true);
  });

  it("emits insert rows only on the right side", () => {
    const diff = diffSequences("ATGC", "ATGGGC");
    const rows = buildDiffRows(diff);
    const insertRows = rows.filter((row) => row.right?.kind === "insert");
    expect(insertRows.length).toBeGreaterThan(0);
    expect(insertRows.every((row) => row.left === undefined)).toBe(true);
  });

  it("emits delete rows only on the left side", () => {
    const diff = diffSequences("ATGGGC", "ATGC");
    const rows = buildDiffRows(diff);
    const deleteRows = rows.filter((row) => row.left?.kind === "delete");
    expect(deleteRows.length).toBeGreaterThan(0);
    expect(deleteRows.every((row) => row.right === undefined)).toBe(true);
  });
});
