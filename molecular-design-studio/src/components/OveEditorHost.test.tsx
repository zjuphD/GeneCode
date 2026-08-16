import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import OveEditorHost from "./OveEditorHost";
import type { SequenceDocument } from "../types";
import type { OveSequenceData } from "@teselagen/ove";
import { fingerprintDocument } from "../agent/fingerprint";
import type { SequencePatch } from "../agent/patchTypes";
import type { OveCommandBridge } from "../editor/oveCommandBridge";

const mockClose = vi.fn();
const mockUpdateEditor = vi.fn();
const mockGetState = vi.fn();
const mockStoreGetState = vi.fn();
const mockGetStore = vi.fn();
const mockStoreDispatch = vi.fn();
const mockCreateVectorEditor = vi.fn();
const mockCreateNewDigest = vi.fn();
const mockCreateNewPCR = vi.fn();
const mockCreateNewAlignment = vi.fn();
const mockUpsertAlignmentRun = vi.fn();
const mockShowDialog = vi.fn();
let capturedOnSave: ((...args: unknown[]) => unknown) | undefined;
let capturedOnSelectionOrCaretChanged: ((event: Record<string, unknown>) => void) | undefined;
let capturedOnCreateNewFromSubsequence: ((sequenceData: OveSequenceData) => void) | undefined;

vi.mock("@teselagen/ove", () => ({
  createVectorEditor: (...args: unknown[]) => mockCreateVectorEditor(...args),
  GeneCodeSequencePanel: () => null,
  showDialog: (...args: unknown[]) => mockShowDialog(...args),
  actions: {
    createNewDigest: (...args: unknown[]) => mockCreateNewDigest(...args),
    createNewPCR: (...args: unknown[]) => mockCreateNewPCR(...args),
    createNewAlignment: (...args: unknown[]) => mockCreateNewAlignment(...args),
    upsertAlignmentRun: (...args: unknown[]) => mockUpsertAlignmentRun(...args),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetStore.mockReturnValue({ getState: mockStoreGetState, dispatch: mockStoreDispatch });
  window.localStorage.clear();
  capturedOnSave = undefined;
  capturedOnSelectionOrCaretChanged = undefined;
  capturedOnCreateNewFromSubsequence = undefined;
  mockCreateVectorEditor.mockImplementation(
    (_node: HTMLElement, props: Record<string, unknown>) => {
      capturedOnSave = props.onSave as ((...args: unknown[]) => unknown) | undefined;
      capturedOnSelectionOrCaretChanged = props.onSelectionOrCaretChanged as ((event: Record<string, unknown>) => void) | undefined;
      capturedOnCreateNewFromSubsequence = props.onCreateNewFromSubsequence as ((sequenceData: OveSequenceData) => void) | undefined;
      return {
        updateEditor: mockUpdateEditor,
        getState: mockGetState,
        getStore: mockGetStore,
        close: mockClose,
      };
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

const makeDoc = (overrides: Partial<SequenceDocument> = {}): SequenceDocument => ({
  name: "test",
  sequence: "ATCG",
  circular: false,
  features: [],
  ...overrides,
});

const makeOveData = (overrides: Partial<OveSequenceData> = {}): OveSequenceData => ({
  name: "test",
  sequence: "ATCG",
  circular: false,
  features: [],
  ...overrides,
});

function makeOveStoreState(document: SequenceDocument, revision = 1): Record<string, unknown> {
  return {
    VectorEditor: {
      MdsEditor: {
        revision,
        sequenceData: {
          name: document.name,
          sequence: document.sequence,
          circular: document.circular,
          features: document.features.map((feature) => ({
            id: feature.id,
            name: feature.name,
            type: feature.type,
            start: feature.start,
            end: feature.end - 1,
            strand: feature.strand,
            forward: feature.strand === 1,
            notes: feature.qualifiers,
          })),
        },
        selectionLayer: { start: 1, end: 2 },
        caretPosition: -1,
      },
    },
  };
}

function makeInsertPatch(document: SequenceDocument): SequencePatch {
  return {
    schemaVersion: 1,
    id: "host-patch-1",
    title: "Insert tag",
    summary: "Add a small tag",
    baseHash: fingerprintDocument(document),
    operations: [
      {
        kind: "insert",
        id: "host-op-1",
        reason: "Add tag",
        position: 0,
        sequence: "GG",
      },
    ],
  };
}

describe("OveEditorHost", () => {
  it("calls createVectorEditor once on mount", () => {
    render(
      <OveEditorHost
        doc={makeDoc()}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );
    expect(mockCreateVectorEditor).toHaveBeenCalledTimes(1);
  });

  it("keeps the legacy path untouched when no command bridge ref is supplied", () => {
    render(
      <OveEditorHost
        doc={makeDoc()}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );

    expect(mockGetStore).not.toHaveBeenCalled();
  });

  it("creates a dedicated child mount node inside the React host", () => {
    const { container } = render(
      <OveEditorHost
        doc={makeDoc()}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );
    const host = container.querySelector(".ove-editor-host");
    expect(host).not.toBeNull();
    const mountNode = host!.querySelector(".ove-mount-node");
    expect(mountNode).not.toBeNull();
    expect(mockCreateVectorEditor).toHaveBeenCalledWith(
      mountNode,
      expect.any(Object),
    );
  });

  it("keeps the editor writable and synchronizes OVE edits automatically", () => {
    render(
      <OveEditorHost
        doc={makeDoc()}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );
    const props = mockCreateVectorEditor.mock.calls[0]![1] as Record<string, unknown>;
    expect(props.readOnly).toBe(false);
    expect(props.shouldAutosave).toBe(true);
  });

  it("replaces OVE's hover-only Create submenu with direct actions", () => {
    render(
      <OveEditorHost
        doc={makeDoc({ sequence: "A".repeat(40) })}
        oveData={makeOveData({ sequence: "A".repeat(40) })}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );
    const props = mockCreateVectorEditor.mock.calls[0]![1] as Record<string, unknown>;
    const overrides = props.rightClickOverrides as Record<string, (...args: unknown[]) => unknown>;
    const result = overrides.selectionLayerRightClicked!(
      [
        { text: "Copy" },
        { text: "Create", cmd: "createMenuHolder" },
        "--",
        "selectInverse",
      ],
      { annotation: { start: 10, end: 20 } },
    ) as Array<Record<string, unknown> | string>;
    expect(result).toEqual([
      { text: "Copy" },
      expect.objectContaining({
        text: "添加注释",
        onClick: expect.any(Function),
      }),
      expect.objectContaining({
        text: "添加引物",
        onClick: expect.any(Function),
      }),
      { cmd: "createNewFromSubsequence", text: "从选区创建序列" },
      "--",
      "selectInverse",
    ]);
    act(() => (result[1] as { onClick: () => void }).onClick());
    expect(screen.getByRole("dialog", { name: "添加注释" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "关闭创建对话框" }));
    act(() => (result[2] as { onClick: () => void }).onClick());
    expect(screen.getByRole("dialog", { name: "添加引物" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "关闭创建对话框" }));

    const backgroundResult = overrides.backgroundRightClicked!([
      "createMenuHolder",
      "viewFullSequenceTranslations",
    ]);
    expect(backgroundResult).toEqual([
      expect.objectContaining({ text: "添加注释", onClick: expect.any(Function) }),
      expect.objectContaining({ text: "添加引物", onClick: expect.any(Function) }),
      { cmd: "createNewFromSubsequence", text: "从选区创建序列" },
      "viewFullSequenceTranslations",
    ]);
  });

  it("closes the create-feature dialog on Escape (A-A11Y-001)", () => {
    const doc = makeDoc({ sequence: "AACCGGTT" });
    render(
      <OveEditorHost
        doc={doc}
        oveData={makeOveData({ sequence: doc.sequence })}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );
    const props = mockCreateVectorEditor.mock.calls[0]![1] as Record<string, unknown>;
    const overrides = props.rightClickOverrides as Record<string, (...args: unknown[]) => unknown>;
    const result = overrides.selectionLayerRightClicked!(
      [
        { text: "Copy" },
        { text: "Create", cmd: "createMenuHolder" },
        "--",
        "selectInverse",
      ],
      { annotation: { start: 10, end: 20 } },
    ) as Array<Record<string, unknown> | string>;
    act(() => (result[1] as { onClick: () => void }).onClick());
    expect(screen.getByRole("dialog", { name: "添加注释" })).toBeDefined();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "添加注释" })).toBeNull();
  });

  it("saves a primer created from the selected region into the canonical document", () => {
    const onSaved = vi.fn();
    const doc = makeDoc({ sequence: "AACCGGTT" });
    render(
      <OveEditorHost
        doc={doc}
        oveData={makeOveData({ sequence: doc.sequence })}
        onSaved={onSaved}
        onSaveError={vi.fn()}
      />,
    );
    const props = mockCreateVectorEditor.mock.calls[0]![1] as Record<string, unknown>;
    const overrides = props.rightClickOverrides as Record<string, (...args: unknown[]) => unknown>;
    const result = overrides.selectionLayerRightClicked!(
      [{ cmd: "createMenuHolder" }],
      { annotation: { start: 1, end: 3 } },
    ) as Array<Record<string, unknown>>;

    act(() => (result[1] as { onClick: () => void }).onClick());
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Reverse primer" } });
    fireEvent.change(screen.getByLabelText("链"), { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "添加引物" }));

    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
      features: [expect.objectContaining({
        name: "Reverse primer",
        type: "primer_bind",
        start: 1,
        end: 4,
        strand: -1,
        qualifiers: {
          sequence: ["GGT"],
          binding_sequence: ["ACC"],
          direction: ["reverse"],
        },
      })],
    }));
    expect(mockUpdateEditor).toHaveBeenLastCalledWith(expect.objectContaining({
      sequenceData: expect.objectContaining({
        features: [expect.objectContaining({ name: "Reverse primer" })],
      }),
    }));
    expect(screen.queryByRole("dialog", { name: "添加引物" })).toBeNull();
  });

  it("consumes the OVE autosave echo after creating a feature so the dialog does not double-commit", () => {
    const onSaved = vi.fn();
    const doc = makeDoc({ sequence: "AACCGGTT" });
    render(
      <OveEditorHost
        doc={doc}
        oveData={makeOveData({ sequence: doc.sequence })}
        onSaved={onSaved}
        onSaveError={vi.fn()}
      />,
    );
    const props = mockCreateVectorEditor.mock.calls[0]![1] as Record<string, unknown>;
    const overrides = props.rightClickOverrides as Record<string, (...args: unknown[]) => unknown>;
    const result = overrides.selectionLayerRightClicked!(
      [{ cmd: "createMenuHolder" }],
      { annotation: { start: 1, end: 3 } },
    ) as Array<Record<string, unknown>>;

    act(() => (result[1] as { onClick: () => void }).onClick());
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Fwd" } });
    fireEvent.click(screen.getByRole("button", { name: "添加引物" }));

    // The dialog commit already records the canonical history entry once.
    expect(onSaved).toHaveBeenCalledTimes(1);

    // updateEditor({ sequenceData }) can trigger OVE's legacy autosave callback
    // with the same content. The matching echo must be consumed instead of
    // being recorded as a second manual edit. The autosave data carries the
    // same feature in OVE's inclusive-coordinate form so it round-trips to the
    // identical canonical fingerprint.
    const updatedDoc = onSaved.mock.calls[0]![0] as SequenceDocument;
    const feature = updatedDoc.features[0]!;
    capturedOnSave!(
      {},
      makeOveData({
        sequence: updatedDoc.sequence,
        features: [{
          id: feature.id,
          name: feature.name,
          type: feature.type,
          start: feature.start,
          end: feature.end - 1,
          strand: feature.strand,
          forward: feature.strand === 1,
          notes: feature.qualifiers,
          color: feature.color,
        }],
      }),
      {},
      vi.fn(),
    );

    expect(onSaved).toHaveBeenCalledTimes(1);
  });


  it("shows direct actions for the current selection", () => {
    const onSelectionChange = vi.fn();
    const onCreateDerivedDocument = vi.fn();
    const doc = makeDoc({ sequence: "ACGT" });
    render(
      <OveEditorHost
        doc={doc}
        oveData={makeOveData({ sequence: doc.sequence })}
        selection={{
          start: 1,
          end: 3,
          length: 2,
          wrapsOrigin: false,
          sequence: "CG",
        }}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
        onSelectionChange={onSelectionChange}
        onCreateDerivedDocument={onCreateDerivedDocument}
      />,
    );

    expect(screen.getByLabelText("选区操作")).toBeDefined();
    expect(screen.getByText("已选 2 bp")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "注释" }));
    expect(screen.getByRole("dialog", { name: "添加注释" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "关闭创建对话框" }));

    fireEvent.click(screen.getByRole("button", { name: "新建序列" }));
    expect(onCreateDerivedDocument).toHaveBeenCalledWith(expect.objectContaining({
      name: "test selection",
      sequence: "CG",
      circular: false,
    }));

    fireEvent.click(screen.getByRole("button", { name: "清除选区" }));
    expect(onSelectionChange).toHaveBeenCalledWith({ start: -1, end: -1 });
  });

  it("hides selection actions when no bases are selected", () => {
    render(
      <OveEditorHost
        doc={makeDoc()}
        oveData={makeOveData()}
        selection={null}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("选区操作")).toBeNull();
    expect(screen.queryByText(/选区 GC/)).toBeNull();
  });

  it("reports GC content for the selected sequence instead of the full document", () => {
    const doc = makeDoc({ sequence: "GGGGAAAA" });
    render(
      <OveEditorHost
        doc={doc}
        oveData={makeOveData({ sequence: doc.sequence })}
        selection={{
          start: 4,
          end: 8,
          length: 4,
          wrapsOrigin: false,
          sequence: "AAAA",
        }}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );

    expect(screen.getByText("选区 GC 0.0%")).toBeDefined();
    expect(screen.queryByText("选区 GC 50.0%")).toBeNull();
  });

  // A-BIO-004: an origin-spanning selection can now create an annotation
  // carrying explicit segments (previously the buttons were disabled).
  it("creates a segments feature from an origin-spanning selection", () => {
    const onSaved = vi.fn();
    const doc = makeDoc({ sequence: "A".repeat(100), circular: true });
    render(
      <OveEditorHost
        doc={doc}
        oveData={makeOveData({ sequence: doc.sequence, circular: true })}
        selection={{
          start: 90,
          end: 10,
          length: 20,
          wrapsOrigin: true,
          sequence: "A".repeat(20),
        }}
        onSaved={onSaved}
        onSaveError={vi.fn()}
      />,
    );

    const annotate = screen.getByRole("button", { name: "注释" }) as HTMLButtonElement;
    expect(annotate.disabled).toBe(false);
    fireEvent.click(annotate);
    expect(screen.getByRole("dialog", { name: "添加注释" })).toBeDefined();

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "wrapGene" } });
    fireEvent.click(screen.getByRole("button", { name: "添加注释" }));

    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
      features: [expect.objectContaining({
        name: "wrapGene",
        start: 90,
        end: 10,
        segments: [
          { start: 90, end: 100 },
          { start: 0, end: 10 },
        ],
      })],
    }));
  });

  it("creates a linear library sequence from the selected OVE subsequence", () => {
    const onCreateDerivedDocument = vi.fn();
    render(
      <OveEditorHost
        doc={makeDoc()}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
        onCreateDerivedDocument={onCreateDerivedDocument}
      />,
    );

    capturedOnCreateNewFromSubsequence?.(makeOveData({
      name: "test selection",
      sequence: "AT",
      circular: true,
    }));

    expect(onCreateDerivedDocument).toHaveBeenCalledWith(expect.objectContaining({
      name: "test selection",
      sequence: "AT",
      circular: false,
    }));
  });

  it("configures a compact toolbar with task-relevant tools plus cut-site filtering", () => {
    render(
      <OveEditorHost
        doc={makeDoc()}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );
    const props = mockCreateVectorEditor.mock.calls[0]![1] as Record<string, unknown>;
    const toolbarProps = props.ToolBarProps as { toolList: string[] };
    expect(toolbarProps.toolList).toEqual([
      "cutsiteTool",
      "featureTool",
      "editTool",
      "findTool",
      "visibilityTool",
    ]);
    // A-STATE-001: the engine's internal undo/redo tools are removed so the
    // canonical operation log is the only undo/redo source.
    expect(toolbarProps.toolList).not.toContain("undoTool");
    expect(toolbarProps.toolList).not.toContain("redoTool");
    // No import, download, alignment, or other unrelated workflows in the OVE chrome
    expect(toolbarProps.toolList).not.toContain("importTool");
    expect(toolbarProps.toolList).not.toContain("downloadTool");
    expect(toolbarProps.toolList).not.toContain("alignmentTool");
  });

  it("routes Cmd+Z / Cmd+Shift+Z through the canonical undo/redo hooks (A-STATE-001)", () => {
    const doc = makeDoc({ sequence: "AACCGGTT", circular: true });
    mockStoreGetState.mockReturnValue(makeOveStoreState(doc));
    const onUndo = vi.fn();
    const onRedo = vi.fn();

    render(
      <OveEditorHost
        doc={doc}
        oveData={makeOveData({ sequence: doc.sequence, circular: doc.circular })}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
        onUndo={onUndo}
        onRedo={onRedo}
      />,
    );

    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });
    expect(onRedo).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(onRedo).toHaveBeenCalledTimes(2);
  });

  it("does not hijack Cmd+Z while typing in a field outside the editor", () => {
    const doc = makeDoc({ sequence: "AACCGGTT", circular: true });
    mockStoreGetState.mockReturnValue(makeOveStoreState(doc));
    const onUndo = vi.fn();

    render(
      <OveEditorHost
        doc={doc}
        oveData={makeOveData({ sequence: doc.sequence, circular: doc.circular })}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
        onUndo={onUndo}
      />,
    );

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(onUndo).not.toHaveBeenCalled();
    input.remove();
  });

  it("opens the engine digest panel through the fork store", () => {
    render(
      <OveEditorHost
        doc={makeDoc()}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "酶切" }));
    expect(mockStoreDispatch).toHaveBeenCalled();
    expect(mockCreateNewDigest).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ editorName: "MdsEditor" }),
    );
  });

  it("keeps the simulation toolbar text-only at its compact size", () => {
    render(
      <OveEditorHost
        doc={makeDoc()}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );

    const buttons = Array.from(document.querySelectorAll(".ove-sim-tools .ove-selection-action"));
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(["克隆", "酶切", "PCR", "比对"]);
    expect(buttons.every((button) => !button.querySelector("svg"))).toBe(true);
  });

  it("opens the engine PCR panel through the fork store", () => {
    render(
      <OveEditorHost
        doc={makeDoc()}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "PCR" }));
    expect(mockCreateNewPCR).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ editorName: "MdsEditor" }),
    );
  });

  it("runs a local pairwise alignment into the engine AlignmentView", () => {
    render(
      <OveEditorHost
        doc={makeDoc({ sequence: "AACCGGTT" })}
        oveData={makeOveData({ sequence: "AACCGGTT" })}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "比对" }));
    fireEvent.change(screen.getByLabelText("查询名称"), { target: { value: "Read 1" } });
    fireEvent.change(screen.getByLabelText("查询序列"), { target: { value: "AACCG" } });
    fireEvent.click(screen.getByRole("button", { name: "开始比对" }));
    expect(mockUpsertAlignmentRun).toHaveBeenCalledWith(expect.objectContaining({
      alignmentTracks: expect.arrayContaining([
        expect.objectContaining({ sequenceData: expect.objectContaining({ name: "test" }) }),
        expect.objectContaining({ sequenceData: expect.objectContaining({ name: "Read 1" }) }),
      ]),
      // A-OVE-001: without an explicit alignmentType the engine header falls
      // back to "Unknown Alignment Type" — the app must supply it.
      alignmentType: "Local Alignment",
    }));
    expect(mockCreateNewAlignment).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Local Alignment" }),
      expect.objectContaining({ editorName: "MdsEditor" }),
    );
  });

  it("opens the engine AlignmentView for a Sanger trace with chromatogram data", () => {
    render(
      <OveEditorHost
        doc={makeDoc({ sequence: "AACCGGTT" })}
        oveData={makeOveData({ sequence: "AACCGGTT" })}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
        traceAlignmentRequest={{
          nonce: 1,
          name: "Read A",
          sequence: "AACCG",
          chromatogramData: {
            name: "Read A",
            sequence: "AACCG",
            baseCalls: ["A", "A", "C", "C", "G"],
            basePos: [1, 2, 3, 4, 5],
            baseTraces: [
              { aTrace: [1], tTrace: [0], gTrace: [0], cTrace: [0] },
              { aTrace: [1], tTrace: [0], gTrace: [0], cTrace: [0] },
              { aTrace: [0], tTrace: [0], gTrace: [0], cTrace: [1] },
              { aTrace: [0], tTrace: [0], gTrace: [0], cTrace: [1] },
              { aTrace: [0], tTrace: [0], gTrace: [1], cTrace: [0] },
            ],
            traceLength: 5,
          },
        }}
      />,
    );
    expect(mockUpsertAlignmentRun).toHaveBeenCalledWith(expect.objectContaining({
      alignmentTracks: expect.arrayContaining([
        expect.objectContaining({ sequenceData: expect.objectContaining({ name: "test" }) }),
        expect.objectContaining({
          sequenceData: expect.objectContaining({ name: "Read A" }),
          chromatogramData: expect.objectContaining({ baseCalls: ["A", "A", "C", "C", "G"] }),
        }),
      ]),
      // the engine's default is chromatogram:false, so the trace run must
      // explicitly opt in for the peaks to render in the AlignmentView
      alignmentAnnotationVisibility: expect.objectContaining({ chromatogram: true }),
      alignmentType: "Trace Alignment",
    }));
    expect(mockCreateNewAlignment).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Trace Alignment" }),
      expect.objectContaining({ editorName: "MdsEditor" }),
    );
  });

  it("does not re-dispatch the same trace alignment request twice", () => {
    const request = {
      nonce: 1,
      name: "Read A",
      sequence: "AACCG",
    };
    const { rerender } = render(
      <OveEditorHost
        doc={makeDoc({ sequence: "AACCGGTT" })}
        oveData={makeOveData({ sequence: "AACCGGTT" })}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
        traceAlignmentRequest={request}
      />,
    );
    expect(mockUpsertAlignmentRun).toHaveBeenCalledTimes(1);
    rerender(
      <OveEditorHost
        doc={makeDoc({ sequence: "AACCGGTT" })}
        oveData={makeOveData({ sequence: "AACCGGTT" })}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
        traceAlignmentRequest={request}
      />,
    );
    expect(mockUpsertAlignmentRun).toHaveBeenCalledTimes(1);
  });

  it("surfaces alignment errors instead of opening a broken panel", () => {
    render(
      <OveEditorHost
        doc={makeDoc({ sequence: "AACCGGTT" })}
        oveData={makeOveData({ sequence: "AACCGGTT" })}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "比对" }));
    fireEvent.click(screen.getByRole("button", { name: "开始比对" }));
    expect(screen.getByRole("alert")).toBeDefined();
    expect(mockUpsertAlignmentRun).not.toHaveBeenCalled();
  });

  it("hides read-only toggle and shows circularity in status bar", () => {
    render(
      <OveEditorHost
        doc={makeDoc()}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );
    const props = mockCreateVectorEditor.mock.calls[0]![1] as Record<string, unknown>;
    const statusBarProps = props.StatusBarProps as Record<string, boolean>;
    expect(statusBarProps.showCircularity).toBe(false);
    expect(statusBarProps.showReadOnly).toBe(false);
    expect(statusBarProps.showAvailability).toBe(false);
  });

  it("enables annotation and primer creation in OVE", () => {
    render(
      <OveEditorHost
        doc={makeDoc()}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );
    const props = mockCreateVectorEditor.mock.calls[0]![1] as Record<string, unknown>;
    expect(props.annotationsToSupport).toEqual({
      features: true,
      primers: true,
      parts: false,
      translations: true,
    });
    expect(props.enzymeGroupsOverride).toEqual({
      "Common cloning": [
        "BamHI", "EcoRI", "HindIII", "KpnI", "NheI", "NotI", "PstI",
        "SacI", "SalI", "SmaI", "SpeI", "XbaI", "XhoI",
      ],
      "Golden Gate": ["AarI", "BbsI", "BsaI", "BsmBI", "Esp3I", "SapI"],
    });
  });

  it("initializes editor with updateEditor, oveData, and panelsShown", () => {
    const oveData = makeOveData({ name: "pUC19" });
    render(
      <OveEditorHost
        doc={makeDoc({ circular: true })}
        oveData={oveData}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );
    expect(mockUpdateEditor).toHaveBeenCalledWith({
      readOnly: false,
      sequenceData: oveData,
      annotationsToSupport: {
        features: true,
        primers: true,
        parts: false,
        translations: true,
      },
      annotationVisibility: {
        cutsites: true,
        translations: true,
        cdsFeatureTranslations: true,
      },
      frameTranslations: {
        1: false,
        2: false,
        3: false,
        "-1": false,
        "-2": false,
        "-3": false,
      },
      restrictionEnzymes: {
        filteredRestrictionEnzymes: [{
          value: "__userCreatedGroupCommon cloning",
          label: "Common cloning",
          nameArray: [
            "BamHI", "EcoRI", "HindIII", "KpnI", "NheI", "NotI", "PstI",
            "SacI", "SalI", "SmaI", "SpeI", "XbaI", "XhoI",
          ],
        }],
      },
      panelsShown: [
        [
          { id: "circular", name: "Circular Map", active: true },
          { id: "rail", name: "Linear Map", active: false },
        ],
      ],
    });
  });

  it("exposes a command bridge backed by the fork editor store", () => {
    const doc = makeDoc({ sequence: "AACCGGTT", circular: true });
    const storeState = makeOveStoreState(doc, 7);
    mockStoreGetState.mockReturnValue(storeState);
    mockGetState.mockImplementation(() => {
      throw new Error("legacy editor.getState() must not be used by the bridge");
    });
    const commandBridgeRef: { current: OveCommandBridge | null } = { current: null };

    render(
      <OveEditorHost
        doc={doc}
        oveData={makeOveData({ sequence: doc.sequence, circular: doc.circular })}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
        commandBridgeRef={commandBridgeRef}
      />,
    );

    expect(commandBridgeRef.current).not.toBeNull();
    expect(commandBridgeRef.current?.readCurrentState()).toMatchObject({
      document: { sequence: "AACCGGTT", circular: true },
      selection: { start: 1, end: 3, length: 2, sequence: "AC" },
      revision: 7,
    });
    expect(mockGetStore).toHaveBeenCalled();
    expect(mockGetState).not.toHaveBeenCalled();
  });

  it("previews without mutating OVE and applies through the latest canonical callback", async () => {
    const doc = makeDoc({ sequence: "AACCGGTT", circular: true });
    mockStoreGetState.mockReturnValue(makeOveStoreState(doc));
    const firstOnSaved = vi.fn();
    const secondOnSaved = vi.fn();
    const commandBridgeRef: { current: OveCommandBridge | null } = { current: null };
    const { rerender } = render(
      <OveEditorHost
        doc={doc}
        oveData={makeOveData({ sequence: doc.sequence, circular: doc.circular })}
        onSaved={firstOnSaved}
        onSaveError={vi.fn()}
        commandBridgeRef={commandBridgeRef}
      />,
    );

    const bridge = commandBridgeRef.current!;
    mockUpdateEditor.mockClear();
    const preview = bridge.previewPatch(makeInsertPatch(doc));
    expect(preview.proposedDocument?.sequence).toBe("GGAACCGGTT");
    expect(mockUpdateEditor).not.toHaveBeenCalled();
    expect(firstOnSaved).not.toHaveBeenCalled();

    rerender(
      <OveEditorHost
        doc={doc}
        oveData={makeOveData({ sequence: doc.sequence, circular: doc.circular })}
        onSaved={secondOnSaved}
        onSaveError={vi.fn()}
        commandBridgeRef={commandBridgeRef}
      />,
    );

    await act(async () => {
      await expect(bridge.applyConfirmedPatch(preview)).resolves.toMatchObject({ ok: true });
    });

    expect(firstOnSaved).not.toHaveBeenCalled();
    expect(secondOnSaved).toHaveBeenCalledWith(expect.objectContaining({
      sequence: "GGAACCGGTT",
    }));
    expect(mockUpdateEditor).toHaveBeenLastCalledWith({
      sequenceData: expect.objectContaining({
        sequence: "GGAACCGGTT",
        circular: true,
      }),
    });
  });

  it("routes bridge Apply through the explicit Agent commit callback", async () => {
    const doc = makeDoc({ sequence: "AACCGGTT", circular: true });
    mockStoreGetState.mockReturnValue(makeOveStoreState(doc));
    const onSaved = vi.fn();
    const onAgentCommit = vi.fn();
    const commandBridgeRef: { current: OveCommandBridge | null } = { current: null };

    render(
      <OveEditorHost
        doc={doc}
        oveData={makeOveData({ sequence: doc.sequence, circular: doc.circular })}
        onSaved={onSaved}
        onAgentCommit={onAgentCommit}
        onSaveError={vi.fn()}
        commandBridgeRef={commandBridgeRef}
      />,
    );

    const bridge = commandBridgeRef.current!;
    const preview = bridge.previewPatch(makeInsertPatch(doc));
    await act(async () => {
      await expect(bridge.applyConfirmedPatch(preview)).resolves.toMatchObject({ ok: true });
    });

    expect(onSaved).not.toHaveBeenCalled();
    expect(onAgentCommit).toHaveBeenCalledWith(
      expect.objectContaining({ sequence: "GGAACCGGTT" }),
      expect.objectContaining({
        patch: expect.objectContaining({ id: "host-patch-1" }),
        preview: expect.objectContaining({ proposedHash: expect.any(String) }),
        currentDocument: expect.objectContaining({ sequence: doc.sequence }),
      }),
    );

    const saveSucceeded = vi.fn();
    capturedOnSave!(
      {},
      makeOveData({ sequence: "GGAACCGGTT", circular: true }),
      {},
      saveSucceeded,
    );
    expect(saveSucceeded).toHaveBeenCalledOnce();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("keeps optional undo and redo hooks on the exposed bridge", async () => {
    const doc = makeDoc({ sequence: "AACCGGTT", circular: true });
    mockStoreGetState.mockReturnValue(makeOveStoreState(doc));
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const commandBridgeRef: { current: OveCommandBridge | null } = { current: null };

    render(
      <OveEditorHost
        doc={doc}
        oveData={makeOveData({ sequence: doc.sequence, circular: doc.circular })}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
        commandBridgeRef={commandBridgeRef}
        onUndo={onUndo}
        onRedo={onRedo}
      />,
    );

    await commandBridgeRef.current!.commands.undo();
    await commandBridgeRef.current!.commands.redo();
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onRedo).toHaveBeenCalledOnce();
  });

  it("rejects a stale store snapshot before calling onSaved", async () => {
    const doc = makeDoc({ sequence: "AACCGGTT", circular: true });
    const storeState = makeOveStoreState(doc, 1);
    mockStoreGetState.mockReturnValue(storeState);
    const onSaved = vi.fn();
    const commandBridgeRef: { current: OveCommandBridge | null } = { current: null };

    render(
      <OveEditorHost
        doc={doc}
        oveData={makeOveData({ sequence: doc.sequence, circular: doc.circular })}
        onSaved={onSaved}
        onSaveError={vi.fn()}
        commandBridgeRef={commandBridgeRef}
      />,
    );

    const preview = commandBridgeRef.current!.previewPatch(makeInsertPatch(doc));
    const editorState = (storeState.VectorEditor as Record<string, unknown>).MdsEditor as Record<string, unknown>;
    editorState.revision = 2;
    (editorState.sequenceData as Record<string, unknown>).sequence = "T" + doc.sequence;

    await act(async () => {
      await expect(commandBridgeRef.current!.applyConfirmedPatch(preview)).resolves.toMatchObject({
        ok: false,
        reason: "stale_preview",
      });
    });

    expect(onSaved).not.toHaveBeenCalled();
    expect(mockUpdateEditor).not.toHaveBeenLastCalledWith(expect.objectContaining({
      sequenceData: expect.anything(),
    }));
  });

  it("covers the end-zero origin-wrap boundary without hiding coordinate rules", () => {
    const doc = makeDoc({ sequence: "AACCGGTT", circular: true });
    mockStoreGetState.mockReturnValue(makeOveStoreState(doc));
    const commandBridgeRef: { current: OveCommandBridge | null } = { current: null };
    render(
      <OveEditorHost
        doc={doc}
        oveData={makeOveData({ sequence: doc.sequence, circular: doc.circular })}
        selection={{
          start: 6,
          end: 0,
          length: 2,
          wrapsOrigin: true,
          sequence: "TA",
        }}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
        commandBridgeRef={commandBridgeRef}
      />,
    );

    // Host synchronization correctly maps canonical [6, 0) to OVE's
    // inclusive [6, 7] for an 8-bp circular molecule.
    expect(mockUpdateEditor).toHaveBeenCalledWith({
      selectionLayer: { start: 6, end: 7 },
    });

    // The bridge receives the same canonical half-open range directly. This
    // boundary assertion prevents the Host from silently adapting a range
    // that the bridge should own.
    commandBridgeRef.current!.setFocusRange({
      start: 6,
      end: 0,
      wrapsOrigin: true,
    });
    expect(mockUpdateEditor).toHaveBeenLastCalledWith({
      selectionLayer: { start: 6, end: 7 },
      caretPosition: -1,
    });
  });

  it("opens the engine enzyme manager with the current sequence", () => {
    render(
      <OveEditorHost
        doc={makeDoc({ sequence: "GGCCGGCC" })}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "限制酶分组" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /显示或隐藏酶/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^管理酶…$/ }));

    expect(mockShowDialog).toHaveBeenCalledWith({
      dialogType: "EnzymesDialog",
      props: {
        editorName: "MdsEditor",
        inputSequenceToTestAgainst: "GGCCGGCC",
      },
    });
  });

  it("opens the interactive cloning wizard from the Clone toolbar button", () => {
    render(
      <OveEditorHost
        doc={makeDoc({ sequence: "GGCCGGCC", circular: true })}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
        onCreateDerivedDocument={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "克隆" }));

    expect(screen.getByText("克隆到载体")).toBeDefined();
    expect(screen.getByText(/Vector “test”/)).toBeDefined();

    // Close via the header button
    fireEvent.click(screen.getByRole("button", { name: "关闭克隆对话框" }));
    expect(screen.queryByText("克隆到载体")).toBeNull();
  });

  it("defaults to a compact cloning enzyme group and supports group switching", () => {
    render(
      <OveEditorHost
        doc={makeDoc({ circular: true })}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "限制酶分组" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /使用酶分组/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Golden Gate 酶/ }));
    expect(mockUpdateEditor).toHaveBeenLastCalledWith({
      annotationVisibility: { cutsites: true },
      restrictionEnzymes: {
        filteredRestrictionEnzymes: [{
          value: "__userCreatedGroupGolden Gate",
          label: "Golden Gate",
          nameArray: ["AarI", "BbsI", "BsaI", "BsmBI", "Esp3I", "SapI"],
        }],
      },
    });
    expect(window.localStorage.getItem("genecode-enzyme-mode")).toBe("golden-gate");

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /显示或隐藏酶/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /隐藏所有位点/ }));
    expect(mockUpdateEditor).toHaveBeenLastCalledWith({
      annotationVisibility: { cutsites: false },
      restrictionEnzymes: { filteredRestrictionEnzymes: [] },
    });

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /显示或隐藏酶/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /显示所有位点/ }));
    expect(mockUpdateEditor).toHaveBeenLastCalledWith({
      annotationVisibility: { cutsites: true },
      restrictionEnzymes: { filteredRestrictionEnzymes: [] },
    });

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /使用酶分组/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /单切 \+ 双切酶/ }));
    expect(mockUpdateEditor).toHaveBeenLastCalledWith({
      annotationVisibility: { cutsites: true },
      restrictionEnzymes: {
        filteredRestrictionEnzymes: [
          { value: "single", label: "Unique cutters", cutsThisManyTimes: 1, isSpecialGroup: true },
          { value: "double", label: "Double cutters", cutsThisManyTimes: 2, isSpecialGroup: true },
        ],
      },
    });

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /使用酶分组/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Type IIS 酶/ }));
    expect(mockUpdateEditor).toHaveBeenLastCalledWith({
      annotationVisibility: { cutsites: true },
      restrictionEnzymes: {
        filteredRestrictionEnzymes: [{ value: "type2s", label: "Type IIS enzymes", isSpecialGroup: true }],
      },
    });
  });

  it("shows CDS translations by default and can display reading frames", () => {
    render(
      <OveEditorHost
        doc={makeDoc({ circular: true })}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );

    const select = screen.getByRole("combobox", {
      name: "氨基酸翻译",
    }) as HTMLSelectElement;
    expect(select.value).toBe("cds");

    fireEvent.change(select, { target: { value: "frame1" } });
    expect(mockUpdateEditor).toHaveBeenLastCalledWith({
      annotationVisibility: {
        translations: true,
        cdsFeatureTranslations: true,
      },
      frameTranslations: {
        1: true,
        2: false,
        3: false,
        "-1": false,
        "-2": false,
        "-3": false,
      },
      panelsShown: [[{ id: "sequence", name: "Sequence Map", active: true }]],
    });
    expect(screen.getByRole("button", { name: "序列视图" }).getAttribute("aria-pressed")).toBe("true");
    expect(window.localStorage.getItem("genecode-translation-mode")).toBe("frame1");
    expect(window.localStorage.getItem("genecode-editor-view-mode")).toBe("sequence");

    fireEvent.change(select, { target: { value: "off" } });
    expect(mockUpdateEditor).toHaveBeenLastCalledWith({
      annotationVisibility: {
        translations: false,
        cdsFeatureTranslations: false,
      },
      frameTranslations: {
        1: false,
        2: false,
        3: false,
        "-1": false,
        "-2": false,
        "-3": false,
      },
    });
  });

  it("migrates the previous broad reading-frame preference to CDS-only once", () => {
    window.localStorage.setItem("genecode-translation-mode", "frame1");
    render(
      <OveEditorHost
        doc={makeDoc({ circular: true })}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );

    const select = screen.getByRole("combobox", {
      name: "氨基酸翻译",
    }) as HTMLSelectElement;
    expect(select.value).toBe("cds");
    expect(window.localStorage.getItem("genecode-translation-mode")).toBe("cds");
    expect(window.localStorage.getItem("genecode-translation-mode-version")).toBe("2");
  });

  it("defaults to map view and switches between map, sequence, and split", () => {
    render(
      <OveEditorHost
        doc={makeDoc({ circular: true })}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );

    const mapButton = screen.getByRole("button", { name: "图谱视图" });
    expect(mapButton.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "序列视图" }));
    expect(mockUpdateEditor).toHaveBeenLastCalledWith({
      panelsShown: [
        [{ id: "sequence", name: "Sequence Map", active: true }],
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "分屏视图" }));
    expect(mockUpdateEditor).toHaveBeenLastCalledWith({
      panelsShown: [
        [{ id: "sequence", name: "Sequence Map", active: true }],
        [
          { id: "circular", name: "Circular Map", active: true },
          { id: "rail", name: "Linear Map", active: false },
        ],
      ],
    });
    expect(window.localStorage.getItem("genecode-editor-view-mode")).toBe("split");
  });

  it("restores the saved editor view mode", () => {
    window.localStorage.setItem("genecode-editor-view-mode", "sequence");
    render(
      <OveEditorHost
        doc={makeDoc()}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "序列视图" }).getAttribute("aria-pressed")).toBe("true");
    expect(mockUpdateEditor).toHaveBeenCalledWith(expect.objectContaining({
      panelsShown: [[{ id: "sequence", name: "Sequence Map", active: true }]],
    }));
  });

  it("converts an external canonical selection to OVE inclusive coordinates", () => {
    render(
      <OveEditorHost
        doc={makeDoc({ sequence: "A".repeat(100) })}
        oveData={makeOveData({ sequence: "A".repeat(100) })}
        selection={{
          start: 10,
          end: 20,
          length: 10,
          wrapsOrigin: false,
          sequence: "A".repeat(10),
        }}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );

    expect(mockUpdateEditor).toHaveBeenCalledWith({
      selectionLayer: { start: 10, end: 19 },
    });
  });

  it("calls deferred OVE cleanup on unmount without removing the React host", async () => {
    const { unmount } = render(
      <OveEditorHost
        doc={makeDoc()}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );
    unmount();
    await waitFor(() => expect(mockClose).toHaveBeenCalledTimes(1));
  });

  it("onSave calls onSaved with converted canonical doc on success", () => {
    const onSaved = vi.fn();
    const doc = makeDoc({ sequence: "ATCG", name: "test" });
    render(
      <OveEditorHost
        doc={doc}
        oveData={makeOveData()}
        onSaved={onSaved}
        onSaveError={vi.fn()}
      />,
    );

    const mockSuccessCallback = vi.fn();
    const savedOveData = makeOveData({
      sequence: "ATCG",
      name: "test",
      features: [],
    });

    capturedOnSave!({}, savedOveData, {}, mockSuccessCallback);

    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(mockSuccessCallback).toHaveBeenCalledTimes(1);
  });

  it("onSave calls onSaveError and does not call success callback on failure", () => {
    const onSaveError = vi.fn();
    const onSaved = vi.fn();
    render(
      <OveEditorHost
        doc={makeDoc()}
        oveData={makeOveData()}
        onSaved={onSaved}
        onSaveError={onSaveError}
      />,
    );

    const mockSuccessCallback = vi.fn();
    const badOveData = makeOveData({
      sequence: "ATCG",
      features: [
        { id: "bad", name: "bad", type: "gene", start: -1, end: 2, strand: 1 },
      ],
    });

    capturedOnSave!({}, badOveData, {}, mockSuccessCallback);

    expect(onSaved).not.toHaveBeenCalled();
    expect(mockSuccessCallback).not.toHaveBeenCalled();
    expect(onSaveError).toHaveBeenCalledTimes(1);
    expect(onSaveError.mock.calls[0]![0]).toEqual(
      expect.arrayContaining([expect.stringContaining("negative")]),
    );
  });

  it("Strict Mode creates one visible editor and defers secondary-root cleanup", async () => {
    // Realistic close: unmount children and remove the node OVE received.
    mockCreateVectorEditor.mockImplementation(
      (node: HTMLElement) => ({
        updateEditor: mockUpdateEditor,
        getState: mockGetState,
        close: () => {
          node.innerHTML = "";
          node.remove();
        },
      }),
    );

    const { container } = render(
      <React.StrictMode>
        <OveEditorHost
          doc={makeDoc()}
          oveData={makeOveData()}
          onSaved={vi.fn()}
          onSaveError={vi.fn()}
        />
      </React.StrictMode>,
    );

    // Strict Mode starts the replacement editor in the same commit. The stale
    // secondary root is closed in a microtask so React never receives a nested
    // synchronous root.unmount() call.
    const host = container.querySelector(".ove-editor-host");
    expect(host).not.toBeNull();
    await waitFor(() => {
      expect(host!.querySelectorAll(".ove-mount-node")).toHaveLength(1);
    });
    // The React-owned host is still in the DOM.
    expect(container.contains(host)).toBe(true);
  });

  it("captures onSelectionOrCaretChanged from createVectorEditor props", () => {
    render(
      <OveEditorHost
        doc={makeDoc()}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
        onSelectionChange={vi.fn()}
      />,
    );
    expect(capturedOnSelectionOrCaretChanged).toBeDefined();
    expect(typeof capturedOnSelectionOrCaretChanged).toBe("function");
  });

  it("forwards selectionLayer to onSelectionChange on selection event", () => {
    const onSelectionChange = vi.fn();
    render(
      <OveEditorHost
        doc={makeDoc()}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
        onSelectionChange={onSelectionChange}
      />,
    );

    capturedOnSelectionOrCaretChanged!({
      selectionLayer: { start: 2, end: 4 },
      caretPosition: -1,
    });

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).toHaveBeenCalledWith({ start: 2, end: 4 });
  });

  it("forwards empty selection layer on caret event so Editor clears context", () => {
    const onSelectionChange = vi.fn();
    render(
      <OveEditorHost
        doc={makeDoc()}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
        onSelectionChange={onSelectionChange}
      />,
    );

    capturedOnSelectionOrCaretChanged!({
      selectionLayer: { start: -1, end: -1 },
      caretPosition: 3,
    });

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).toHaveBeenCalledWith({ start: -1, end: -1 });
  });

  it("rerender uses latest onSelectionChange without recreating OVE editor", () => {
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();

    const { rerender } = render(
      <OveEditorHost
        doc={makeDoc()}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
        onSelectionChange={firstCallback}
      />,
    );

    expect(mockCreateVectorEditor).toHaveBeenCalledTimes(1);

    rerender(
      <OveEditorHost
        doc={makeDoc()}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
        onSelectionChange={secondCallback}
      />,
    );

    // OVE editor was NOT recreated on rerender
    expect(mockCreateVectorEditor).toHaveBeenCalledTimes(1);

    // But the latest callback is used
    capturedOnSelectionOrCaretChanged!({
      selectionLayer: { start: 1, end: 3 },
      caretPosition: -1,
    });

    expect(firstCallback).not.toHaveBeenCalled();
    expect(secondCallback).toHaveBeenCalledTimes(1);
    expect(secondCallback).toHaveBeenCalledWith({ start: 1, end: 3 });
  });

  // ── Validation marker track ───────────────────────────────

  it("renders the validation track when markers are provided", () => {
    const doc = makeDoc({ sequence: "A".repeat(100) });
    render(
      <OveEditorHost
        doc={doc}
        oveData={makeOveData({ sequence: doc.sequence })}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
        validationMarkers={[
          { id: "m1", start: 10, end: 20, tone: "pass", label: "Forward primer" },
          { id: "m2", start: 60, end: 70, tone: "fail", label: "Reverse primer" },
        ]}
      />,
    );
    expect(screen.getByLabelText("验证总览")).toBeDefined();
    expect(screen.getByLabelText("Select Forward primer at 11-20")).toBeDefined();
    expect(screen.getByLabelText("Select Reverse primer at 61-70")).toBeDefined();
  });

  it("hides the validation track when no markers exist", () => {
    render(
      <OveEditorHost
        doc={makeDoc()}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("验证总览")).toBeNull();
  });

  it("selects the marker region in the editor when clicked", () => {
    mockUpdateEditor.mockClear();
    const doc = makeDoc({ sequence: "A".repeat(100) });
    render(
      <OveEditorHost
        doc={doc}
        oveData={makeOveData({ sequence: doc.sequence })}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
        validationMarkers={[
          { id: "m1", start: 10, end: 20, tone: "warning", label: "Forward primer" },
        ]}
      />,
    );
    fireEvent.click(screen.getByLabelText("Select Forward primer at 11-20"));
    expect(mockUpdateEditor).toHaveBeenLastCalledWith({
      selectionLayer: { start: 10, end: 19 },
      caretPosition: -1,
    });
  });

  // ── Patch diff (Proposed) track ───────────────────────────

  it("renders the Proposed track when patch diff markers are provided", () => {
    const doc = makeDoc({ sequence: "A".repeat(100) });
    render(
      <OveEditorHost
        doc={doc}
        oveData={makeOveData({ sequence: doc.sequence })}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
        patchDiffMarkers={[
          {
            id: "op1",
            kind: "insert",
            start: 10,
            end: 10,
            label: "插入 +4 bp",
            reason: "add MCS",
            lengthDelta: 4,
          },
          {
            id: "op2",
            kind: "delete",
            start: 60,
            end: 70,
            label: "删除 10 bp",
            reason: "remove linker",
            lengthDelta: -10,
          },
        ]}
      />,
    );
    expect(screen.getByLabelText("建议更改总览")).toBeDefined();
    // Zero-width inserts announce a single position; ranged ops announce a range.
    expect(screen.getByLabelText("Select 插入 +4 bp at position 11")).toBeDefined();
    expect(screen.getByLabelText("Select 删除 10 bp at 61-70")).toBeDefined();
  });

  it("hides the Proposed track when no diff markers exist", () => {
    render(
      <OveEditorHost
        doc={makeDoc()}
        oveData={makeOveData()}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("建议更改总览")).toBeNull();
  });

  it("selects the diff marker region when clicked", () => {
    mockUpdateEditor.mockClear();
    const doc = makeDoc({ sequence: "A".repeat(100) });
    render(
      <OveEditorHost
        doc={doc}
        oveData={makeOveData({ sequence: doc.sequence })}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
        patchDiffMarkers={[
          {
            id: "op2",
            kind: "replace",
            start: 30,
            end: 35,
            label: "替换 +2 bp",
            reason: "swap codon",
            lengthDelta: 2,
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByLabelText("Select 替换 +2 bp at 31-35"));
    expect(mockUpdateEditor).toHaveBeenLastCalledWith({
      selectionLayer: { start: 30, end: 34 },
      caretPosition: -1,
    });
  });

  it("lights diff markers before patchDiffRevealCount and ghosts the rest", () => {
    const doc = makeDoc({ sequence: "A".repeat(100) });
    const { container } = render(
      <OveEditorHost
        doc={doc}
        oveData={makeOveData({ sequence: doc.sequence })}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
        patchDiffMarkers={[
          {
            id: "op1",
            kind: "insert",
            start: 10,
            end: 10,
            label: "插入 +4 bp",
            reason: "add MCS",
            lengthDelta: 4,
          },
          {
            id: "op2",
            kind: "delete",
            start: 60,
            end: 70,
            label: "删除 10 bp",
            reason: "remove linker",
            lengthDelta: -10,
          },
        ]}
        patchDiffRevealCount={1}
      />,
    );
    const markers = container.querySelectorAll(".ove-diff-track .ove-validation-track__marker");
    expect(markers.length).toBe(2);
    expect(markers[0]!.className).toContain("ove-diff-track__marker--revealed");
    expect(markers[1]!.className).toContain("ove-diff-track__marker--ghost");
  });

  it("shows a before→after tooltip when hovering a Proposed marker", () => {
    const doc = makeDoc({ sequence: "A".repeat(100) });
    const { container } = render(
      <OveEditorHost
        doc={doc}
        oveData={makeOveData({ sequence: doc.sequence })}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
        patchDiffMarkers={[
          {
            id: "op1",
            kind: "replace",
            start: 30,
            end: 35,
            label: "替换 +2 bp",
            reason: "swap codon",
            lengthDelta: 2,
            beforeSequence: "ATGCC",
            afterSequence: "GGATCC",
          },
        ]}
      />,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseEnter(screen.getByLabelText("Select 替换 +2 bp at 31-35"));
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("替换前");
    expect(tooltip.textContent).toContain("ATGCC");
    expect(tooltip.textContent).toContain("替换后");
    expect(tooltip.textContent).toContain("GGATCC");
    expect(tooltip.textContent).toContain("swap codon");
    // Hovering a marker must not hide the clickable track (still locatable).
    const marker = container.querySelector(".ove-diff-track__marker--revealed") as HTMLElement;
    fireEvent.click(marker);
    expect(mockUpdateEditor).toHaveBeenLastCalledWith({
      selectionLayer: { start: 30, end: 34 },
      caretPosition: -1,
    });
  });

  it("lights every diff marker by default when patchDiffRevealCount is omitted", () => {
    const doc = makeDoc({ sequence: "A".repeat(100) });
    const { container } = render(
      <OveEditorHost
        doc={doc}
        oveData={makeOveData({ sequence: doc.sequence })}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
        patchDiffMarkers={[
          {
            id: "op1",
            kind: "insert",
            start: 10,
            end: 10,
            label: "插入 +4 bp",
            reason: "add MCS",
            lengthDelta: 4,
          },
        ]}
      />,
    );
    const markers = container.querySelectorAll(".ove-diff-track .ove-validation-track__marker");
    expect(markers.length).toBe(1);
    expect(markers[0]!.className).toContain("ove-diff-track__marker--revealed");
    expect(container.querySelector(".ove-diff-track__marker--ghost")).toBeNull();
  });

  it("selects the feature range when a feature-overview segment is clicked", () => {
    const doc = makeDoc({
      sequence: "A".repeat(100),
      features: [
        {
          id: "f1",
          name: "ampR",
          type: "CDS",
          start: 20,
          end: 60,
          strand: 1 as const,
          qualifiers: {},
        },
      ],
    });
    render(
      <OveEditorHost
        doc={doc}
        oveData={makeOveData({ sequence: doc.sequence })}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "选择 ampR（21-60）" }));
    expect(mockUpdateEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        selectionLayer: { start: 20, end: 59 },
        caretPosition: -1,
      }),
    );
  });

  it("shows a rich tooltip when hovering a feature-overview segment", () => {
    const doc = makeDoc({
      sequence: "A".repeat(100),
      features: [
        {
          id: "f1",
          name: "ampR",
          type: "CDS",
          start: 20,
          end: 60,
          strand: 1 as const,
          qualifiers: {},
        },
      ],
    });
    const { container } = render(
      <OveEditorHost
        doc={doc}
        oveData={makeOveData({ sequence: doc.sequence })}
        onSaved={vi.fn()}
        onSaveError={vi.fn()}
      />,
    );
    const segment = container.querySelector(".ove-feature-overview__feature");
    expect(segment).not.toBeNull();
    fireEvent.mouseEnter(segment!);
    const tooltip = container.querySelector(".ove-feature-overview__tooltip");
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).toContain("ampR");
    expect(tooltip!.textContent).toContain("CDS");
    expect(tooltip!.textContent).toContain("21–60");
    fireEvent.mouseLeave(segment!);
    expect(container.querySelector(".ove-feature-overview__tooltip")).toBeNull();
  });
});
