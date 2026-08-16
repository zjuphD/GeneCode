import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWorkspace } from "./useWorkspace";
import { fingerprintDocument } from "../agent/fingerprint";
import { buildSafeExample } from "../agent/safeExample";
import type { SequenceDocument, SequenceSelection } from "../types";

function makeDoc(overrides: Partial<SequenceDocument> = {}): SequenceDocument {
  return {
    name: "test_seq",
    sequence: "ATCGATCGATCGATCG",
    circular: false,
    features: [],
    ...overrides,
  };
}

function loadDoc(
  result: { current: ReturnType<typeof useWorkspace> },
  doc: SequenceDocument,
) {
  act(() => {
    result.current.onFileOpen(doc, "/tmp/test.gb");
  });
}

describe("useWorkspace", () => {
  it("safe preview load does not change document/dirty/remount state", () => {
    const { result } = renderHook(() => useWorkspace());
    const doc = makeDoc();
    loadDoc(result, doc);

    const hashBefore = result.current.currentHash;
    const dirtyBefore = result.current.isDirty;
    const remountBefore = result.current.remountKey;

    act(() => {
      const patch = buildSafeExample(doc);
      result.current.loadPatchPreview(patch);
    });

    expect(result.current.currentHash).toBe(hashBefore);
    expect(result.current.isDirty).toBe(dirtyBefore);
    expect(result.current.remountKey).toBe(remountBefore);
    expect(result.current.pendingPreview).not.toBeNull();
    expect(result.current.pendingPreview!.errors).toHaveLength(0);
  });

  it("stores the normalized patch alongside its read-only preview", () => {
    const { result } = renderHook(() => useWorkspace());
    const doc = makeDoc();
    loadDoc(result, doc);
    const rawPatch = buildSafeExample(doc);

    act(() => {
      result.current.loadPatchPreview(rawPatch);
    });

    expect(result.current.pendingPatch).not.toBeNull();
    expect(result.current.pendingPatch).not.toBe(rawPatch);
    expect(result.current.pendingPatch).toEqual(rawPatch);
    expect(result.current.pendingPreview?.proposedDocument).not.toBeNull();
  });

  it("reject is a no-op on the document", () => {
    const { result } = renderHook(() => useWorkspace());
    const doc = makeDoc();
    loadDoc(result, doc);

    act(() => {
      result.current.loadPatchPreview(buildSafeExample(doc));
    });
    expect(result.current.pendingPreview).not.toBeNull();

    const hashBefore = result.current.currentHash;

    act(() => {
      result.current.rejectPendingPatch();
    });

    expect(result.current.pendingPreview).toBeNull();
    expect(result.current.currentHash).toBe(hashBefore);
    expect(result.current.isDirty).toBe(false);
  });

  it("apply adds one feature, marks dirty, increments remount, stores prior doc", () => {
    const { result } = renderHook(() => useWorkspace());
    const doc = makeDoc();
    loadDoc(result, doc);

    const hashBefore = result.current.currentHash;
    const remountBefore = result.current.remountKey;

    act(() => {
      result.current.loadPatchPreview(buildSafeExample(doc));
    });
    act(() => {
      result.current.applyPendingPatch();
    });

    expect(result.current.doc!.features).toHaveLength(1);
    expect(result.current.doc!.features[0]!.name).toBe("Agent review marker");
    expect(result.current.isDirty).toBe(true);
    expect(result.current.remountKey).toBe(remountBefore + 1);
    expect(result.current.pendingPreview).toBeNull();
    expect(result.current.revertDocument).not.toBeNull();
    expect(fingerprintDocument(result.current.revertDocument!)).toBe(hashBefore);
  });

  it("commits a bridge-confirmed Agent result through the Agent history action", () => {
    const { result } = renderHook(() => useWorkspace());
    const doc = makeDoc();
    loadDoc(result, doc);

    act(() => {
      result.current.loadPatchPreview(buildSafeExample(doc));
    });
    const patch = result.current.pendingPatch!;
    const preview = result.current.pendingPreview!;
    const proposed = preview.proposedDocument!;

    const remountBefore = result.current.remountKey;
    act(() => {
      result.current.commitAgentDocument(proposed, {
        patch,
        preview,
        currentDocument: doc,
        editorAlreadySynchronized: true,
      });
    });

    expect(result.current.doc).toEqual(proposed);
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0]?.source).toBe("agent");
    expect(result.current.revertDocument).toEqual(doc);
    expect(result.current.pendingPatch).toBeNull();
    expect(result.current.pendingPreview).toBeNull();
    expect(result.current.isDirty).toBe(true);
    expect(result.current.remountKey).toBe(remountBefore);
  });

  it("does not write when Agent Apply is attempted without a preview", () => {
    const { result } = renderHook(() => useWorkspace());
    const doc = makeDoc();
    loadDoc(result, doc);
    const proposed = { ...doc, sequence: `GG${doc.sequence}` };

    expect(() => {
      act(() => {
        result.current.commitAgentDocument(proposed);
      });
    }).toThrow("active preview");

    expect(result.current.doc).toEqual(doc);
    expect(result.current.history).toHaveLength(0);
    expect(result.current.isDirty).toBe(false);
  });

  it("preserves a preview and reports a readable bridge failure", () => {
    const { result } = renderHook(() => useWorkspace());
    const doc = makeDoc();
    loadDoc(result, doc);

    act(() => {
      result.current.loadPatchPreview(buildSafeExample(doc));
      result.current.setAgentApplyFailure(["Agent service rejected the change"]);
    });

    expect(result.current.pendingPatch).not.toBeNull();
    expect(result.current.pendingPreview).not.toBeNull();
    expect(result.current.status).toBe("Agent service rejected the change");
    expect(result.current.statusType).toBe("error");
  });

  it("clears stale preview after the bridge reports a stale Apply", () => {
    const { result } = renderHook(() => useWorkspace());
    const doc = makeDoc();
    loadDoc(result, doc);

    act(() => {
      result.current.loadPatchPreview(buildSafeExample(doc));
      result.current.setAgentApplyFailure(["Preview is stale"], true);
    });

    expect(result.current.pendingPatch).toBeNull();
    expect(result.current.pendingPreview).toBeNull();
    expect(result.current.status).toBe("Preview is stale");
    expect(result.current.statusType).toBe("error");
  });

  it("revert restores prior hash/features, remains dirty, increments remount, consumes snapshot", () => {
    const { result } = renderHook(() => useWorkspace());
    const doc = makeDoc();
    loadDoc(result, doc);

    const hashBefore = result.current.currentHash;

    act(() => {
      result.current.loadPatchPreview(buildSafeExample(doc));
    });
    act(() => {
      result.current.applyPendingPatch();
    });

    const remountAfterApply = result.current.remountKey;

    act(() => {
      result.current.revertLastAgentChange();
    });

    expect(result.current.currentHash).toBe(hashBefore);
    expect(result.current.doc!.features).toHaveLength(0);
    expect(result.current.isDirty).toBe(true);
    expect(result.current.remountKey).toBe(remountAfterApply + 1);
    expect(result.current.revertDocument).toBeNull();
  });

  it("manual OVE commit clears pending preview and revert state", () => {
    const { result } = renderHook(() => useWorkspace());
    const doc = makeDoc();
    loadDoc(result, doc);

    act(() => {
      result.current.loadPatchPreview(buildSafeExample(doc));
    });
    act(() => {
      result.current.applyPendingPatch();
    });

    expect(result.current.revertDocument).not.toBeNull();

    act(() => {
      result.current.onOveCommit({ ...doc, sequence: "AAAAAAAAAAAAAAAA" });
    });

    expect(result.current.pendingPreview).toBeNull();
    expect(result.current.revertDocument).toBeNull();
    expect(result.current.history[result.current.history.length - 1]?.label).toBe("Edited sequence");
  });

  it("records explicit document operations and restores the prior version", () => {
    const { result } = renderHook(() => useWorkspace());
    const doc = makeDoc();
    loadDoc(result, doc);

    act(() => {
      result.current.commitDocument(
        { ...doc, name: "renamed" },
        "Renamed sequence",
        "manual",
      );
    });

    expect(result.current.doc?.name).toBe("renamed");
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0]?.source).toBe("manual");

    const entryId = result.current.history[0]!.id;
    act(() => {
      result.current.restoreHistoryEntry(entryId);
    });

    expect(result.current.doc?.name).toBe("test_seq");
    expect(result.current.history[result.current.history.length - 1]?.source).toBe("history");
    expect(result.current.isDirty).toBe(true);
  });

  describe("canonical undo/redo (A-STATE-001)", () => {
    it("undo restores the previous document and moves the entry to the redo stack", () => {
      const { result } = renderHook(() => useWorkspace());
      loadDoc(result, makeDoc());
      const remountBefore = result.current.remountKey;

      act(() => {
        result.current.commitDocument(makeDoc({ name: "renamed" }), "Renamed sequence", "manual");
      });
      expect(result.current.doc?.name).toBe("renamed");
      expect(result.current.history).toHaveLength(1);
      expect(result.current.redoStack).toHaveLength(0);

      act(() => {
        const undone = result.current.undoDocument();
        expect(undone?.name).toBe("test_seq");
      });

      expect(result.current.doc?.name).toBe("test_seq");
      expect(result.current.history).toHaveLength(0);
      expect(result.current.redoStack).toHaveLength(1);
      expect(result.current.redoStack[0]?.label).toBe("Renamed sequence");
      expect(result.current.isDirty).toBe(true);
      expect(result.current.remountKey).toBeGreaterThan(remountBefore);
      // Undo is not itself an operation — it must not pollute the timeline.
      expect(result.current.status).toBe("Undid \u201cRenamed sequence\u201d");
    });

    it("redo restores the undone document and re-appends the entry", () => {
      const { result } = renderHook(() => useWorkspace());
      loadDoc(result, makeDoc());

      act(() => {
        result.current.commitDocument(makeDoc({ name: "renamed" }), "Renamed sequence", "manual");
      });
      act(() => {
        result.current.undoDocument();
      });
      expect(result.current.doc?.name).toBe("test_seq");

      act(() => {
        const redone = result.current.redoDocument();
        expect(redone?.name).toBe("renamed");
      });

      expect(result.current.doc?.name).toBe("renamed");
      expect(result.current.redoStack).toHaveLength(0);
      expect(result.current.history).toHaveLength(1);
      expect(result.current.history[0]?.label).toBe("Renamed sequence");
    });

    it("undo then undo redo redo walks the full timeline in order", () => {
      const { result } = renderHook(() => useWorkspace());
      loadDoc(result, makeDoc());

      act(() => {
        result.current.commitDocument(makeDoc({ name: "step1" }), "Step one", "manual");
      });
      act(() => {
        result.current.commitDocument(makeDoc({ name: "step2" }), "Step two", "manual");
      });

      act(() => { result.current.undoDocument(); });
      expect(result.current.doc?.name).toBe("step1");
      act(() => { result.current.undoDocument(); });
      expect(result.current.doc?.name).toBe("test_seq");
      // LIFO: the last-undone operation redoes first.
      expect(result.current.redoStack.map((entry) => entry.label)).toEqual([
        "Step two",
        "Step one",
      ]);

      act(() => { result.current.redoDocument(); });
      expect(result.current.doc?.name).toBe("step1");
      act(() => { result.current.redoDocument(); });
      expect(result.current.doc?.name).toBe("step2");
      expect(result.current.history).toHaveLength(2);
      expect(result.current.redoStack).toHaveLength(0);
    });

    it("a new operation after undo clears the redo stack", () => {
      const { result } = renderHook(() => useWorkspace());
      loadDoc(result, makeDoc());

      act(() => {
        result.current.commitDocument(makeDoc({ name: "renamed" }), "Renamed sequence", "manual");
      });
      act(() => { result.current.undoDocument(); });
      expect(result.current.redoStack).toHaveLength(1);

      act(() => {
        result.current.commitDocument(makeDoc({ name: "other" }), "Other edit", "manual");
      });
      expect(result.current.redoStack).toHaveLength(0);
      expect(result.current.history).toHaveLength(1);
    });

    it("undo/redo with empty stacks are safe no-ops", () => {
      const { result } = renderHook(() => useWorkspace());
      loadDoc(result, makeDoc());

      expect(result.current.undoDocument()).toBeNull();
      expect(result.current.redoDocument()).toBeNull();
      expect(result.current.doc?.name).toBe("test_seq");
      expect(result.current.history).toHaveLength(0);
    });

    it("refuses to undo when the live document diverges from the last entry (stale persisted history)", () => {
      const { result } = renderHook(() => useWorkspace());
      loadDoc(result, makeDoc());

      // Simulate a persisted project whose timeline's last `after` no longer
      // matches the live document (unsaved edits lost with the old session).
      act(() => {
        result.current.replaceHistory([
          {
            id: "stale",
            label: "Stale edit",
            source: "manual",
            timestamp: 1,
            before: makeDoc({ name: "older" }),
            after: makeDoc({ name: "unrelated" }),
            beforeHash: fingerprintDocument(makeDoc({ name: "older" })),
            afterHash: fingerprintDocument(makeDoc({ name: "unrelated" })),
          },
        ]);
      });

      expect(result.current.undoDocument()).toBeNull();
      expect(result.current.doc?.name).toBe("test_seq");
      expect(result.current.redoStack).toHaveLength(0);
    });

    it("a manual OVE commit after undo clears the redo stack", () => {
      const { result } = renderHook(() => useWorkspace());
      loadDoc(result, makeDoc());

      act(() => {
        result.current.commitDocument(makeDoc({ name: "renamed" }), "Renamed sequence", "manual");
      });
      act(() => { result.current.undoDocument(); });
      expect(result.current.redoStack).toHaveLength(1);

      act(() => {
        result.current.onOveCommit(makeDoc({ sequence: "AAAAAAAAAAAAAAAA" }));
      });
      expect(result.current.redoStack).toHaveLength(0);
    });
  });

  it("records an Agent patch in the unified document history", () => {
    const { result } = renderHook(() => useWorkspace());
    const doc = makeDoc();
    loadDoc(result, doc);

    act(() => {
      result.current.loadPatchPreview(buildSafeExample(doc));
    });
    act(() => {
      result.current.applyPendingPatch();
    });

    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0]?.source).toBe("agent");
    expect(result.current.history[0]?.before.features).toHaveLength(0);
    expect(result.current.history[0]?.after.features).toHaveLength(1);
  });

  it("loads a project's saved history without sharing mutable snapshots", () => {
    const { result } = renderHook(() => useWorkspace());
    const doc = makeDoc();
    const edited = { ...doc, name: "edited" };
    loadDoc(result, edited);
    const history = [{
      id: "h1",
      label: "Renamed sequence",
      source: "manual" as const,
      timestamp: 1,
      before: doc,
      after: edited,
      beforeHash: fingerprintDocument(doc),
      afterHash: fingerprintDocument(edited),
    }];

    act(() => {
      result.current.replaceHistory(history);
    });

    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0]).not.toBe(history[0]);
    expect(result.current.history[0]?.before).not.toBe(doc);
  });

  it("file open clears pending preview and revert state", () => {
    const { result } = renderHook(() => useWorkspace());
    const doc = makeDoc();
    loadDoc(result, doc);

    act(() => {
      result.current.loadPatchPreview(buildSafeExample(doc));
    });
    act(() => {
      result.current.applyPendingPatch();
    });

    expect(result.current.revertDocument).not.toBeNull();

    const newDoc = makeDoc({ name: "new_seq" });
    act(() => {
      result.current.onFileOpen(newDoc, "/tmp/new.gb");
    });

    expect(result.current.pendingPreview).toBeNull();
    expect(result.current.revertDocument).toBeNull();
  });

  it("project switch via setDoc clears pending preview and Agent revert snapshot", () => {
    const { result } = renderHook(() => useWorkspace());
    const doc = makeDoc();
    loadDoc(result, doc);

    act(() => {
      result.current.loadPatchPreview(buildSafeExample(doc));
    });
    act(() => {
      result.current.applyPendingPatch();
    });
    expect(result.current.revertDocument).not.toBeNull();

    const currentAfterApply = result.current.doc!;
    act(() => {
      result.current.loadPatchPreview(buildSafeExample(currentAfterApply));
    });

    expect(result.current.pendingPreview).not.toBeNull();
    expect(result.current.revertDocument).not.toBeNull();

    const changedDoc = { ...currentAfterApply, name: "other_project" };
    act(() => {
      result.current.setDoc(changedDoc);
    });

    expect(result.current.doc).toEqual(changedDoc);
    expect(result.current.pendingPatch).toBeNull();
    expect(result.current.pendingPreview).toBeNull();
    expect(result.current.revertDocument).toBeNull();
  });

  it("setDoc remounts OVE when features differ despite identical name and sequence", () => {
    const { result } = renderHook(() => useWorkspace());
    const base = makeDoc();
    loadDoc(result, base);

    const remountBefore = result.current.remountKey;

    // Same name and sequence, different annotations: the fingerprint differs,
    // so the editor must remount to avoid showing stale features.
    const sameIdentityDifferentFeatures: SequenceDocument = {
      ...base,
      features: [{
        id: "feat-1",
        name: "Promoter",
        type: "promoter",
        start: 1,
        end: 5,
        strand: 1,
        qualifiers: {},
      }],
    };
    act(() => {
      result.current.setDoc(sameIdentityDifferentFeatures);
    });
    expect(result.current.remountKey).toBe(remountBefore + 1);

    // Setting a content-identical document (even a fresh object) is a no-op.
    act(() => {
      result.current.setDoc({
        ...sameIdentityDifferentFeatures,
        features: [...sameIdentityDifferentFeatures.features],
      });
    });
    expect(result.current.remountKey).toBe(remountBefore + 1);
  });

  it("setDoc does not remount OVE for a content-identical document", () => {
    const { result } = renderHook(() => useWorkspace());
    const doc = makeDoc();
    loadDoc(result, doc);

    const remountBefore = result.current.remountKey;
    act(() => {
      result.current.setDoc({ ...doc, features: [...doc.features] });
    });
    expect(result.current.remountKey).toBe(remountBefore);
  });

  // ── Malformed input safety (never throws) ─────────────────

  describe("loadPatchPreview safety", () => {
    it("handles missing insert sequence without throwing", () => {
      const { result } = renderHook(() => useWorkspace());
      const doc = makeDoc();
      loadDoc(result, doc);

      let ok = true;
      act(() => {
        ok = result.current.loadPatchPreview({
          schemaVersion: 1,
          id: "p",
          title: "t",
          summary: "s",
          baseHash: fingerprintDocument(doc),
          operations: [{ kind: "insert", id: "op", reason: "r", position: 0 }],
        });
      });

      expect(ok).toBe(false);
      expect(result.current.pendingPreview).not.toBeNull();
      expect(result.current.pendingPreview!.errors.length).toBeGreaterThan(0);
      expect(result.current.pendingPreview!.proposedDocument).toBeNull();
    });

    it("handles unknown operation kind without throwing", () => {
      const { result } = renderHook(() => useWorkspace());
      const doc = makeDoc();
      loadDoc(result, doc);

      let ok = true;
      act(() => {
        ok = result.current.loadPatchPreview({
          schemaVersion: 1,
          id: "p",
          title: "t",
          summary: "s",
          baseHash: fingerprintDocument(doc),
          operations: [{ kind: "splice", id: "op", reason: "r" }],
        });
      });

      expect(ok).toBe(false);
      expect(result.current.pendingPreview).not.toBeNull();
      expect(result.current.pendingPreview!.errors.some((e) => e.includes("unsupported"))).toBe(true);
    });

    it("handles null add-feature value without throwing", () => {
      const { result } = renderHook(() => useWorkspace());
      const doc = makeDoc();
      loadDoc(result, doc);

      let ok = true;
      act(() => {
        ok = result.current.loadPatchPreview({
          schemaVersion: 1,
          id: "p",
          title: "t",
          summary: "s",
          baseHash: fingerprintDocument(doc),
          operations: [{ kind: "add_feature", id: "op", reason: "r", feature: null }],
        });
      });

      expect(ok).toBe(false);
      expect(result.current.pendingPreview).not.toBeNull();
      expect(result.current.pendingPreview!.errors.some((e) => e.includes("feature"))).toBe(true);
    });

    it("handles malformed operations array items without throwing", () => {
      const { result } = renderHook(() => useWorkspace());
      const doc = makeDoc();
      loadDoc(result, doc);

      let ok = true;
      act(() => {
        ok = result.current.loadPatchPreview({
          schemaVersion: 1,
          id: "p",
          title: "t",
          summary: "s",
          baseHash: fingerprintDocument(doc),
          operations: [null, 42, "hello"],
        });
      });

      expect(ok).toBe(false);
      expect(result.current.pendingPreview).not.toBeNull();
      expect(result.current.pendingPreview!.errors.length).toBeGreaterThan(0);
    });

    it("handles non-object input without throwing", () => {
      const { result } = renderHook(() => useWorkspace());
      const doc = makeDoc();
      loadDoc(result, doc);

      let ok = true;
      act(() => {
        ok = result.current.loadPatchPreview("not a patch");
      });

      expect(ok).toBe(false);
      expect(result.current.pendingPreview).not.toBeNull();
      expect(result.current.pendingPreview!.proposedDocument).toBeNull();
    });
  });

  // ── Selection state ────────────────────────────────────────

  describe("selection state", () => {
    const makeSelection = (overrides: Partial<SequenceSelection> = {}): SequenceSelection => ({
      start: 10,
      end: 21,
      length: 11,
      wrapsOrigin: false,
      sequence: "ATCGATCGATC",
      ...overrides,
    });

    it("starts as null", () => {
      const { result } = renderHook(() => useWorkspace());
      expect(result.current.selection).toBeNull();
    });

    it("onSelectionChange updates selection", () => {
      const { result } = renderHook(() => useWorkspace());
      const sel = makeSelection();
      act(() => {
        result.current.onSelectionChange(sel);
      });
      expect(result.current.selection).toEqual(sel);
    });

    it("onSelectionChange(null) clears selection", () => {
      const { result } = renderHook(() => useWorkspace());
      act(() => {
        result.current.onSelectionChange(makeSelection());
      });
      expect(result.current.selection).not.toBeNull();
      act(() => {
        result.current.onSelectionChange(null);
      });
      expect(result.current.selection).toBeNull();
    });

    it("selection change does not mark dirty", () => {
      const { result } = renderHook(() => useWorkspace());
      const doc = makeDoc();
      loadDoc(result, doc);
      expect(result.current.isDirty).toBe(false);
      act(() => {
        result.current.onSelectionChange(makeSelection());
      });
      expect(result.current.isDirty).toBe(false);
    });

    it("file open clears selection", () => {
      const { result } = renderHook(() => useWorkspace());
      loadDoc(result, makeDoc());
      act(() => {
        result.current.onSelectionChange(makeSelection());
      });
      expect(result.current.selection).not.toBeNull();
      const newDoc = makeDoc({ name: "new_seq" });
      act(() => {
        result.current.onFileOpen(newDoc, "/tmp/new.gb");
      });
      expect(result.current.selection).toBeNull();
    });

    it("OVE commit clears selection", () => {
      const { result } = renderHook(() => useWorkspace());
      loadDoc(result, makeDoc());
      act(() => {
        result.current.onSelectionChange(makeSelection());
      });
      expect(result.current.selection).not.toBeNull();
      act(() => {
        result.current.onOveCommit(makeDoc({ sequence: "AAAAAAAAAAAAAAAA" }));
      });
      expect(result.current.selection).toBeNull();
    });

    it("apply pending patch clears selection", () => {
      const { result } = renderHook(() => useWorkspace());
      const doc = makeDoc();
      loadDoc(result, doc);
      act(() => {
        result.current.onSelectionChange(makeSelection());
      });
      act(() => {
        result.current.loadPatchPreview(buildSafeExample(doc));
      });
      act(() => {
        result.current.applyPendingPatch();
      });
      expect(result.current.selection).toBeNull();
    });

    it("revert clears selection", () => {
      const { result } = renderHook(() => useWorkspace());
      const doc = makeDoc();
      loadDoc(result, doc);
      act(() => {
        result.current.loadPatchPreview(buildSafeExample(doc));
      });
      act(() => {
        result.current.applyPendingPatch();
      });
      act(() => {
        result.current.onSelectionChange(makeSelection());
      });
      expect(result.current.selection).not.toBeNull();
      act(() => {
        result.current.revertLastAgentChange();
      });
      expect(result.current.selection).toBeNull();
    });

    it("setDoc clears selection", () => {
      const { result } = renderHook(() => useWorkspace());
      loadDoc(result, makeDoc());
      act(() => {
        result.current.onSelectionChange(makeSelection());
      });
      expect(result.current.selection).not.toBeNull();
      act(() => {
        result.current.setDoc(makeDoc({ name: "changed" }));
      });
      expect(result.current.selection).toBeNull();
    });

    it("remountOve clears selection", () => {
      const { result } = renderHook(() => useWorkspace());
      loadDoc(result, makeDoc());
      act(() => {
        result.current.onSelectionChange(makeSelection());
      });
      expect(result.current.selection).not.toBeNull();
      act(() => {
        result.current.remountOve();
      });
      expect(result.current.selection).toBeNull();
    });
  });
});
