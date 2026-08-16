import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { SequenceDocument } from "../types";
import { createDocumentHistoryEntry } from "../workspace/documentHistory";
import { DocumentHistoryPanel } from "./DocumentHistoryPanel";

const before: SequenceDocument = {
  name: "Vector",
  sequence: "AAAA",
  circular: false,
  features: [],
};

describe("DocumentHistoryPanel", () => {
  it("restores the state before a selected operation", () => {
    const after = { ...before, sequence: "AAAAAA" };
    const entry = createDocumentHistoryEntry(before, after, "Added bases", "manual", 1)!;
    const onRestore = vi.fn();
    render(<DocumentHistoryPanel history={[entry]} onRestore={onRestore} onClear={vi.fn()} />);

    expect(screen.getByText("+2 bp")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "恢复到本步骤之前" }));
    expect(onRestore).toHaveBeenCalledWith(entry.id, "before");
  });

  it("offers to clear recorded history", () => {
    const entry = createDocumentHistoryEntry(before, { ...before, name: "Renamed" }, "Renamed", "manual", 1)!;
    const onClear = vi.fn();
    render(<DocumentHistoryPanel history={[entry]} onRestore={vi.fn()} onClear={onClear} />);

    fireEvent.click(screen.getByRole("button", { name: "清除文档历史" }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
