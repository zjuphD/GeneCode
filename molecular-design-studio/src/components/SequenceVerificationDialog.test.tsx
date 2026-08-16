import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SequenceDocument } from "../types";
import { SequenceVerificationDialog } from "./SequenceVerificationDialog";

const mockParseAb1File = vi.fn();
vi.mock("../editor/ab1Parser", () => ({
  parseAb1File: (...args: unknown[]) => mockParseAb1File(...args),
}));

beforeEach(() => {
  mockParseAb1File.mockReset();
});

const doc: SequenceDocument = {
  name: "Reference vector",
  sequence: "AAAACCCCGGGGTTTT",
  circular: false,
  features: [],
};

describe("SequenceVerificationDialog", () => {
  it("aligns a pasted read and shows a review summary", async () => {
    render(<SequenceVerificationDialog doc={doc} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("DNA 序列"), { target: { value: "CCCGGGG" } });
    fireEvent.click(screen.getByRole("button", { name: "开始比对" }));

    await waitFor(() => expect(screen.getByText("100.0% identity")).toBeDefined());
    expect(screen.getByText("forward orientation · reference 6-12")).toBeDefined();
    expect(screen.getByText("未检测到序列差异。")).toBeDefined();
  });

  it("reports invalid pasted characters", async () => {
    render(<SequenceVerificationDialog doc={doc} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("DNA 序列"), { target: { value: "ATGC?" } });
    fireEvent.click(screen.getByRole("button", { name: "开始比对" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("unsupported characters"));
  });

  it("closes from its icon button", () => {
    const onClose = vi.fn();
    render(<SequenceVerificationDialog doc={doc} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "关闭序列比对" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("loads an .ab1 trace, fills the read, and reports parse failures", async () => {
    mockParseAb1File.mockResolvedValue({
      name: "read1",
      sequence: "CCCGGGG",
      baseCalls: ["C", "C", "C", "G", "G", "G", "G"],
      basePos: [1, 2, 3, 4, 5, 6, 7],
      qualNums: [40, 40, 40, 40, 40, 40, 40],
      baseTraces: [],
      traceLength: 0,
    });
    render(<SequenceVerificationDialog doc={doc} onClose={vi.fn()} />);
    const input = screen.getByLabelText("加载 ABI 色谱文件") as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File([new ArrayBuffer(8)], "read1.ab1")] },
    });
    await waitFor(() => expect(screen.getByText("7 bp trace")).toBeDefined());
    expect((screen.getByLabelText("读段名称") as HTMLInputElement).value).toBe("read1");
    expect((screen.getByLabelText("DNA 序列") as HTMLTextAreaElement).value).toBe("CCCGGGG");
  });

  it("surfaces an ABI parse error without closing the dialog", async () => {
    mockParseAb1File.mockRejectedValue(new Error("Not a valid ABI trace file"));
    render(<SequenceVerificationDialog doc={doc} onClose={vi.fn()} />);
    const input = screen.getByLabelText("加载 ABI 色谱文件") as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File([new ArrayBuffer(8)], "bad.ab1")] },
    });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Not a valid ABI trace file"));
  });

  it("opens the AlignmentView with the parsed trace after verification", async () => {
    mockParseAb1File.mockResolvedValue({
      name: "read1",
      sequence: "CCCGGGG",
      baseCalls: ["C", "C", "C", "G", "G", "G", "G"],
      basePos: [1, 2, 3, 4, 5, 6, 7],
      qualNums: [40, 40, 40, 40, 40, 40, 40],
      baseTraces: [],
      traceLength: 0,
    });
    const onClose = vi.fn();
    const onOpenAlignment = vi.fn();
    render(
      <SequenceVerificationDialog
        doc={doc}
        onClose={onClose}
        onOpenAlignment={onOpenAlignment}
      />,
    );
    const input = screen.getByLabelText("加载 ABI 色谱文件") as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File([new ArrayBuffer(8)], "read1.ab1")] },
    });
    // Trace load auto-runs the comparison, so the result appears without a
    // manual Run click.
    await waitFor(() => expect(screen.getByText("100.0% identity")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "打开色谱比对" }));
    expect(onOpenAlignment).toHaveBeenCalledWith({
      name: "read1",
      sequence: "CCCGGGG",
      chromatogramData: expect.objectContaining({ baseCalls: ["C", "C", "C", "G", "G", "G", "G"] }),
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("hides the trace alignment action when no trace was loaded", async () => {
    render(
      <SequenceVerificationDialog
        doc={doc}
        onClose={vi.fn()}
        onOpenAlignment={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("DNA 序列"), { target: { value: "CCCGGGG" } });
    fireEvent.click(screen.getByRole("button", { name: "开始比对" }));
    await waitFor(() => expect(screen.getByText("100.0% identity")).toBeDefined());
    expect(screen.queryByRole("button", { name: "打开色谱比对" })).toBeNull();
  });
});
