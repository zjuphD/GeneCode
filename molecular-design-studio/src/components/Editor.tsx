import { lazy, Suspense, useEffect, useMemo, useCallback, useRef, useState, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import ClipboardPaste from "@mui/icons-material/ContentPasteGoRounded";
import Dna from "@mui/icons-material/BiotechRounded";
import FileUp from "@mui/icons-material/UploadFileRounded";
import FolderOpen from "@mui/icons-material/FolderOpenRounded";
import { parseGenBank } from "../editor/parser";
import { toOveData } from "../editor/adapter";
import {
  parseSequenceFile,
  exportSequenceFile,
  getFormatFromExtension,
} from "../editor/fileFormats";
import {
  chooseSequenceFile,
  readSequenceFile,
  chooseSavePath,
  writeSequenceFile,
  confirmDiscardChanges,
} from "../services/sequenceFiles";
import type { SequenceDocument, SequenceSelection } from "../types";
// A-PERF-001: OveEditorHost is the ONLY module that imports the vendored OVE
// engine at runtime. Loading it lazily keeps the 2.9MB engine chunk (and its
// Blueprint dependency tree) out of the entry graph, so the app shell paints
// before the editor engine arrives.
const OveEditorHost = lazy(() => import("./OveEditorHost"));
import DocumentToolbar from "./DocumentToolbar";
import { SequenceToolsMenu } from "./SequenceToolsMenu";
import { SaveAsDialog, type SaveAsSelection } from "./SaveAsDialog";
import { isMod } from "./documentShortcuts";
import { fromOveSelection } from "../editor/selection";
import type { OveApplyContext, OveCommandBridge } from "../editor/oveCommandBridge";
import type { ValidationMarker } from "../agent/validationMarkers";
import type { PatchDiffMarker } from "../agent/patchDiffMarkers";
import type { Ab1TraceData } from "../editor/ab1Parser";

import puc19Raw from "../fixtures/puc19.gb?raw";

export interface EditorProps {
  doc: SequenceDocument | null;
  /** Delay the bundled example until both durable stores finish recovery. */
  isRestoring?: boolean;
  filePath: string | null;
  basename: string | null;
  isDirty: boolean;
  remountKey: number;
  status: string | null;
  statusType: "success" | "error" | null;
  setDoc: (doc: SequenceDocument) => void;
  setFilePath: (path: string | null) => void;
  setIsDirty: (dirty: boolean) => void;
  setStatus: (msg: string | null, type: "success" | "error" | null) => void;
  onOveCommit: (saved: SequenceDocument) => void;
  onOveError: (errors: readonly string[]) => void;
  onFileOpen: (doc: SequenceDocument, path: string) => void;
  selection?: SequenceSelection | null;
  onSelectionChange?: (selection: SequenceSelection | null) => void;
  onNew?: () => void;
  onImport?: (doc: SequenceDocument) => void;
  onImportMulti?: (docs: SequenceDocument[]) => void;
  onCommitDocument?: (
    doc: SequenceDocument,
    label: string,
    source: "annotation" | "manual",
  ) => void;
  onAgentCommit?: (doc: SequenceDocument, context: OveApplyContext) => void | Promise<void>;
  onCreateDerivedDocument?: (doc: SequenceDocument) => void;
  /** A-STATE-001: canonical undo/redo (Cmd/Ctrl+Z and toolbar buttons). */
  onUndo?: () => SequenceDocument | null;
  onRedo?: () => SequenceDocument | null;
  canUndo?: boolean;
  canRedo?: boolean;
  commandBridgeRef?: MutableRefObject<OveCommandBridge | null>;
  validationMarkers?: ValidationMarker[];
  patchDiffMarkers?: PatchDiffMarker[];
  /** Timeline-playback reveal progress for the Proposed diff track. */
  patchDiffRevealCount?: number;
  /** Open a sidebar panel (features list / history) from the footer. */
  onOpenPanel?: (section: "annotations" | "inspector" | "history") => void;
}

function Editor({
  doc,
  isRestoring = false,
  filePath,
  basename,
  isDirty,
  remountKey,
  status,
  statusType,
  setDoc,
  setFilePath,
  setIsDirty,
  setStatus,
  onOveCommit,
  onOveError,
  onFileOpen,
  selection,
  onSelectionChange,
  onNew,
  onImport,
  onImportMulti,
  onCommitDocument,
  onAgentCommit,
  onCreateDerivedDocument,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  commandBridgeRef,
  validationMarkers = [],
  patchDiffMarkers = [],
  patchDiffRevealCount,
  onOpenPanel,
}: EditorProps) {
  const [showPaste, setShowPaste] = useState(false);
  const [pasteName, setPasteName] = useState("New sequence");
  const [pasteSequence, setPasteSequence] = useState("");
  const [pasteCircular, setPasteCircular] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [toolbarPortalTarget, setToolbarPortalTarget] = useState<HTMLElement | null>(null);
  // One-shot request forwarded to the OVE host to open the engine AlignmentView
  // with a Sanger trace read (from the verify dialog).
  const [traceAlignmentRequest, setTraceAlignmentRequest] = useState<{
    nonce: number;
    name: string;
    sequence: string;
    chromatogramData?: Ab1TraceData;
  } | null>(null);
  const traceRequestNonceRef = useRef(0);

  useEffect(() => {
    setToolbarPortalTarget(document.getElementById("document-toolbar-slot"));
  }, []);
  // Load bundled pUC19 fixture on mount.
  useEffect(() => {
    if (doc || isRestoring) return;
    try {
      const parsed = parseGenBank(puc19Raw);
      setDoc(parsed);
    } catch {
      setStatus("解析内置 GenBank 文件失败", "error");
    }
  }, [doc, isRestoring, setDoc, setStatus]);

  const oveData = useMemo(() => {
    if (!doc) return null;
    return toOveData(doc);
  }, [doc]);

  const handleOveSelectionChange = useCallback(
    (selectionLayer: unknown) => {
      if (!onSelectionChange || !doc) return;
      const sel = fromOveSelection(selectionLayer, doc);
      onSelectionChange(sel);
    },
    [doc, onSelectionChange],
  );

  // Dismiss success status after 5 seconds.
  useEffect(() => {
    if (statusType !== "success" || !status) return;
    const id = setTimeout(() => setStatus(null, null), 5000);
    return () => clearTimeout(id);
  }, [status, statusType, setStatus]);

  // --- Open handler ---
  const handleOpen = useCallback(async () => {
    try {
      if (isDirty) {
        const discard = await confirmDiscardChanges();
        if (!discard) return;
      }
      const path = await chooseSequenceFile();
      if (!path) return;
      const contents = await readSequenceFile(path);
      const parsed = await parseSequenceFile(contents, path);
      onFileOpen(parsed, path);
      if (getFormatFromExtension(path) === "snapgene") {
        setStatus(
          "SnapGene 文件已导入。可将修改保存为 GenBank、FASTA 或 SnapGene (.dna)。",
          "success",
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "打开文件失败";
      setStatus(msg, "error");
    }
  }, [isDirty, onFileOpen, setStatus]);

  // --- Save As handler ---
  // A-FILE-001: an in-app dialog picks the format first (the browser build
  // has no native save dialog, so previously every export silently became
  // GenBank and .dna/.fa imports could not round-trip). The dialog also
  // warns which fields the chosen format drops before writing.
  const [saveAsTarget, setSaveAsTarget] = useState<{
    doc: SequenceDocument;
    defaultName: string;
    currentPath?: string;
  } | null>(null);

  const handleSaveAs = useCallback(async () => {
    if (!doc) return;
    // Read-only source formats (SnapGene .dna, ABI .ab1) can't be
    // round-tripped; always offer an export instead.
    const sourceFormat = filePath ? getFormatFromExtension(filePath) : null;
    const nonExportableSource =
      sourceFormat === "snapgene" || sourceFormat === "ab1";
    const defaultName = filePath && !nonExportableSource
      ? basename ?? `${doc.name}.gb`
      : `${doc.name}.gb`;
    setSaveAsTarget({
      doc,
      defaultName,
      currentPath: nonExportableSource ? undefined : filePath ?? undefined,
    });
  }, [doc, filePath, basename]);

  const commitSaveAs = useCallback(
    async (selection: SaveAsSelection) => {
      const target = saveAsTarget;
      if (!target) return;
      try {
        const savePath = await chooseSavePath(
          selection.filename,
          target.currentPath,
        );
        // Keep the in-app dialog mounted until a real path is chosen:
        // canceling the native dialog (null) returns to the format picker
        // instead of losing the selection.
        if (!savePath) return;
        setSaveAsTarget(null);
        const content = exportSequenceFile(target.doc, savePath);
        await writeSequenceFile(savePath, content);
        setFilePath(savePath);
        setIsDirty(false);
        setStatus("已保存", "success");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "保存文件失败";
        setStatus(msg, "error");
      }
    },
    [saveAsTarget, setFilePath, setIsDirty, setStatus],
  );

  // --- Save handler ---
  const handleSave = useCallback(async () => {
    if (!doc) return;
    if (!filePath) {
      return handleSaveAs();
    }
    const format = getFormatFromExtension(filePath);
    if (format === "snapgene" || format === "ab1") {
      return handleSaveAs();
    }
    try {
      const content = exportSequenceFile(doc, filePath);
      await writeSequenceFile(filePath, content);
      setIsDirty(false);
      setStatus("已保存", "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "保存文件失败";
      setStatus(msg, "error");
    }
  }, [doc, filePath, handleSaveAs, setIsDirty, setStatus]);

  // --- New sequence handler ---
  const handleNew = useCallback(() => {
    if (onNew) {
      onNew();
    }
  }, [onNew]);

  // --- Import handler (single or multi-record FASTA) ---
  const handleImport = useCallback(async () => {
    if (!onImport && !onImportMulti) return;
    try {
      const path = await chooseSequenceFile();
      if (!path) return;
      const contents = await readSequenceFile(path);

      // Detect multi-record FASTA
      const isMultiFasta =
        typeof contents === "string" &&
        contents.includes(">") &&
        (contents.match(/^>/gm) || []).length > 1;
      if (isMultiFasta && onImportMulti) {
        const { parseMultiFasta } = await import("../editor/parser");
        const docs = parseMultiFasta(contents);
        onImportMulti(docs);
      } else if (onImport) {
        const parsed = await parseSequenceFile(contents, path);
        onImport(parsed);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "导入文件失败";
      setStatus(msg, "error");
    }
  }, [onImport, onImportMulti, setStatus]);

  const handleUseDemo = useCallback(() => {
    try {
      const parsed = parseGenBank(puc19Raw);
      setDoc(parsed);
      setFilePath(null);
      setIsDirty(false);
      setStatus("已加载 pUC19 示例", "success");
    } catch {
      setStatus("解析内置 GenBank 文件失败", "error");
    }
  }, [setDoc, setFilePath, setIsDirty, setStatus]);

  const handlePasteSequence = useCallback(() => {
    const normalized = pasteSequence.replace(/[\s0-9]/g, "").toUpperCase();
    if (!normalized) {
      setPasteError("请粘贴 DNA 或 RNA 序列以继续。");
      return;
    }
    if (!/^[ACGTUNRYSWKMBDHV.-]+$/.test(normalized)) {
      setPasteError("序列包含不支持的字符。");
      return;
    }
    setDoc({
      name: pasteName.trim() || "Pasted sequence",
      sequence: normalized.replace(/[.-]/g, ""),
      circular: pasteCircular,
      features: [],
    });
    setFilePath(null);
    setIsDirty(true);
      setStatus("序列已添加", "success");
    setShowPaste(false);
    setPasteSequence("");
    setPasteError(null);
  }, [pasteCircular, pasteName, pasteSequence, setDoc, setFilePath, setIsDirty, setStatus]);

  // --- Keyboard shortcuts ---
  const handleOpenRef = useRef(handleOpen);
  handleOpenRef.current = handleOpen;
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;
  const handleSaveAsRef = useRef(handleSaveAs);
  handleSaveAsRef.current = handleSaveAs;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isMod(navigator.platform ?? "", e)) return;

      // Don't hijack Cmd/Ctrl+S/O while the user is typing in a text field or
      // contenteditable OUTSIDE the OVE editor (paste dialog, feature dialog,
      // sidebar search, …). OVE itself may capture base typing through a hidden
      // input inside its mount node, so editable elements inside the OVE host
      // must still let the shortcuts through. Checking document.activeElement
      // covers portal dialogs whose event target is an ancestor of the input.
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT" ||
          active.isContentEditable) &&
        !active.closest(".ove-editor-host, .ove-mount-node")
      ) {
        return;
      }

      if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        handleOpenRef.current();
      } else if ((e.key === "s" || e.key === "S") && e.shiftKey) {
        e.preventDefault();
        handleSaveAsRef.current();
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        handleSaveRef.current();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // --- Render ---
  if (!doc || !oveData) {
    return (
      <div className="editor">
        <div className="editor-empty">
          <p>Loading sequence…</p>
        </div>
      </div>
    );
  }

  const toolbar = (
    <DocumentToolbar
      sequenceLength={doc.sequence.length}
      circular={doc.circular}
      featureCount={doc.features.length}
      status={status}
      statusType={statusType}
      onNew={handleNew}
      onOpen={handleOpen}
      onImport={onImport ? handleImport : undefined}
      onSave={handleSave}
      onSaveAs={handleSaveAs}
      onUndo={onUndo}
      onRedo={onRedo}
      canUndo={canUndo}
      canRedo={canRedo}
      tools={onCommitDocument && onCreateDerivedDocument ? (
        <SequenceToolsMenu
          doc={doc}
          selection={selection ?? null}
          onCommitDocument={onCommitDocument}
          onCreateDocument={onCreateDerivedDocument}
          onStatus={(message, type) => setStatus(message, type)}
          onOpenTraceAlignment={(request) => {
            traceRequestNonceRef.current += 1;
            setTraceAlignmentRequest({ nonce: traceRequestNonceRef.current, ...request });
          }}
        />
      ) : undefined}
    />
  );
  const toolbarMount = toolbarPortalTarget
    ? createPortal(toolbar, toolbarPortalTarget)
    : toolbar;

  if (doc.sequence.length === 0) {
    return (
      <div className="editor">
        {toolbarMount}
        <section className="editor-start" aria-labelledby="editor-start-title">
          <div className="editor-start__intro">
            <span className="editor-start__icon" aria-hidden="true"><Dna /></span>
            <h1 id="editor-start-title">添加序列开始编辑</h1>
            <p>打开现有文件、粘贴序列，或加载 pUC19 示例。</p>
          </div>
          <div className="editor-start__actions">
            <button type="button" className="editor-start__action editor-start__action--primary" onClick={handleOpen}>
              <FolderOpen aria-hidden="true" />
              <span><strong>打开序列文件</strong><small>GenBank、FASTA、SnapGene</small></span>
            </button>
            <button type="button" className="editor-start__action" onClick={() => setShowPaste(true)}>
              <ClipboardPaste aria-hidden="true" />
              <span><strong>粘贴序列</strong><small>DNA 或 RNA 文本</small></span>
            </button>
            {onImport && (
              <button type="button" className="editor-start__action" onClick={handleImport}>
                <FileUp aria-hidden="true" />
                <span><strong>导入记录</strong><small>一个或多个 FASTA 条目</small></span>
              </button>
            )}
            <button type="button" className="editor-start__action" onClick={handleUseDemo}>
              <Dna aria-hidden="true" />
              <span><strong>使用 pUC19 示例</strong><small>2,686 bp 环状载体</small></span>
            </button>
          </div>

          {showPaste && createPortal(
            <div className="paste-sequence-overlay" onMouseDown={() => setShowPaste(false)}>
              <div
                className="paste-sequence"
                role="dialog"
                aria-modal="true"
                aria-labelledby="paste-sequence-title"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="paste-sequence__header">
                  <h2 id="paste-sequence-title">粘贴序列</h2>
                  <button type="button" onClick={() => setShowPaste(false)} aria-label="关闭粘贴序列对话框">×</button>
                </div>
                <label>
                  <span>名称</span>
                  <input value={pasteName} onChange={(event) => setPasteName(event.target.value)} />
                </label>
                <label>
                  <span>序列</span>
                  <textarea
                    value={pasteSequence}
                    onChange={(event) => {
                      setPasteSequence(event.target.value);
                      setPasteError(null);
                    }}
                    placeholder="粘贴 DNA 或 RNA 碱基"
                    autoFocus
                  />
                </label>
                <label className="paste-sequence__check">
                  <input type="checkbox" checked={pasteCircular} onChange={(event) => setPasteCircular(event.target.checked)} />
                  <span>环状分子</span>
                </label>
                {pasteError && <p className="paste-sequence__error">{pasteError}</p>}
                <div className="paste-sequence__actions">
                  <button type="button" className="editor-start__secondary" onClick={() => setShowPaste(false)}>取消</button>
                  <button type="button" className="editor-start__primary" onClick={handlePasteSequence}>添加序列</button>
                </div>
              </div>
            </div>,
            document.body,
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="editor">
      <h1 className="sr-only">{doc.name} — 序列编辑器</h1>
      {toolbarMount}
      <Suspense fallback={
        <div className="editor-empty">
          <p>Loading sequence editor…</p>
        </div>
      }>
        <OveEditorHost
          key={remountKey}
          doc={doc}
          oveData={oveData}
          onSaved={onOveCommit}
          onSaveError={onOveError}
          onAgentCommit={onAgentCommit}
          selection={selection}
          onSelectionChange={handleOveSelectionChange}
          onCreateDerivedDocument={onCreateDerivedDocument}
          commandBridgeRef={commandBridgeRef}
          validationMarkers={validationMarkers}
          patchDiffMarkers={patchDiffMarkers}
          patchDiffRevealCount={patchDiffRevealCount}
          traceAlignmentRequest={traceAlignmentRequest}
          onOpenPanel={onOpenPanel}
          onUndo={() => {
            onUndo?.();
          }}
          onRedo={() => {
            onRedo?.();
          }}
        />
      </Suspense>
      {saveAsTarget &&
        createPortal(
          <SaveAsDialog
            doc={saveAsTarget.doc}
            defaultName={saveAsTarget.defaultName}
            onConfirm={(selection) => {
              void commitSaveAs(selection);
            }}
            onCancel={() => setSaveAsTarget(null)}
          />,
          document.body,
        )}
    </div>
  );
}

export default Editor;
