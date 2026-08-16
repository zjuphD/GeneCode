import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DocumentToolbar from "./DocumentToolbar";

const defaultProps = {
  sequenceLength: 2686,
  circular: true,
  featureCount: 8,
  status: null as string | null,
  statusType: null as "success" | "error" | null,
  onNew: vi.fn(),
  onOpen: vi.fn(),
  onSave: vi.fn(),
  onSaveAs: vi.fn(),
};

describe("DocumentToolbar", () => {
  it("keeps document identity out of the command bar", () => {
    const { container } = render(<DocumentToolbar {...defaultProps} />);
    expect(container.querySelector(".doc-toolbar__identity")).toBeNull();
  });

  it("shows sequence length, topology, and feature count", () => {
    render(<DocumentToolbar {...defaultProps} />);
    expect(screen.getByText(/2,686 bp/)).toBeDefined();
    expect(screen.getByText("环状")).toBeDefined();
    expect(screen.getByText("8 个特征")).toBeDefined();
  });

  it("shows 'linear' for linear sequences", () => {
    render(<DocumentToolbar {...defaultProps} circular={false} />);
    expect(screen.getByText("线性")).toBeDefined();
  });

  it("flags large sequences with a supported-scale warning (A-PERF-001)", () => {
    const { container } = render(
      <DocumentToolbar {...defaultProps} sequenceLength={200_000} />,
    );
    expect(
      container.querySelector(".doc-toolbar__chip--large-seq"),
    ).not.toBeNull();
    expect(screen.getByText(/200,000 bp/)).toBeDefined();
    expect(
      (container.querySelector(".doc-toolbar__chip--large-seq") as HTMLElement)
        .getAttribute("aria-label"),
    ).toContain("100,000");
  });

  it("keeps the plain chip for sequences within the supported scale", () => {
    const { container } = render(<DocumentToolbar {...defaultProps} />);
    expect(
      container.querySelector(".doc-toolbar__chip--large-seq"),
    ).toBeNull();
  });

  it("shows undo/redo buttons with disabled states (A-STATE-001)", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(
      <DocumentToolbar
        {...defaultProps}
        onUndo={onUndo}
        onRedo={onRedo}
        canUndo={false}
        canRedo={false}
      />,
    );
    expect(screen.getByLabelText(/撤销 \(/)).toBeDefined();
    expect(screen.getByLabelText(/重做 \(/)).toBeDefined();
    expect((screen.getByLabelText(/撤销 \(/) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText(/重做 \(/) as HTMLButtonElement).disabled).toBe(true);
  });

  it("hides undo/redo buttons when no handlers are provided", () => {
    render(<DocumentToolbar {...defaultProps} />);
    expect(screen.queryByLabelText(/撤销 \(/)).toBeNull();
    expect(screen.queryByLabelText(/重做 \(/)).toBeNull();
  });

  it("enables and fires undo/redo when operations are available", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(
      <DocumentToolbar
        {...defaultProps}
        onUndo={onUndo}
        onRedo={onRedo}
        canUndo={true}
        canRedo={true}
      />,
    );
    fireEvent.click(screen.getByLabelText(/撤销 \(/));
    fireEvent.click(screen.getByLabelText(/重做 \(/));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it("calls onOpen when Open button is clicked", () => {
    const onOpen = vi.fn();
    render(<DocumentToolbar {...defaultProps} onOpen={onOpen} />);
    fireEvent.click(screen.getByText("打开"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("calls onSave when Save button is clicked", () => {
    const onSave = vi.fn();
    render(<DocumentToolbar {...defaultProps} onSave={onSave} />);
    fireEvent.click(screen.getByText("保存"));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("calls onSaveAs when Save As button is clicked", () => {
    const onSaveAs = vi.fn();
    render(<DocumentToolbar {...defaultProps} onSaveAs={onSaveAs} />);
    fireEvent.click(screen.getByText("另存为"));
    expect(onSaveAs).toHaveBeenCalledTimes(1);
  });

  it("does not expose a destructive close action in the file toolbar", () => {
    render(<DocumentToolbar {...defaultProps} />);
    expect(screen.queryByText("Close")).toBeNull();
  });

  it("shows success status message", () => {
    render(
      <DocumentToolbar
        {...defaultProps}
        status="Saved"
        statusType="success"
      />,
    );
    expect(screen.getByText("Saved")).toBeDefined();
  });

  it("shows error status message", () => {
    render(
      <DocumentToolbar
        {...defaultProps}
        status="Export failed"
        statusType="error"
      />,
    );
    expect(screen.getByText("Export failed")).toBeDefined();
  });
});
