import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { SequenceDocument, SequenceSelection } from "../types";
import { SequenceToolsMenu } from "./SequenceToolsMenu";

const doc: SequenceDocument = {
  name: "Tool test",
  sequence: `TAATACGACTCACTATAGGG${"A".repeat(20)}ATG${"AAA".repeat(30)}TAA`,
  circular: false,
  features: [],
};

const callbacks = {
  onCommitDocument: vi.fn(),
  onCreateDocument: vi.fn(),
  onStatus: vi.fn(),
};

describe("SequenceToolsMenu", () => {
  beforeEach(() => vi.clearAllMocks());

  it("auto-annotates known features through a real document commit", () => {
    render(<SequenceToolsMenu doc={doc} selection={null} {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: /工具/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /自动注释常见特征/ }));

    expect(callbacks.onCommitDocument).toHaveBeenCalledOnce();
    const [updated, label, source] = callbacks.onCommitDocument.mock.calls[0]!;
    expect(updated.features).toMatchObject([{ name: "T7 promoter", type: "promoter" }]);
    expect(label).toContain("已自动注释");
    expect(source).toBe("annotation");
  });

  it("opens the sequencing-read verification workflow", () => {
    render(<SequenceToolsMenu doc={doc} selection={null} {...callbacks} />);    fireEvent.click(screen.getByRole("button", { name: /工具/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /与测序读段比对/ }));
    expect(screen.getByRole("dialog", { name: "与测序读段比对" })).toBeDefined();
    expect(screen.getByLabelText("DNA 序列")).toBeDefined();
  });

  it("finds ORFs and adds them to the active document", () => {
    render(<SequenceToolsMenu doc={doc} selection={null} {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: /工具/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /查找开放阅读框/ }));

    const [updated] = callbacks.onCommitDocument.mock.calls[0]!;
    expect(updated.features.some((feature: { type: string }) => feature.type === "CDS")).toBe(true);
  });

  it("creates a derived sequence from an active selection", () => {
    const selection: SequenceSelection = {
      start: 0,
      end: 20,
      length: 20,
      wrapsOrigin: false,
      sequence: doc.sequence.slice(0, 20),
    };
    render(<SequenceToolsMenu doc={doc} selection={selection} {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: /工具/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /从选区新建序列/ }));

    expect(callbacks.onCreateDocument).toHaveBeenCalledWith(expect.objectContaining({
      sequence: selection.sequence,
      circular: false,
    }));
  });
});
