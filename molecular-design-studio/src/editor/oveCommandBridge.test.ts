import { describe, expect, it, vi } from "vitest";
import { fingerprintDocument } from "../agent/fingerprint";
import { toOveData } from "./adapter";
import type { SequencePatch } from "../agent/patchTypes";
import type { SequenceDocument } from "../types";
import {
  createOveCommandBridge,
  OveCommandBridgeError,
  type OveLikeEditorInstance,
} from "./oveCommandBridge";

function makeDocument(): SequenceDocument {
  return {
    name: "pUC19",
    sequence: "AACCGGTTAACCGGTT",
    circular: true,
    features: [
      {
        id: "feature-1",
        name: "promoter",
        type: "promoter",
        start: 2,
        end: 8,
        strand: 1,
        qualifiers: { label: ["promoter"] },
      },
    ],
  };
}

function makeOveState(document: SequenceDocument, revision = 1): Record<string, unknown> {
  return {
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
    selectionLayer: { start: 3, end: 5 },
    caretPosition: -1,
  };
}

function makeEditor(document = makeDocument()): {
  editor: OveLikeEditorInstance;
  state: Record<string, unknown>;
  updates: Array<Record<string, unknown>>;
} {
  const state = makeOveState(document);
  const updates: Array<Record<string, unknown>> = [];
  const editor: OveLikeEditorInstance = {
    getState: () => state,
    updateEditor: (values) => updates.push(values),
  };
  return { editor, state, updates };
}

function makeInsertPatch(document: SequenceDocument): SequencePatch {
  return {
    schemaVersion: 1,
    id: "patch-1",
    title: "Insert tag",
    summary: "Add a small tag at the origin",
    baseHash: fingerprintDocument(document),
    operations: [
      {
        kind: "insert",
        id: "op-1",
        reason: "Add tag",
        position: 0,
        sequence: "GG",
      },
    ],
  };
}

describe("OveCommandBridge", () => {
  it("preserves canonical metadata and ignores display colors when validating a patch", () => {
    const document = { ...makeDocument(), accession: "TEST001", version: "1" };
    const { editor, state } = makeEditor(document);
    state.sequenceData = toOveData(document);
    const bridge = createOveCommandBridge({
      editor,
      getCanonicalDocument: () => document,
      applyCanonicalDocument: vi.fn(),
    });
    expect(bridge.readCurrentState().sequenceHash).toBe(fingerprintDocument(document));
    expect(bridge.previewPatch(makeInsertPatch(document)).errors).toEqual([]);
    state.sequenceData = toOveData({ ...document, sequence: "T" + document.sequence.slice(1) });
    expect(bridge.previewPatch(makeInsertPatch(document)).errors.length).toBeGreaterThan(0);
  });
  it("reads canonical document, selection, caret and revision from OVE state", () => {
    const { editor } = makeEditor();
    const bridge = createOveCommandBridge({
      editor,
      applyCanonicalDocument: vi.fn(),
    });

    const current = bridge.readCurrentState();

    expect(current.document.sequence).toBe("AACCGGTTAACCGGTT");
    expect(current.document.features[0]?.end).toBe(8);
    expect(current.selection).toMatchObject({
      start: 3,
      end: 6,
      length: 3,
      sequence: "CGG",
    });
    expect(current.caretPosition).toBeNull();
    expect(current.revision).toBe(1);
    expect(current.sequenceHash).toBe(fingerprintDocument(current.document));
  });

  it("sets SnapGene-like view panels and canonical focus ranges", () => {
    const { editor, updates } = makeEditor();
    const bridge = createOveCommandBridge({
      editor,
      applyCanonicalDocument: vi.fn(),
    });

    bridge.setView("both");
    expect(updates[0]).toEqual({
      panelsShown: [
        [{ id: "sequence", name: "Sequence Map", active: true }],
        [
          { id: "circular", name: "Circular Map", active: true },
          { id: "rail", name: "Linear Map", active: false },
        ],
      ],
    });

    bridge.setFocusRange({ start: 4, end: 8 });
    expect(updates[1]).toEqual({
      selectionLayer: { start: 4, end: 7 },
      caretPosition: -1,
    });

    bridge.setFocusRange({ start: 14, end: 2, wrapsOrigin: true });
    expect(updates[2]).toEqual({
      selectionLayer: { start: 14, end: 1 },
      caretPosition: -1,
    });

    bridge.setFocusRange({ start: 14, end: 0, wrapsOrigin: true });
    expect(updates[3]).toEqual({
      selectionLayer: { start: 14, end: 15 },
      caretPosition: -1,
    });
  });

  it("supports clearing focus and placing a caret", () => {
    const { editor, updates } = makeEditor();
    const bridge = createOveCommandBridge({ editor, applyCanonicalDocument: vi.fn() });

    bridge.setFocusRange({ start: 7, end: 7 });
    bridge.setFocusRange(null);

    expect(updates).toEqual([
      { selectionLayer: { start: -1, end: -1 }, caretPosition: 7 },
      { selectionLayer: { start: -1, end: -1 }, caretPosition: -1 },
    ]);
  });

  it("rejects invalid focus ranges before sending an OVE command", () => {
    const { editor, updates } = makeEditor();
    const bridge = createOveCommandBridge({ editor, applyCanonicalDocument: vi.fn() });

    expect(() => bridge.setFocusRange({ start: 4, end: 2 })).toThrowError(OveCommandBridgeError);
    expect(updates).toHaveLength(0);
  });

  it("creates an applicable preview without calling the canonical writer", () => {
    const document = makeDocument();
    const { editor } = makeEditor(document);
    const applyCanonicalDocument = vi.fn();
    const bridge = createOveCommandBridge({ editor, applyCanonicalDocument });

    const preview = bridge.previewPatch(makeInsertPatch(document));

    expect(preview.errors).toEqual([]);
    expect(preview.baseRevision).toBe(1);
    expect(preview.sourceHash).toBe(fingerprintDocument(document));
    expect(preview.proposedDocument?.sequence).toBe("GGAACCGGTTAACCGGTT");
    expect(applyCanonicalDocument).not.toHaveBeenCalled();
  });

  it("requires a bridge-created preview before applying", async () => {
    const { editor } = makeEditor();
    const bridge = createOveCommandBridge({ editor, applyCanonicalDocument: vi.fn() });
    const forged = { proposedDocument: makeDocument(), errors: [] } as never;

    await expect(bridge.applyConfirmedPatch(forged)).resolves.toMatchObject({
      ok: false,
      reason: "preview_required",
    });
  });

  it("rechecks document hash and revision, rejecting a stale preview", async () => {
    const document = makeDocument();
    const { editor, state } = makeEditor(document);
    const applyCanonicalDocument = vi.fn();
    const bridge = createOveCommandBridge({ editor, applyCanonicalDocument });
    const preview = bridge.previewPatch(makeInsertPatch(document));

    const sequenceData = state.sequenceData as Record<string, unknown>;
    sequenceData.sequence = `T${String(sequenceData.sequence)}`;
    state.revision = 2;

    await expect(bridge.applyConfirmedPatch(preview)).resolves.toMatchObject({
      ok: false,
      reason: "stale_preview",
    });
    expect(applyCanonicalDocument).not.toHaveBeenCalled();
  });

  it("applies only a confirmed preview through the canonical callback and consumes it", async () => {
    const document = makeDocument();
    const { editor } = makeEditor(document);
    const applyCanonicalDocument = vi.fn();
    const bridge = createOveCommandBridge({ editor, applyCanonicalDocument });
    const preview = bridge.previewPatch(makeInsertPatch(document));

    const result = await bridge.applyConfirmedPatch(preview);

    expect(result).toMatchObject({ ok: true, document: { sequence: "GGAACCGGTTAACCGGTT" } });
    expect(applyCanonicalDocument).toHaveBeenCalledTimes(1);
    expect(applyCanonicalDocument.mock.calls[0]?.[0].sequence).toBe("GGAACCGGTTAACCGGTT");
    expect(applyCanonicalDocument.mock.calls[0]?.[1]).toMatchObject({
      baseRevision: 1,
      currentRevision: 1,
    });

    await expect(bridge.applyConfirmedPatch(preview)).resolves.toMatchObject({
      ok: false,
      reason: "preview_required",
    });
  });

  it("surfaces canonical writer failures without pretending the patch applied", async () => {
    const document = makeDocument();
    const { editor } = makeEditor(document);
    const bridge = createOveCommandBridge({
      editor,
      applyCanonicalDocument: () => {
        throw new Error("canonical workspace rejected the write");
      },
    });
    const preview = bridge.previewPatch(makeInsertPatch(document));

    await expect(bridge.applyConfirmedPatch(preview)).resolves.toMatchObject({
      ok: false,
      reason: "apply_failed",
      errors: ["canonical workspace rejected the write"],
    });
  });

  it("exposes undo and redo hooks", async () => {
    const { editor } = makeEditor();
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const bridge = createOveCommandBridge({
      editor,
      applyCanonicalDocument: vi.fn(),
      onUndo,
      onRedo,
    });

    await bridge.commands.undo();
    await bridge.commands.redo();

    expect(onUndo).toHaveBeenCalledOnce();
    expect(onRedo).toHaveBeenCalledOnce();
  });
});
