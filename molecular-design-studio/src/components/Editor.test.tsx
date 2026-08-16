import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import Editor from "./Editor";
import type { EditorProps } from "./Editor";
import type { SequenceDocument } from "../types";
import * as sequenceFiles from "../services/sequenceFiles";

// Mock ResizeObserver — not available in jsdom
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});

let capturedOnSaved: ((doc: unknown) => void) | undefined;
let capturedOnSaveError: ((errors: readonly string[]) => void) | undefined;
let mountCount = 0;

vi.mock("@teselagen/ove", () => ({
  createVectorEditor: vi.fn(() => ({
    updateEditor: vi.fn(),
    getState: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock("./OveEditorHost", () => {
  function MockOveEditorHost({
    onSaved,
    onSaveError,
  }: {
    onSaved: (doc: unknown) => void;
    onSaveError: (errors: readonly string[]) => void;
  }) {
    useEffect(() => {
      mountCount++;
    }, []);
    capturedOnSaved = onSaved;
    capturedOnSaveError = onSaveError;
    return <div data-testid="ove-editor-host">OveEditorHost</div>;
  }
  return { default: MockOveEditorHost };
});

vi.mock("../services/sequenceFiles", () => ({
  chooseSequenceFile: vi.fn(),
  readSequenceFile: vi.fn(),
  chooseSavePath: vi.fn(),
  writeSequenceFile: vi.fn(),
  confirmDiscardChanges: vi.fn(),
}));

const puc19Doc: SequenceDocument = {
  name: "SYNPUC19V",
  sequence: "A".repeat(2686),
  circular: true,
  features: [],
  version: "M77789.2",
};

function makeProps(overrides: Partial<EditorProps> = {}): EditorProps {
  return {
    doc: puc19Doc,
    filePath: null,
    basename: null,
    isDirty: false,
    remountKey: 0,
    status: null,
    statusType: null,
    setDoc: vi.fn(),
    setFilePath: vi.fn(),
    setIsDirty: vi.fn(),
    setStatus: vi.fn(),
    onOveCommit: vi.fn(),
    onOveError: vi.fn(),
    onFileOpen: vi.fn(),
    ...overrides,
  };
}

describe("Editor with file operations", () => {
  beforeEach(() => {
    capturedOnSaved = undefined;
    capturedOnSaveError = undefined;
    mountCount = 0;
    vi.clearAllMocks();
  });

  it("renders pUC19 metadata in the document toolbar", async () => {
    render(<Editor {...makeProps()} />);
    // OveEditorHost is lazy-loaded. Await the Suspense boundary before the
    // synchronous toolbar assertions so the resource resolution is covered by
    // Testing Library's act boundary.
    await screen.findByTestId("ove-editor-host");
    expect(screen.getByText(/2,686 bp/)).toBeDefined();
    expect(screen.getByText("环状")).toBeDefined();
    expect(screen.getByText(/个特征/)).toBeDefined();
  });

  it("does not duplicate document identity in the command bar", () => {
    const { container } = render(<Editor {...makeProps()} />);
    expect(container.querySelector(".doc-toolbar__identity")).toBeNull();
  });

  it("renders OveEditorHost", async () => {
    render(<Editor {...makeProps()} />);
    // OveEditorHost is lazy-loaded (A-PERF-001): wait for the Suspense
    // boundary to resolve the mocked module before asserting it mounted.
    expect(await screen.findByTestId("ove-editor-host")).toBeDefined();
  });

  it("calls onOveCommit when OVE saves", async () => {
    const onOveCommit = vi.fn();
    render(<Editor {...makeProps({ onOveCommit })} />);
    await screen.findByTestId("ove-editor-host");
    const newDoc = {
      name: "SYNPUC19V",
      sequence: "A".repeat(2686),
      circular: true,
      features: [],
    };
    act(() => {
      capturedOnSaved!(newDoc);
    });
    expect(onOveCommit).toHaveBeenCalledWith(newDoc);
  });

  it("calls onOveError when OVE commit fails", async () => {
    const onOveError = vi.fn();
    render(<Editor {...makeProps({ onOveError })} />);
    await screen.findByTestId("ove-editor-host");
    act(() => {
      capturedOnSaveError!(["Feature 'bad': start -1 is negative"]);
    });
    expect(onOveError).toHaveBeenCalledWith(["Feature 'bad': start -1 is negative"]);
  });
});

describe("Editor empty sequence onboarding", () => {
  it("waits for durable recovery before seeding the bundled example", async () => {
    const setDoc = vi.fn();
    const { rerender } = render(
      <Editor {...makeProps({ doc: null, isRestoring: true, setDoc })} />,
    );
    expect(setDoc).not.toHaveBeenCalled();

    rerender(<Editor {...makeProps({ doc: null, isRestoring: false, setDoc })} />);
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1));
    expect(setDoc).toHaveBeenCalledWith(expect.objectContaining({ name: "SYNPUC19V" }));
  });

  it("shows clear first actions instead of an empty OVE canvas", () => {
    const emptyDoc: SequenceDocument = {
      name: "Sequence 2",
      sequence: "",
      circular: false,
      features: [],
    };
    render(<Editor {...makeProps({ doc: emptyDoc })} />);

    expect(screen.getByText("添加序列开始编辑")).toBeDefined();
    expect(screen.getByText("打开序列文件")).toBeDefined();
    expect(screen.getByText("粘贴序列")).toBeDefined();
    expect(screen.getByText("使用 pUC19 示例")).toBeDefined();
    expect(screen.queryByTestId("ove-editor-host")).toBeNull();
  });

  it("creates a canonical document from pasted sequence text", () => {
    const setDoc = vi.fn();
    const setIsDirty = vi.fn();
    const emptyDoc: SequenceDocument = {
      name: "Sequence 2",
      sequence: "",
      circular: false,
      features: [],
    };
    render(<Editor {...makeProps({ doc: emptyDoc, setDoc, setIsDirty })} />);

    fireEvent.click(screen.getByText("粘贴序列"));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Insert A" } });
    fireEvent.change(screen.getByLabelText("序列"), { target: { value: "ATGC 123 NN" } });
    fireEvent.click(screen.getByText("添加序列"));

    expect(setDoc).toHaveBeenCalledWith({
      name: "Insert A",
      sequence: "ATGCNN",
      circular: false,
      features: [],
    });
    expect(setIsDirty).toHaveBeenCalledWith(true);
  });
});

describe("Editor Open flow", () => {
  beforeEach(() => {
    capturedOnSaved = undefined;
    mountCount = 0;
    vi.clearAllMocks();
    vi.mocked(sequenceFiles.confirmDiscardChanges).mockResolvedValue(true);
  });

  it("does nothing when user cancels the file picker", async () => {
    vi.mocked(sequenceFiles.chooseSequenceFile).mockResolvedValue(null);
    render(<Editor {...makeProps()} />);

    await act(async () => {
      fireEvent.click(screen.getByText("打开"));
    });

    expect(await screen.findByTestId("ove-editor-host")).toBeDefined();
    expect(sequenceFiles.readSequenceFile).not.toHaveBeenCalled();
  });

  it("calls onFileOpen after successful open", async () => {
    const fastaContent = ">new_seq\nATCGATCG\n";
    vi.mocked(sequenceFiles.chooseSequenceFile).mockResolvedValue(
      "/path/to/new_seq.fasta",
    );
    vi.mocked(sequenceFiles.readSequenceFile).mockResolvedValue(fastaContent);
    const onFileOpen = vi.fn();

    render(<Editor {...makeProps({ onFileOpen })} />);

    await act(async () => {
      fireEvent.click(screen.getByText("打开"));
    });

    expect(onFileOpen).toHaveBeenCalledTimes(1);
    expect(onFileOpen).toHaveBeenCalledWith(
      expect.objectContaining({ name: "new_seq", sequence: "ATCGATCG" }),
      "/path/to/new_seq.fasta",
    );
  });

  it("shows parse error on bad file", async () => {
    vi.mocked(sequenceFiles.chooseSequenceFile).mockResolvedValue(
      "/path/to/bad.gb",
    );
    vi.mocked(sequenceFiles.readSequenceFile).mockResolvedValue("not valid");
    const setStatus = vi.fn();

    render(<Editor {...makeProps({ setStatus })} />);

    await act(async () => {
      fireEvent.click(screen.getByText("打开"));
    });

    expect(setStatus).toHaveBeenCalledWith(
      expect.stringContaining("GenBank parser failed"),
      "error",
    );
  });

  it("asks for confirmation when document is dirty", async () => {
    vi.mocked(sequenceFiles.chooseSequenceFile).mockResolvedValue(null);
    render(<Editor {...makeProps({ isDirty: true })} />);

    await act(async () => {
      fireEvent.click(screen.getByText("打开"));
    });

    expect(sequenceFiles.confirmDiscardChanges).toHaveBeenCalledTimes(1);
  });

  it("does not open when user rejects discard confirmation", async () => {
    vi.mocked(sequenceFiles.confirmDiscardChanges).mockResolvedValue(false);
    render(<Editor {...makeProps({ isDirty: true })} />);

    await act(async () => {
      fireEvent.click(screen.getByText("打开"));
    });

    expect(sequenceFiles.chooseSequenceFile).not.toHaveBeenCalled();
  });

  it("remounts OVE when opening a file", async () => {
    const fastaContent = ">SYNPUC19V\n" + "A".repeat(2686) + "\n";
    vi.mocked(sequenceFiles.chooseSequenceFile).mockResolvedValue(
      "/path/to/copy.fasta",
    );
    vi.mocked(sequenceFiles.readSequenceFile).mockResolvedValue(fastaContent);

    const onFileOpen = vi.fn();
    render(<Editor {...makeProps({ onFileOpen })} />);
    await screen.findByTestId("ove-editor-host");
    expect(mountCount).toBe(1);

    await act(async () => {
      fireEvent.click(screen.getByText("打开"));
    });

    expect(onFileOpen).toHaveBeenCalled();
  });
});

describe("Editor Save flow", () => {
  beforeEach(() => {
    capturedOnSaved = undefined;
    vi.clearAllMocks();
  });

  it("falls back to Save As when there is no current path", async () => {
    vi.mocked(sequenceFiles.chooseSavePath).mockResolvedValue(null);
    render(<Editor {...makeProps()} />);

    await act(async () => {
      fireEvent.click(screen.getByText("保存"));
    });
    // A-FILE-001: Save As now asks for the format in-app before the native dialog.
    const dialog = screen.getByRole("dialog", { name: "另存为" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    });

    expect(sequenceFiles.chooseSavePath).toHaveBeenCalledWith(
      "SYNPUC19V.gb",
      undefined,
    );
  });

  it("writes to current path without reopening dialog", async () => {
    vi.mocked(sequenceFiles.chooseSequenceFile).mockResolvedValue(
      "/path/to/test.fasta",
    );
    vi.mocked(sequenceFiles.readSequenceFile).mockResolvedValue(
      ">test\nATCG\n",
    );
    vi.mocked(sequenceFiles.writeSequenceFile).mockResolvedValue(undefined);

    render(
      <Editor
        {...makeProps({
          filePath: "/path/to/test.fasta",
          basename: "test.fasta",
        })}
      />,
    );

    vi.clearAllMocks();
    vi.mocked(sequenceFiles.writeSequenceFile).mockResolvedValue(undefined);

    await act(async () => {
      fireEvent.click(screen.getByText("保存"));
    });

    expect(sequenceFiles.writeSequenceFile).toHaveBeenCalledWith(
      "/path/to/test.fasta",
      expect.any(String),
    );
    expect(sequenceFiles.chooseSavePath).not.toHaveBeenCalled();
  });

  it("Save File As opens dialog and writes to chosen path", async () => {
    vi.mocked(sequenceFiles.chooseSavePath).mockResolvedValue(
      "/new/path/output.gb",
    );
    vi.mocked(sequenceFiles.writeSequenceFile).mockResolvedValue(undefined);
    const setFilePath = vi.fn();
    const setIsDirty = vi.fn();

    render(<Editor {...makeProps({ setFilePath, setIsDirty })} />);

    await act(async () => {
      fireEvent.click(screen.getByText("另存为"));
    });
    const dialog = screen.getByRole("dialog", { name: "另存为" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    });

    expect(sequenceFiles.chooseSavePath).toHaveBeenCalled();
    expect(sequenceFiles.writeSequenceFile).toHaveBeenCalledWith(
      "/new/path/output.gb",
      expect.any(String),
    );
  });

  it("Save File As cancel leaves state unchanged", async () => {
    vi.mocked(sequenceFiles.chooseSavePath).mockResolvedValue(null);
    render(<Editor {...makeProps()} />);

    await act(async () => {
      fireEvent.click(screen.getByText("另存为"));
    });
    const dialog = screen.getByRole("dialog", { name: "另存为" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    });

    expect(sequenceFiles.chooseSavePath).not.toHaveBeenCalled();
    expect(sequenceFiles.writeSequenceFile).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "另存为" })).toBeNull();
    expect(await screen.findByTestId("ove-editor-host")).toBeDefined();
  });

  it("write failure calls setStatus with error", async () => {
    vi.mocked(sequenceFiles.writeSequenceFile).mockRejectedValue(
      new Error("Disk full"),
    );
    const setStatus = vi.fn();

    render(
      <Editor
        {...makeProps({
          filePath: "/path/to/test.fasta",
          basename: "test.fasta",
          setStatus,
        })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("保存"));
    });

    expect(setStatus).toHaveBeenCalledWith("Disk full", "error");
  });

  it("uses Save As instead of overwriting an imported .dna file", async () => {
    vi.mocked(sequenceFiles.chooseSavePath).mockResolvedValue(
      "/new/path/SYNPUC19V.gb",
    );
    vi.mocked(sequenceFiles.writeSequenceFile).mockResolvedValue(undefined);

    render(
      <Editor
        {...makeProps({
          filePath: "/path/to/source.dna",
          basename: "source.dna",
          isDirty: true,
        })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("保存"));
    });
    const dialog = screen.getByRole("dialog", { name: "另存为" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    });

    expect(sequenceFiles.chooseSavePath).toHaveBeenCalledWith(
      "SYNPUC19V.gb",
      undefined,
    );
    expect(sequenceFiles.writeSequenceFile).toHaveBeenCalledWith(
      "/new/path/SYNPUC19V.gb",
      expect.any(String),
    );
    expect(sequenceFiles.writeSequenceFile).not.toHaveBeenCalledWith(
      "/path/to/source.dna",
      expect.anything(),
    );
  });

  it("uses Save As instead of overwriting an imported .ab1 file", async () => {
    vi.mocked(sequenceFiles.chooseSavePath).mockResolvedValue(
      "/new/path/read1.gb",
    );
    vi.mocked(sequenceFiles.writeSequenceFile).mockResolvedValue(undefined);

    render(
      <Editor
        {...makeProps({
          filePath: "/path/to/read.ab1",
          basename: "read.ab1",
          isDirty: true,
        })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("保存"));
    });
    const dialog = screen.getByRole("dialog", { name: "另存为" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    });

    // .ab1 is import-only: Save redirects to Save As with a .gb default name.
    expect(sequenceFiles.chooseSavePath).toHaveBeenCalledWith(
      "SYNPUC19V.gb",
      undefined,
    );
    expect(sequenceFiles.writeSequenceFile).not.toHaveBeenCalledWith(
      "/path/to/read.ab1",
      expect.anything(),
    );
  });

  it("calls setIsDirty(false) after successful save", async () => {
    vi.mocked(sequenceFiles.writeSequenceFile).mockResolvedValue(undefined);
    const setIsDirty = vi.fn();

    render(
      <Editor
        {...makeProps({
          filePath: "/path/to/test.fasta",
          basename: "test.fasta",
          setIsDirty,
        })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("保存"));
    });

    expect(setIsDirty).toHaveBeenCalledWith(false);
  });
});

describe("Editor keyboard shortcuts (non-macOS)", () => {
  beforeEach(() => {
    capturedOnSaved = undefined;
    vi.clearAllMocks();
    vi.mocked(sequenceFiles.chooseSequenceFile).mockResolvedValue(null);
    vi.mocked(sequenceFiles.chooseSavePath).mockResolvedValue(null);
    vi.mocked(sequenceFiles.confirmDiscardChanges).mockResolvedValue(true);
    Object.defineProperty(navigator, "platform", {
      value: "Win32",
      configurable: true,
    });
  });

  it("dispatches Open on Ctrl+O", async () => {
    render(<Editor {...makeProps()} />);
    await act(async () => {
      fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    });
    expect(sequenceFiles.chooseSequenceFile).toHaveBeenCalled();
  });

  it("dispatches Save on Ctrl+S", async () => {
    render(<Editor {...makeProps({ filePath: "/test.gb", basename: "test.gb" })} />);
    await act(async () => {
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    });
    expect(sequenceFiles.writeSequenceFile).toHaveBeenCalled();
  });

  it("dispatches Save As on Ctrl+Shift+S", async () => {
    render(<Editor {...makeProps()} />);
    await act(async () => {
      fireEvent.keyDown(window, {
        key: "s",
        ctrlKey: true,
        shiftKey: true,
      });
    });
    const dialog = screen.getByRole("dialog", { name: "另存为" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    });
    expect(sequenceFiles.chooseSavePath).toHaveBeenCalled();
  });

  it("ignores Meta+O on non-macOS", async () => {
    render(<Editor {...makeProps()} />);
    await act(async () => {
      fireEvent.keyDown(window, { key: "o", metaKey: true });
    });
    expect(sequenceFiles.chooseSequenceFile).not.toHaveBeenCalled();
  });

  it("ignores Meta+S on non-macOS", async () => {
    render(<Editor {...makeProps()} />);
    await act(async () => {
      fireEvent.keyDown(window, { key: "s", metaKey: true });
    });
    expect(sequenceFiles.chooseSavePath).not.toHaveBeenCalled();
  });

  it("does not dispatch Open while typing in an input field", async () => {
    render(<Editor {...makeProps()} />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    try {
      await act(async () => {
        fireEvent.keyDown(input, { key: "o", ctrlKey: true });
      });
      expect(sequenceFiles.chooseSequenceFile).not.toHaveBeenCalled();
    } finally {
      input.remove();
    }
  });

  it("does not dispatch Save while typing in a textarea", async () => {
    render(<Editor {...makeProps({ filePath: "/test.gb", basename: "test.gb" })} />);
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textarea.focus();
    try {
      await act(async () => {
        fireEvent.keyDown(textarea, { key: "s", ctrlKey: true });
      });
      expect(sequenceFiles.writeSequenceFile).not.toHaveBeenCalled();
    } finally {
      textarea.remove();
    }
  });
});

describe("Editor keyboard shortcuts (macOS)", () => {
  beforeEach(() => {
    capturedOnSaved = undefined;
    vi.clearAllMocks();
    vi.mocked(sequenceFiles.chooseSequenceFile).mockResolvedValue(null);
    vi.mocked(sequenceFiles.chooseSavePath).mockResolvedValue(null);
    vi.mocked(sequenceFiles.confirmDiscardChanges).mockResolvedValue(true);
    Object.defineProperty(navigator, "platform", {
      value: "MacIntel",
      configurable: true,
    });
  });

  it("dispatches Open on Meta+O", async () => {
    render(<Editor {...makeProps()} />);
    await act(async () => {
      fireEvent.keyDown(window, { key: "o", metaKey: true });
    });
    expect(sequenceFiles.chooseSequenceFile).toHaveBeenCalled();
  });

  it("dispatches Save on Meta+S", async () => {
    render(<Editor {...makeProps({ filePath: "/test.gb", basename: "test.gb" })} />);
    await act(async () => {
      fireEvent.keyDown(window, { key: "s", metaKey: true });
    });
    expect(sequenceFiles.writeSequenceFile).toHaveBeenCalled();
  });

  it("ignores Ctrl+O on macOS", async () => {
    render(<Editor {...makeProps()} />);
    await act(async () => {
      fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    });
    expect(sequenceFiles.chooseSequenceFile).not.toHaveBeenCalled();
  });

  it("ignores Ctrl+S on macOS", async () => {
    render(<Editor {...makeProps()} />);
    await act(async () => {
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    });
    expect(sequenceFiles.chooseSavePath).not.toHaveBeenCalled();
  });
});
