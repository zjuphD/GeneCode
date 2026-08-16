/**
 * Shared workspace hook for Editor and AgentPanel.
 *
 * Owns canonical document, file state, dirty flag, Agent patch/preview,
 * and one-step revert capability.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { SequenceDocument, SequenceSelection } from "../types";
import type { PatchPreview, SequencePatch } from "../agent/patchTypes";
import { fingerprintDocument } from "../agent/fingerprint";
import { parseAndValidatePatch } from "../agent/patchEngine";
import { buildPreview } from "../agent/preview";
import { loadWorkspace, parsePersistedWorkspace, saveWorkspace } from "./workspacePersistence";
import { readDurable, writeDurable } from "./durablePersistence";
import {
  MAX_DOCUMENT_HISTORY,
  appendDocumentHistory,
  copyHistoryDocument,
  createDocumentHistoryEntry,
  type DocumentHistoryEntry,
  type DocumentHistorySource,
} from "./documentHistory";

export interface WorkspaceState {
  doc: SequenceDocument | null;
  /** True until the IndexedDB mirror has either recovered or been ruled out. */
  isRestoring: boolean;
  filePath: string | null;
  basename: string | null;
  isDirty: boolean;
  remountKey: number;
  status: string | null;
  statusType: "success" | "error" | null;
  /** Last autosave failure message, or null when the last save succeeded. */
  saveError: string | null;
  currentHash: string | null;
  /** The normalized patch that produced pendingPreview. Never use raw Agent input here. */
  pendingPatch: SequencePatch | null;
  pendingPreview: PatchPreview | null;
  revertDocument: SequenceDocument | null;
  selection: SequenceSelection | null;
  history: DocumentHistoryEntry[];
  /**
   * A-STATE-001: entries popped by undoDocument(), re-applied by redoDocument().
   * The canonical operation log is the single undo/redo source; the engine's
   * internal VE_UNDO stack is never reached (hotkeys/toolbar route here).
   */
  redoStack: DocumentHistoryEntry[];
}

/** Minimal context required for the canonical Agent commit boundary. */
export interface WorkspaceAgentCommitContext {
  readonly patch: SequencePatch;
  readonly preview: PatchPreview;
  readonly currentDocument?: SequenceDocument;
  /** The live OVE instance already received this document through the bridge. */
  readonly editorAlreadySynchronized?: boolean;
}

export interface WorkspaceActions {
  setDoc: (doc: SequenceDocument) => void;
  setFilePath: (path: string | null) => void;
  setIsDirty: (dirty: boolean) => void;
  setStatus: (msg: string | null, type: "success" | "error" | null) => void;
  remountOve: () => void;
  onOveCommit: (saved: SequenceDocument) => void;
  onOveError: (errors: readonly string[]) => void;
  onFileOpen: (doc: SequenceDocument, path: string) => void;
  onSelectionChange: (selection: SequenceSelection | null) => void;
  commitDocument: (
    doc: SequenceDocument,
    label: string,
    source?: DocumentHistorySource,
  ) => SequenceDocument;
  /** Commit a bridge-confirmed Agent result as source=agent. */
  commitAgentDocument: (
    doc: SequenceDocument,
    context?: WorkspaceAgentCommitContext,
  ) => SequenceDocument;
  restoreHistoryEntry: (
    id: string,
    version?: "before" | "after",
  ) => SequenceDocument | null;
  /** Undo the most recent canonical operation (Cmd/Ctrl+Z). */
  undoDocument: () => SequenceDocument | null;
  /** Redo the last undone operation (Cmd/Ctrl+Shift+Z / Cmd/Ctrl+Y). */
  redoDocument: () => SequenceDocument | null;
  clearHistory: () => void;
  replaceHistory: (history: DocumentHistoryEntry[]) => void;
  loadPatchPreview: (patch: unknown) => boolean;
  applyPendingPatch: () => SequenceDocument | null;
  setAgentApplyFailure: (errors: readonly string[], clearPreview?: boolean) => void;
  rejectPendingPatch: () => void;
  revertLastAgentChange: () => SequenceDocument | null;
}

function getBasename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? path;
}

function makeErrorPreview(
  doc: SequenceDocument,
  errors: string[],
  patchId = "invalid",
  title = "Invalid patch",
  summary = "Patch input was not a valid object",
): PatchPreview {
  return {
    patchId,
    title,
    summary,
    baseHash: "",
    proposedHash: null,
    beforeLength: doc.sequence.length,
    afterLength: null,
    operations: [],
    affectedFeatures: [],
    warnings: [],
    errors,
    proposedDocument: null,
  };
}

export function useWorkspace(): WorkspaceState & WorkspaceActions {
  const [restored] = useState(loadWorkspace);
  const [doc, setDocRaw] = useState<SequenceDocument | null>(restored?.doc ?? null);
  const [filePath, setFilePathRaw] = useState<string | null>(restored?.filePath ?? null);
  const [isDirty, setIsDirty] = useState(restored?.isDirty ?? false);
  const [remountKey, setRemountKey] = useState(0);
  const [status, setStatusRaw] = useState<string | null>(null);
  const [statusType, setStatusTypeRaw] = useState<"success" | "error" | null>(null);
  const [pendingPatch, setPendingPatch] = useState<SequencePatch | null>(null);
  const [pendingPreview, setPendingPreview] = useState<PatchPreview | null>(null);
  const [revertDocument, setRevertDocument] = useState<SequenceDocument | null>(null);
  const [selection, setSelection] = useState<SequenceSelection | null>(null);
  const [history, setHistory] = useState<DocumentHistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<DocumentHistoryEntry[]>([]);
  // A-DATA-001: autosave result surfaced so the UI never claims "Saved" on a
  // failed write. null = last write succeeded (or nothing to persist yet).
  const [saveError, setSaveError] = useState<string | null>(null);
  const [durableHydrated, setDurableHydrated] = useState(
    () => restored !== null || import.meta.env.MODE === "test",
  );
  const docRef = useRef<SequenceDocument | null>(doc);
  const pendingPatchRef = useRef<SequencePatch | null>(pendingPatch);
  const pendingPreviewRef = useRef<PatchPreview | null>(pendingPreview);
  docRef.current = doc;
  pendingPatchRef.current = pendingPatch;
  pendingPreviewRef.current = pendingPreview;

  // Recover from the transactional IndexedDB mirror when localStorage is
  // unavailable/corrupt. Never overwrite a document opened by the user while
  // the asynchronous recovery is in flight.
  useEffect(() => {
    if (durableHydrated) return;
    let cancelled = false;
    void readDurable<ReturnType<typeof loadWorkspace>>("workspace").then((record) => {
      if (cancelled) return;
      const recovered = parsePersistedWorkspace(record?.payload);
      if (recovered && !docRef.current) {
        docRef.current = recovered.doc;
        setDocRaw(recovered.doc);
        setFilePathRaw(recovered.filePath);
        setIsDirty(recovered.isDirty);
        setRemountKey((key) => key + 1);
      }
      setDurableHydrated(true);
    });
    return () => { cancelled = true; };
  }, [durableHydrated]);

  const basename = useMemo(() => {
    if (!filePath) return null;
    return getBasename(filePath);
  }, [filePath]);

  const currentHash = useMemo(() => {
    if (!doc) return null;
    return fingerprintDocument(doc);
  }, [doc]);

  useEffect(() => {
    if (!doc || !durableHydrated) return;
    const payload = {
      schemaVersion: 1,
      version: 1,
      savedAt: Date.now(),
      doc,
      filePath,
      isDirty,
    } as const;
    const result = saveWorkspace(payload);
    if (result.ok) {
      if (import.meta.env.MODE !== "test") setSaveError(null);
    } else {
      setSaveError(result.message);
    }
    if (result.ok) {
      void writeDurable("workspace", payload, payload.savedAt).catch((error: unknown) => {
        setSaveError(`Durable autosave failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }, [doc, durableHydrated, filePath, isDirty]);

  const setDoc = useCallback((d: SequenceDocument) => {
    // A document/project switch invalidates both the proposal and the one-step
    // Agent revert snapshot. Neither belongs to the newly active document.
    const previous = docRef.current;
    docRef.current = d;
    pendingPatchRef.current = null;
    pendingPreviewRef.current = null;
    setPendingPatch(null);
    setPendingPreview(null);
    setRevertDocument(null);
    // Force OVE remount when the document content identity changes. Compare the
    // full fingerprint (name + sequence + features) instead of name/sequence
    // alone, so switching between two projects that share a name and sequence
    // but carry different annotations reloads the editor instead of showing
    // stale features. The comparison runs outside the state updater to keep the
    // updater pure under Strict Mode.
    if (previous && fingerprintDocument(previous) !== fingerprintDocument(d)) {
      setRemountKey((k) => k + 1);
    }
    setDocRaw(d);
    setSelection(null);
    setHistory([]);
    setRedoStack([]);
  }, []);

  const setFilePath = useCallback((p: string | null) => {
    setFilePathRaw(p);
  }, []);

  const setStatus = useCallback(
    (msg: string | null, type: "success" | "error" | null) => {
      setStatusRaw(msg);
      setStatusTypeRaw(type);
    },
    [],
  );

  const remountOve = useCallback(() => {
    setRemountKey((k) => k + 1);
    setSelection(null);
  }, []);

  const onOveCommit = useCallback(
    (saved: SequenceDocument) => {
      if (doc) {
        const entry = createDocumentHistoryEntry(
          doc,
          saved,
          "Edited sequence",
          "manual",
        );
        setHistory((current) => appendDocumentHistory(current, entry));
      }
      setDocRaw(saved);
      setIsDirty(true);
      setRedoStack([]);
      // Manual OVE commit clears pending/revert state
      pendingPatchRef.current = null;
      setPendingPatch(null);
      pendingPreviewRef.current = null;
      setPendingPreview(null);
      setRevertDocument(null);
      setSelection(null);
      setStatusRaw("Edits committed");
      setStatusTypeRaw("success");
    },
    [doc],
  );

  const onOveError = useCallback((errors: readonly string[]) => {
    setStatusRaw(errors[0] ?? "Save error");
    setStatusTypeRaw("error");
  }, []);

  const onFileOpen = useCallback(
    (newDoc: SequenceDocument, path: string) => {
      docRef.current = newDoc;
      setDocRaw(newDoc);
      setFilePathRaw(path);
      setIsDirty(false);
      setRemountKey((k) => k + 1);
      setStatusRaw(null);
      setStatusTypeRaw(null);
      // File open clears Agent state and selection
      pendingPatchRef.current = null;
      setPendingPatch(null);
      pendingPreviewRef.current = null;
      setPendingPreview(null);
      setRevertDocument(null);
      setSelection(null);
      setRedoStack([]);
      setHistory([]);
    },
    [],
  );

  const onSelectionChange = useCallback((sel: SequenceSelection | null) => {
    setSelection(sel);
  }, []);

  const commitDocument = useCallback((
    nextDoc: SequenceDocument,
    label: string,
    source: DocumentHistorySource = "manual",
  ): SequenceDocument => {
    if (doc) {
      const entry = createDocumentHistoryEntry(doc, nextDoc, label, source);
      setHistory((current) => appendDocumentHistory(current, entry));
      if (!entry) return doc;
    }
    setDocRaw(copyHistoryDocument(nextDoc));
    setIsDirty(true);
    setRemountKey((key) => key + 1);
    setRedoStack([]);
    setPendingPreview(null);
    setPendingPatch(null);
    pendingPatchRef.current = null;
    pendingPreviewRef.current = null;
    setRevertDocument(null);
    setSelection(null);
    setStatusRaw(label);
    setStatusTypeRaw("success");
    return nextDoc;
  }, [doc]);

  const commitAgentDocument = useCallback((
    nextDoc: SequenceDocument,
    context?: WorkspaceAgentCommitContext,
  ): SequenceDocument => {
    const currentDoc = docRef.current;
    const expectedPatch = pendingPatchRef.current;
    const expectedPreview = pendingPreviewRef.current;
    if (!currentDoc || !expectedPatch || !expectedPreview) {
      throw new Error("Agent apply requires an active preview");
    }

    const currentHashNow = fingerprintDocument(currentDoc);
    if (expectedPreview.baseHash !== currentHashNow) {
      throw new Error("Agent preview is stale — the document changed since preview");
    }

    if (context) {
      if (
        context.patch.id !== expectedPatch.id ||
        context.patch.baseHash !== expectedPatch.baseHash ||
        JSON.stringify(context.patch) !== JSON.stringify(expectedPatch)
      ) {
        throw new Error("Agent preview does not match the pending patch");
      }
      if (
        context.currentDocument &&
        fingerprintDocument(context.currentDocument) !== currentHashNow
      ) {
        throw new Error("Agent preview is stale — the live editor changed");
      }
      if (
        context.preview.baseHash !== currentHashNow ||
        (context.preview.proposedHash !== null &&
          context.preview.proposedHash !== fingerprintDocument(nextDoc))
      ) {
        throw new Error("Agent preview does not match the proposed document");
      }
    }

    if (
      expectedPreview.proposedHash !== null &&
      expectedPreview.proposedHash !== fingerprintDocument(nextDoc)
    ) {
      throw new Error("Agent preview does not match the proposed document");
    }

    const entry = createDocumentHistoryEntry(
      currentDoc,
      nextDoc,
      expectedPreview.title || "Applied Agent proposal",
      "agent",
    );
    if (!entry) throw new Error("Agent proposal does not change the document");

    setHistory((current) => appendDocumentHistory(current, entry));
    setRevertDocument(copyHistoryDocument(currentDoc));
    setDocRaw(copyHistoryDocument(nextDoc));
    setIsDirty(true);
    setRedoStack([]);
    if (!context?.editorAlreadySynchronized) {
      setRemountKey((k) => k + 1);
    }
    pendingPatchRef.current = null;
    setPendingPatch(null);
    pendingPreviewRef.current = null;
    setPendingPreview(null);
    setSelection(null);
    setStatusRaw("Agent patch applied");
    setStatusTypeRaw("success");
    return nextDoc;
  }, []);

  const restoreHistoryEntry = useCallback((
    id: string,
    version: "before" | "after" = "before",
  ): SequenceDocument | null => {
    if (!doc) return null;
    const selected = history.find((entry) => entry.id === id);
    if (!selected) return null;
    const target = copyHistoryDocument(selected[version]);
    const restoreEntry = createDocumentHistoryEntry(
      doc,
      target,
      `Restored ${version === "before" ? "before" : "after"} “${selected.label}”`,
      "history",
    );
    if (!restoreEntry) return doc;

    setHistory((current) => appendDocumentHistory(current, restoreEntry));
    setDocRaw(target);
    setIsDirty(true);
    setRemountKey((key) => key + 1);
    setRedoStack([]);
    pendingPatchRef.current = null;
    setPendingPatch(null);
    pendingPreviewRef.current = null;
    setPendingPreview(null);
    setRevertDocument(null);
    setSelection(null);
    setStatusRaw("History version restored");
    setStatusTypeRaw("success");
    return target;
  }, [doc, history]);

  /**
   * A-STATE-001: canonical undo. Pops the most recent operation from the
   * timeline (no new "history" entry — undoing is not an operation) and moves
   * it onto the redo stack. The restored document is pushed into OVE via the
   * same remount boundary as restoreHistoryEntry, so the engine always renders
   * canonical state and its internal VE_UNDO stack never diverges.
   */
  const undoDocument = useCallback((): SequenceDocument | null => {
    if (!doc || history.length === 0) return null;
    const entry = history[history.length - 1]!;
    // Defensive guard: the timeline's last entry must correspond to the live
    // document. History restored from a persisted project could otherwise be
    // stale (unsaved edits lost with the previous session), and popping it
    // would jump to an arbitrary `before`. Refuse instead of guessing.
    if (fingerprintDocument(doc) !== entry.afterHash) return null;
    const target = copyHistoryDocument(entry.before);
    setHistory((current) => current.slice(0, -1));
    setRedoStack((current) => [...current, entry].slice(-MAX_DOCUMENT_HISTORY));
    setDocRaw(target);
    setIsDirty(true);
    setRemountKey((key) => key + 1);
    pendingPatchRef.current = null;
    setPendingPatch(null);
    pendingPreviewRef.current = null;
    setPendingPreview(null);
    setRevertDocument(null);
    setSelection(null);
    setStatusRaw(`Undid \u201c${entry.label}\u201d`);
    setStatusTypeRaw("success");
    return target;
  }, [doc, history]);

  /**
   * A-STATE-001: canonical redo. Pops the last undone operation off the redo
   * stack, re-appends it to the timeline (so the History panel stays linear),
   * and restores its `after` document.
   */
  const redoDocument = useCallback((): SequenceDocument | null => {
    if (!doc || redoStack.length === 0) return null;
    const entry = redoStack[redoStack.length - 1]!;
    const target = copyHistoryDocument(entry.after);
    setRedoStack((current) => current.slice(0, -1));
    setHistory((current) => appendDocumentHistory(current, entry));
    setDocRaw(target);
    setIsDirty(true);
    setRemountKey((key) => key + 1);
    pendingPatchRef.current = null;
    setPendingPatch(null);
    pendingPreviewRef.current = null;
    setPendingPreview(null);
    setRevertDocument(null);
    setSelection(null);
    setStatusRaw(`Redid \u201c${entry.label}\u201d`);
    setStatusTypeRaw("success");
    return target;
  }, [doc, redoStack]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    setRedoStack([]);
    setStatusRaw("Document history cleared");
    setStatusTypeRaw("success");
  }, []);

  const replaceHistory = useCallback((entries: DocumentHistoryEntry[]) => {
    setHistory(entries.map((entry) => ({
      ...entry,
      before: copyHistoryDocument(entry.before),
      after: copyHistoryDocument(entry.after),
    })));
    // A restored project timeline replaces the session's redo history; a
    // leftover redoStack could otherwise restore a document from another
    // project (project switch via replaceHistory may not call setDoc).
    setRedoStack([]);
  }, []);

  const loadPatchPreview = useCallback(
    (patch: unknown): boolean => {
      if (!doc) return false;

      const parsed = parseAndValidatePatch(patch, doc);

      if (!parsed.ok) {
        pendingPatchRef.current = null;
        setPendingPatch(null);
        pendingPreviewRef.current = makeErrorPreview(doc, parsed.errors);
        setPendingPreview(pendingPreviewRef.current);
        return false;
      }

      // parsed.patch is a fully normalized SequencePatch — safe for buildPreview
      const preview = buildPreview(parsed.patch, doc, parsed.result);
      pendingPatchRef.current = parsed.patch;
      setPendingPatch(parsed.patch);
      pendingPreviewRef.current = preview;
      setPendingPreview(preview);
      return parsed.result.ok;
    },
    [doc],
  );

  const applyPendingPatch = useCallback((): SequenceDocument | null => {
    const currentDoc = docRef.current;
    const patch = pendingPatchRef.current;
    const preview = pendingPreviewRef.current;
    if (!currentDoc || !patch || !preview) return null;

    // Re-check hash to prevent stale application
    const currentHashNow = fingerprintDocument(currentDoc);
    if (preview.baseHash !== currentHashNow) {
      pendingPatchRef.current = null;
      setPendingPatch(null);
      pendingPreviewRef.current = null;
      setPendingPreview(null);
      setStatusRaw("Preview is stale — document changed since preview");
      setStatusTypeRaw("error");
      return null;
    }

    const parsed = parseAndValidatePatch(patch, currentDoc);
    if (!parsed.ok || !parsed.result.ok) {
      const message = !parsed.ok
        ? parsed.errors[0]
        : parsed.result.ok
          ? "Agent patch is invalid"
          : parsed.result.errors[0];
      setStatusRaw(message ?? "Agent patch is invalid");
      setStatusTypeRaw("error");
      return null;
    }

    const rebuiltPreview = buildPreview(parsed.patch, currentDoc, parsed.result);
    if (
      preview.proposedHash !== rebuiltPreview.proposedHash ||
      !rebuiltPreview.proposedDocument
    ) {
      setStatusRaw("Agent preview no longer matches the normalized patch");
      setStatusTypeRaw("error");
      return null;
    }

    try {
      return commitAgentDocument(rebuiltPreview.proposedDocument, {
        patch: parsed.patch,
        preview: rebuiltPreview,
        currentDocument: currentDoc,
      });
    } catch (error) {
      setStatusRaw(error instanceof Error ? error.message : String(error));
      setStatusTypeRaw("error");
      return null;
    }
  }, [commitAgentDocument]);

  const setAgentApplyFailure = useCallback(
    (errors: readonly string[], clearPreview = false) => {
      if (clearPreview) {
        pendingPatchRef.current = null;
        setPendingPatch(null);
        pendingPreviewRef.current = null;
        setPendingPreview(null);
      }
      setStatusRaw(errors[0] ?? "Agent apply failed");
      setStatusTypeRaw("error");
    },
    [],
  );

  const rejectPendingPatch = useCallback(() => {
    pendingPatchRef.current = null;
    setPendingPatch(null);
    pendingPreviewRef.current = null;
    setPendingPreview(null);
    setStatusRaw("Proposal rejected");
    setStatusTypeRaw("success");
  }, []);

  const revertLastAgentChange = useCallback((): SequenceDocument | null => {
    if (!revertDocument || !doc) return null;
    const entry = createDocumentHistoryEntry(
      doc,
      revertDocument,
      "Reverted Agent change",
      "history",
    );
    setHistory((current) => appendDocumentHistory(current, entry));
    setDocRaw(revertDocument);
    setIsDirty(true);
    setRemountKey((k) => k + 1);
    setRedoStack([]);
    setRevertDocument(null);
    pendingPatchRef.current = null;
    setPendingPatch(null);
    pendingPreviewRef.current = null;
    setPendingPreview(null);
    setSelection(null);
    setStatusRaw("Agent change reverted");
    setStatusTypeRaw("success");
    return revertDocument;
  }, [doc, revertDocument]);

  return {
    doc,
    isRestoring: !durableHydrated,
    filePath,
    basename,
    isDirty,
    remountKey,
    status,
    statusType,
    saveError,
    currentHash,
    pendingPatch,
    pendingPreview,
    revertDocument,
    selection,
    history,
    redoStack,
    setDoc,
    setFilePath,
    setIsDirty,
    setStatus,
    remountOve,
    onOveCommit,
    onOveError,
    onFileOpen,
    onSelectionChange,
    commitDocument,
    commitAgentDocument,
    restoreHistoryEntry,
    undoDocument,
    redoDocument,
    clearHistory,
    replaceHistory,
    loadPatchPreview,
    applyPendingPatch,
    setAgentApplyFailure,
    rejectPendingPatch,
    revertLastAgentChange,
  };
}
