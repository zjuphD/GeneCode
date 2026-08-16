import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import Copy from "@mui/icons-material/ContentCopyRounded";
import FilePlus2 from "@mui/icons-material/NoteAddRounded";
import MousePointer2 from "@mui/icons-material/AdsClickRounded";
import Scissors from "@mui/icons-material/ContentCutRounded";
import Tag from "@mui/icons-material/LocalOfferRounded";
import TestTube2 from "@mui/icons-material/BiotechRounded";
import X from "@mui/icons-material/CloseRounded";
import {
  actions,
  createVectorEditor,
  GeneCodeSequencePanel,
  showDialog,
} from "@teselagen/ove";
import { verifySequence } from "../editor/sequenceVerification";
import { reverseAb1Trace, type Ab1TraceData } from "../editor/ab1Parser";
import type {
  OveActionCreator,
  OveEditorInstance,
  OveSequenceData,
} from "@teselagen/ove";
import type {
  SequenceDocument,
  SequenceFeature,
  SequenceSelection,
  Strand,
} from "../types";
import { fromOveData, resolveDisplayColor, toOveData, ConversionResult } from "../editor/adapter";
import { extractSelectionDocument, reverseComplement } from "../editor/sequenceActions";
import {
  getFeatureLength,
  getFeatureSegments,
  isWrappingFeature,
} from "../editor/featureSegments";
import { fingerprintDocument } from "../agent/fingerprint";
import {
  createOveCommandBridge,
  type OveCommandBridge,
  type OveCommandBridgeOptions,
  type OveCommandHook,
  type OveApplyContext,
} from "../editor/oveCommandBridge";
import type { ValidationMarker, ValidationTone } from "../agent/validationMarkers";
import type { PatchDiffMarker } from "../agent/patchDiffMarkers";
import { DiffMarkerTooltip } from "./DiffMarkerTooltip";
// A-ALG-002: enzyme groups come from the single enzyme-data.json source.
import {
  COMMON_CLONING_ENZYMES,
  GOLDEN_GATE_ENZYMES,
} from "../editor/enzymeData";
import { CloningWizardDialog } from "./CloningWizardDialog";
import { RestrictionEnzymeMenu, type EnzymeMode } from "./RestrictionEnzymeMenu";

export interface OveEditorHostProps {
  /** Initial canonical document to load into the editor. */
  doc: SequenceDocument;
  /** OVE-formatted sequence data for initialization. */
  oveData: OveSequenceData;
  /** Called when a save converts successfully to canonical form. */
  onSaved: (doc: SequenceDocument) => void;
  /** Called when save conversion fails. Receives human-readable errors. */
  onSaveError: (errors: readonly string[]) => void;
  /** Canonical Agent commit boundary. Keeps Agent history distinct from manual OVE saves. */
  onAgentCommit?: (doc: SequenceDocument, context: OveApplyContext) => void | Promise<void>;
  /** Canonical selection controlled by the surrounding workspace. */
  selection?: SequenceSelection | null;
  /** Called when the OVE selection changes. Receives the raw selection layer. */
  onSelectionChange?: (selectionLayer: unknown) => void;
  /** Adds a sequence created from the current OVE selection to the library. */
  onCreateDerivedDocument?: (doc: SequenceDocument) => void;
  /** Optional handle for Agent commands; keep the ref stable for the host lifetime. */
  commandBridgeRef?: MutableRefObject<OveCommandBridge | null>;
  /** Optional canonical revision used to reject stale Agent previews. */
  getDocumentRevision?: OveCommandBridgeOptions["getDocumentRevision"];
  /** Optional hooks used by Agent undo/redo commands. */
  onUndo?: OveCommandHook;
  onRedo?: OveCommandHook;
  /**
   * Remote validation markers rendered as a track above the editor canvas.
   * Clicking a marker selects its region in the editor.
   */
  validationMarkers?: ValidationMarker[];
  /**
   * Agent patch diff markers rendered as a "Proposed" track below the
   * validation track. Clicking a marker selects its region in the editor.
   */
  patchDiffMarkers?: PatchDiffMarker[];
  /**
   * Timeline-playback reveal: how many diff markers are lit. Markers past this
   * index render as ghost outlines until the playback lights them one by one.
   * Defaults to all markers when omitted.
   */
  patchDiffRevealCount?: number;
  /**
   * One-shot request to open the engine AlignmentView with a Sanger trace
   * (or any query) against the current document. The host consumes it once,
   * dispatches the alignment run, and opens the alignment panel. Pass a fresh
   * `nonce` to re-trigger with identical content.
   */
  traceAlignmentRequest?: {
    nonce: number;
    name: string;
    sequence: string;
    chromatogramData?: Ab1TraceData;
  } | null;
  /**
   * Opens a sidebar panel (features list / history) from the SnapGene-style
   * footer navigation. The app ensures the sidebar is visible first.
   */
  onOpenPanel?: (section: "annotations" | "inspector" | "history") => void;
}

type EditorViewMode = "map" | "sequence" | "split";

type TranslationMode = "cds" | "off" | "frame1" | "forward" | "six";

const EDITOR_NAME = "MdsEditor";
const ENZYME_MODE_STORAGE_KEY = "genecode-enzyme-mode";
/** Panels owned by the app chrome (map/sequence). Tool panels are preserved. */
const BASE_PANEL_IDS = new Set(["circular", "rail", "sequence"]);
const EDITOR_VIEW_MODE_STORAGE_KEY = "genecode-editor-view-mode";
const TRANSLATION_MODE_STORAGE_KEY = "genecode-translation-mode";
const TRANSLATION_MODE_VERSION_STORAGE_KEY = "genecode-translation-mode-version";
const TRANSLATION_MODE_VERSION = "2";
const AGENT_AUTOSAVE_ECHO_TTL_MS = 1500;

const VALIDATION_TONE_CLASS: Record<ValidationTone, string> = {
  pass: "ove-validation-track__marker--pass",
  warning: "ove-validation-track__marker--warning",
  fail: "ove-validation-track__marker--fail",
  info: "ove-validation-track__marker--info",
};

const DIFF_KIND_CLASS: Record<PatchDiffMarker["kind"], string> = {
  insert: "ove-diff-track__marker--insert",
  delete: "ove-diff-track__marker--delete",
  replace: "ove-diff-track__marker--replace",
  add_feature: "ove-diff-track__marker--add",
  remove_feature: "ove-diff-track__marker--remove",
};

/**
 * Resolve a diff marker's track geometry (left % / width %) and its visual
 * center (also %) so both the marker button and the hover tooltip share one
 * calculation. Matches the panel track's clamping rules.
 */
function diffMarkerGeometry(marker: PatchDiffMarker, length: number) {
  const denominator = Math.max(length, 1);
  const start = Math.max(
    0,
    Math.min(99.4, (marker.start / denominator) * 100),
  );
  const width = Math.max(
    0.7,
    Math.min(
      100 - start,
      (Math.max(marker.end - marker.start, 1) / denominator) * 100,
    ),
  );
  return { start, width, center: start + width / 2 };
}

const ENZYME_GROUPS = {
  "Common cloning": [...COMMON_CLONING_ENZYMES],
  "Golden Gate": [...GOLDEN_GATE_ENZYMES],
} as const;

const ENZYME_MODE_OPTIONS: Array<{ value: EnzymeMode; label: string }> = [
  { value: "cloning", label: "Common cloning" },
  { value: "golden-gate", label: "Golden Gate" },
  { value: "single", label: "Unique cutters" },
  { value: "double", label: "Double cutters" },
  { value: "single-double", label: "Unique + double cutters" },
  { value: "type2s", label: "Type IIS enzymes" },
  { value: "all", label: "All enzymes" },
  { value: "hidden", label: "Hide sites" },
];

const TRANSLATION_MODE_OPTIONS: Array<{ value: TranslationMode; label: string }> = [
  { value: "cds", label: "CDS features" },
  { value: "off", label: "Hidden" },
  { value: "frame1", label: "+1 reading frame" },
  { value: "forward", label: "Forward 3 frames" },
  { value: "six", label: "Six reading frames" },
];

const EMPTY_FRAME_TRANSLATIONS = {
  1: false,
  2: false,
  3: false,
  "-1": false,
  "-2": false,
  "-3": false,
} as const;

function getInitialEnzymeMode(): EnzymeMode {
  if (typeof window === "undefined") return "cloning";
  const stored = window.localStorage.getItem(ENZYME_MODE_STORAGE_KEY);
  return ENZYME_MODE_OPTIONS.some((option) => option.value === stored)
    ? stored as EnzymeMode
    : "cloning";
}

function getInitialViewMode(): EditorViewMode {
  if (typeof window === "undefined") return "map";
  const stored = window.localStorage.getItem(EDITOR_VIEW_MODE_STORAGE_KEY);
  return stored === "map" || stored === "sequence" || stored === "split"
    ? stored
    : "map";
}

function getInitialTranslationMode(): TranslationMode {
  if (typeof window === "undefined") return "cds";
  const stored = window.localStorage.getItem(TRANSLATION_MODE_STORAGE_KEY);
  if (window.localStorage.getItem(TRANSLATION_MODE_VERSION_STORAGE_KEY) !== TRANSLATION_MODE_VERSION) {
    const migratedMode: TranslationMode = stored === "off" ? "off" : "cds";
    window.localStorage.setItem(TRANSLATION_MODE_STORAGE_KEY, migratedMode);
    window.localStorage.setItem(TRANSLATION_MODE_VERSION_STORAGE_KEY, TRANSLATION_MODE_VERSION);
    return migratedMode;
  }
  return TRANSLATION_MODE_OPTIONS.some((option) => option.value === stored)
    ? stored as TranslationMode
    : "cds";
}

function getFrameTranslations(mode: TranslationMode): Record<string, boolean> {
  if (mode === "frame1") return { ...EMPTY_FRAME_TRANSLATIONS, 1: true };
  if (mode === "forward") {
    return { ...EMPTY_FRAME_TRANSLATIONS, 1: true, 2: true, 3: true };
  }
  if (mode === "six") {
    return {
      1: true,
      2: true,
      3: true,
      "-1": true,
      "-2": true,
      "-3": true,
    };
  }
  return { ...EMPTY_FRAME_TRANSLATIONS };
}

function getEnzymeFilter(mode: EnzymeMode): Array<Record<string, unknown>> {
  if (mode === "cloning") {
    return [{
      value: "__userCreatedGroupCommon cloning",
      label: "Common cloning",
      nameArray: [...ENZYME_GROUPS["Common cloning"]],
    }];
  }
  if (mode === "golden-gate") {
    return [{
      value: "__userCreatedGroupGolden Gate",
      label: "Golden Gate",
      nameArray: [...ENZYME_GROUPS["Golden Gate"]],
    }];
  }
  if (mode === "single") {
    return [{
      value: "single",
      label: "Unique cutters",
      cutsThisManyTimes: 1,
      isSpecialGroup: true,
    }];
  }
  if (mode === "double") {
    return [{
      value: "double",
      label: "Double cutters",
      cutsThisManyTimes: 2,
      isSpecialGroup: true,
    }];
  }
  if (mode === "single-double") {
    return [
      {
        value: "single",
        label: "Unique cutters",
        cutsThisManyTimes: 1,
        isSpecialGroup: true,
      },
      {
        value: "double",
        label: "Double cutters",
        cutsThisManyTimes: 2,
        isSpecialGroup: true,
      },
    ];
  }
  if (mode === "type2s") {
    return [{
      value: "type2s",
      label: "Type IIS enzymes",
      isSpecialGroup: true,
    }];
  }
  return [];
}

function buildPanelLayout(
  mode: EditorViewMode,
  circular: boolean,
  extraPanels: Array<Record<string, unknown>> = [],
) {
  const sequencePanel = [
    { id: "sequence", name: "Sequence Map", active: true },
  ];
  const mapPanel = [
    { id: "circular", name: "Circular Map", active: circular },
    { id: "rail", name: "Linear Map", active: !circular },
  ];

  if (mode === "split") {
    return extraPanels.length
      ? [[...sequencePanel, ...extraPanels], mapPanel]
      : [sequencePanel, mapPanel];
  }
  const basePanel = mode === "sequence" ? sequencePanel : mapPanel;
  return extraPanels.length ? [[...basePanel, ...extraPanels]] : [basePanel];
}

/**
 * Read currently open tool panels (digest/pcr/alignment) from the fork store so
 * view-mode switches can preserve them instead of closing them.
 */
function readCurrentToolPanels(
  editor: ForkOveEditorInstance | null,
): Array<Record<string, unknown>> {
  if (!editor) return [];
  const state = readForkEditorState(editor, EDITOR_NAME) as
    | { panelsShown?: Array<Array<Record<string, unknown>>> }
    | undefined;
  const groups = state?.panelsShown;
  if (!Array.isArray(groups)) return [];
  return groups
    .flat()
    .filter((panel) => (
      panel &&
      typeof panel === "object" &&
      !BASE_PANEL_IDS.has(String((panel as { id?: unknown }).id))
    ));
}

/**
 * Build alignment tracks for the engine AlignmentView from the app's own
 * pairwise verifier. Tracks are padded so the reference and query are both
 * shown in full with equal-length gapped sequences (required by OVE's
 * alignment data contract).
 */
function buildAlignmentTracks(
  doc: SequenceDocument,
  queryName: string,
  querySequence: string,
  chromatogramData?: Ab1TraceData,
): Array<{
  sequenceData: Record<string, unknown>;
  alignmentData: { name: string; sequence: string };
  chromatogramData?: Ab1TraceData;
}> {
  const reference = doc.sequence;
  const result = verifySequence(reference, querySequence, false);
  const prefix = reference.slice(0, result.referenceStart);
  const suffix = reference.slice(result.referenceEnd);
  const alignedReference = prefix + result.alignedReference + suffix;
  const alignedQuery =
    "-".repeat(prefix.length) + result.alignedQuery + "-".repeat(suffix.length);
  // When the verifier picks the reverse orientation, the query track shows the
  // reverse complement — flip the trace so the peaks line up with the bases.
  const trace = chromatogramData
    ? result.orientation === "reverse"
      ? reverseAb1Trace(chromatogramData)
      : chromatogramData
    : undefined;
  return [
    {
      sequenceData: {
        name: doc.name,
        sequence: reference,
        circular: false,
      },
      alignmentData: { name: doc.name, sequence: alignedReference },
    },
    {
      sequenceData: {
        name: queryName,
        // Keep the track's canonical sequence equal to the gapped content so
        // OVE's alignment data contract (non-gap length match) always holds,
        // including when the verifier picked the reverse orientation.
        sequence: alignedQuery.replace(/-/g, ""),
        circular: false,
      },
      alignmentData: { name: queryName, sequence: alignedQuery },
      chromatogramData: trace,
    },
  ];
}

type OveMenuCommand = {
  cmd?: string;
  text?: string;
  [key: string]: unknown;
};
type OveMenuItem = string | OveMenuCommand;

type OveRightClickContext = {
  annotation?: Record<string, unknown>;
};

type CreateKind = "annotation" | "primer";

type CreateRequest = {
  kind: CreateKind;
  start: number;
  end: number;
};

type OpenCreateDialog = (
  kind: CreateKind,
  context: OveRightClickContext,
) => void;

type OveStore = {
  getState: () => unknown;
  dispatch: (action: unknown) => unknown;
};

type ForkOveEditorInstance = OveEditorInstance & {
  getStore: () => OveStore;
};

function readForkEditorState(
  editor: ForkOveEditorInstance,
  editorName: string,
): unknown {  const rootState = editor.getStore().getState();
  if (!rootState || typeof rootState !== "object" || Array.isArray(rootState)) {
    return undefined;
  }
  const vectorEditor = (rootState as Record<string, unknown>).VectorEditor;
  if (!vectorEditor || typeof vectorEditor !== "object" || Array.isArray(vectorEditor)) {
    return undefined;
  }
  return (vectorEditor as Record<string, unknown>)[editorName];
}

/**
 * Dispatch an engine action (createNewDigest / createNewPCR / alignment run)
 * against the fork store so the tool panel opens in the live editor.
 */
function dispatchEngineAction(
  editor: ForkOveEditorInstance | null,
  action: OveActionCreator,
  payload: unknown = undefined,
): boolean {
  const store = editor?.getStore();
  if (!store || typeof store.dispatch !== "function") return false;
  store.dispatch(action(payload, { editorName: EDITOR_NAME }));
  return true;
}

function buildDirectCreateItems(
  context: OveRightClickContext,
  openCreateDialog: OpenCreateDialog,
): OveMenuCommand[] {
  return [
    {
      text: "添加注释",
      onClick: () => openCreateDialog("annotation", context),
    },
    {
      text: "添加引物",
      onClick: () => openCreateDialog("primer", context),
    },
    { cmd: "createNewFromSubsequence", text: "从选区创建序列" },
  ];
}

const SUPPORTED_ANNOTATIONS = {
  features: true,
  primers: true,
  parts: false,
  translations: true,
} as const;

function exposeCreateActions(
  items: unknown,
  context: OveRightClickContext = {},
  openCreateDialog: OpenCreateDialog,
): unknown {
  if (!Array.isArray(items)) return items;
  return items.flatMap((item: OveMenuItem) => (
    item === "createMenuHolder" || (typeof item === "object" && item?.cmd === "createMenuHolder")
      ? buildDirectCreateItems(context, openCreateDialog)
      : [item]
  ));
}

function buildRightClickOverrides(openCreateDialog: OpenCreateDialog) {
  const expose = (items: unknown, context?: OveRightClickContext) =>
    exposeCreateActions(items, context, openCreateDialog);
  return {
    selectionLayerRightClicked: expose,
    searchLayerRightClicked: expose,
    backgroundRightClicked: expose,
    featureRightClicked: expose,
    partRightClicked: expose,
    primerRightClicked: expose,
    orfRightClicked: expose,
    translationRightClicked: expose,
    warningRightClicked: expose,
  };
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard is unavailable");
}

function CreateFeatureDialog({
  doc,
  request,
  onCancel,
  onCreate,
}: {
  doc: SequenceDocument;
  request: CreateRequest;
  onCancel: () => void;
  onCreate: (feature: SequenceFeature) => void;
}) {
  const primer = request.kind === "primer";
  const [name, setName] = useState(primer ? "New primer" : "New annotation");
  const [type, setType] = useState(primer ? "primer_bind" : "misc_feature");
  const [start, setStart] = useState(String(request.start + 1));
  const [end, setEnd] = useState(String(request.end));
  const [strand, setStrand] = useState<Strand>(1);
  const [color, setColor] = useState(primer ? "#5f8e78" : "#4f7fa8");
  const [error, setError] = useState<string | null>(null);

  // A-A11Y-001: Escape closes the dialog; focus returns to the trigger on
  // close. The trigger is captured once on mount (a callback-identity dep would
  // re-run and re-capture the dialog's own input as "previously focused").
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancelRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  const submit = () => {
    const canonicalStart = Number(start) - 1;
    const canonicalEnd = Number(end);
    if (!name.trim() || !type.trim()) {
      setError("Enter a name and type.");
      return;
    }
    const seqLen = doc.sequence.length;
    // A-BIO-004: start > end on a circular molecule is an origin-spanning
    // location — the feature gets explicit segments [{start, seqLen}, {0, end}]
    // and the binding sequence is the tail + head concatenation.
    const wrap = doc.circular && canonicalStart > canonicalEnd;
    const validStart =
      Number.isInteger(canonicalStart) &&
      canonicalStart >= 0 &&
      canonicalStart < seqLen;
    const validEnd =
      Number.isInteger(canonicalEnd) &&
      canonicalEnd >= (wrap ? 1 : canonicalStart + 1) &&
      canonicalEnd <= seqLen;
    if (!validStart || !validEnd) {
      setError(`Use coordinates between 1 and ${seqLen.toLocaleString()}.`);
      return;
    }

    const bindingSequence = wrap
      ? doc.sequence.slice(canonicalStart) + doc.sequence.slice(0, canonicalEnd)
      : doc.sequence.slice(canonicalStart, canonicalEnd);
    const sequence = strand === 1
      ? bindingSequence
      : reverseComplement(bindingSequence);
    onCreate({
      id: `feature_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(),
      type: type.trim(),
      start: canonicalStart,
      end: canonicalEnd,
      strand,
      color,
      qualifiers: primer ? {
        sequence: [sequence],
        binding_sequence: [bindingSequence],
        direction: [strand === 1 ? "forward" : "reverse"],
      } : {},
      ...(wrap
        ? { segments: [{ start: canonicalStart, end: seqLen }, { start: 0, end: canonicalEnd }] }
        : {}),
    });
  };

  return createPortal(
    <div className="paste-sequence-overlay" onMouseDown={onCancel}>
      <form
        className="paste-sequence create-feature-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-feature-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="paste-sequence__header">
          <div>
            <h2 id="create-feature-title">{primer ? "添加引物" : "添加注释"}</h2>
            <p className="create-feature-dialog__selection">
              选中区域 {request.start + 1}–{request.end}
            </p>
          </div>
          <button type="button" onClick={onCancel} aria-label="关闭创建对话框">
            <X aria-hidden="true" />
          </button>
        </div>
        <label>
          <span>名称</span>
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          <span>类型</span>
          <input value={type} onChange={(event) => setType(event.target.value)} />
        </label>
        <div className="create-feature-dialog__grid">
          <label>
            <span>起始</span>
            <input type="number" min="1" max={doc.sequence.length} value={start} onChange={(event) => setStart(event.target.value)} />
          </label>
          <label>
            <span>终止</span>
            <input type="number" min="1" max={doc.sequence.length} value={end} onChange={(event) => setEnd(event.target.value)} />
          </label>
          <label>
            <span>链</span>
            <select value={strand} onChange={(event) => setStrand(Number(event.target.value) as Strand)}>
              <option value={1}>正向</option>
              <option value={-1}>反向</option>
            </select>
          </label>
          <label>
            <span>颜色</span>
            <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
          </label>
        </div>
        {error && <p className="paste-sequence__error" role="alert">{error}</p>}
        <div className="paste-sequence__actions">
          <button type="button" className="editor-start__secondary" onClick={onCancel}>取消</button>
          <button type="submit" className="editor-start__primary">{primer ? "添加引物" : "添加注释"}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

/**
 * Wraps OVE's imperative createVectorEditor API in a React component.
 *
 * Creates a dedicated child mount node inside the React-owned host.
 * OVE's close() removes only that child node, not the React host.
 */
export default function OveEditorHost({
  doc,
  oveData,
  onSaved,
  onSaveError,
  onAgentCommit,
  selection,
  onSelectionChange,
  onCreateDerivedDocument,
  commandBridgeRef,
  getDocumentRevision,
  onUndo,
  onRedo,
  validationMarkers = [],
  patchDiffMarkers = [],
  patchDiffRevealCount = patchDiffMarkers.length,
  traceAlignmentRequest = null,
  onOpenPanel,
}: OveEditorHostProps) {
  const [viewMode, setViewMode] = useState<EditorViewMode>(getInitialViewMode);
  const [enzymeMode, setEnzymeMode] = useState<EnzymeMode>(getInitialEnzymeMode);
  const [translationMode, setTranslationMode] = useState<TranslationMode>(getInitialTranslationMode);
  // Hovered Proposed-track marker drives the before→after tooltip.
  const [hoveredDiffMarkerId, setHoveredDiffMarkerId] = useState<string | null>(null);
  const [hoveredOverviewFeatureId, setHoveredOverviewFeatureId] = useState<string | null>(null);
  const [createDialog, setCreateDialog] = useState<CreateRequest | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [cloneWizardOpen, setCloneWizardOpen] = useState(false);
  const [alignDialogOpen, setAlignDialogOpen] = useState(false);
  const [alignName, setAlignName] = useState("Aligned sequence");
  const [alignSequence, setAlignSequence] = useState("");
  const [alignError, setAlignError] = useState<string | null>(null);
  const [showDescription, setShowDescription] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<OveEditorInstance | null>(null);
  const commandBridgeInstanceRef = useRef<OveCommandBridge | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const onSaveErrorRef = useRef(onSaveError);
  onSaveErrorRef.current = onSaveError;
  const onAgentCommitRef = useRef(onAgentCommit);
  onAgentCommitRef.current = onAgentCommit;
  const getDocumentRevisionRef = useRef(getDocumentRevision);
  getDocumentRevisionRef.current = getDocumentRevision;
  const onUndoRef = useRef(onUndo);
  onUndoRef.current = onUndo;
  const onRedoRef = useRef(onRedo);
  onRedoRef.current = onRedo;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const onCreateDerivedDocumentRef = useRef(onCreateDerivedDocument);
  onCreateDerivedDocumentRef.current = onCreateDerivedDocument;
  const agentAutosaveEchoRef = useRef<string | null>(null);
  const agentAutosaveEchoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appliedSelectionRef = useRef<string | null>(null);

  /**
   * Mark the next OVE autosave as owned by a programmatic updateEditor() call.
   * updateEditor({ sequenceData }) can advance OVE's stateTrackingId and trigger
   * its legacy autosave callback; the owner of that update (Agent commit or
   * create-feature dialog) already commits history itself, so the matching
   * autosave echo must be consumed instead of recorded as a manual edit.
   */
  const markAutosaveEcho = (document: SequenceDocument) => {
    agentAutosaveEchoRef.current = fingerprintDocument(document);
    if (agentAutosaveEchoTimerRef.current !== null) {
      clearTimeout(agentAutosaveEchoTimerRef.current);
    }
    agentAutosaveEchoTimerRef.current = setTimeout(() => {
      agentAutosaveEchoRef.current = null;
      agentAutosaveEchoTimerRef.current = null;
    }, AGENT_AUTOSAVE_ECHO_TTL_MS);
  };

  const openCreateDialogRef = useRef<OpenCreateDialog>(() => {});
  openCreateDialogRef.current = (kind, context) => {
    const annotation = context.annotation;
    const annotationStart = annotation?.start;
    const annotationEnd = annotation?.end;
    if (typeof annotationStart === "number" && typeof annotationEnd === "number") {
      // OVE inclusive end -> canonical exclusive end. A wrap annotation
      // (start > end, the engine's spans-origin convention) is passed through
      // as-is — the dialog builds the segments (A-BIO-004).
      setCreateDialog({ kind, start: annotationStart, end: annotationEnd + 1 });
      return;
    }
    if (selection && selection.length > 0) {
      setCreateDialog({ kind, start: selection.start, end: selection.end });
      return;
    }
    onSaveErrorRef.current(["Select a sequence region before creating an annotation or primer."]);
  };
  const rightClickOverridesRef = useRef(buildRightClickOverrides(
    (kind, context) => openCreateDialogRef.current(kind, context),
  ));

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Create a dedicated child node for OVE to own.
    // close() will unmount and remove this node — not the React host.
    const mountNode = document.createElement("div");
    mountNode.className = "ove-mount-node";
    mountNode.style.width = "100%";
    mountNode.style.height = "100%";
    host.appendChild(mountNode);

    const editor = createVectorEditor(mountNode, {
      editorName: EDITOR_NAME,
      readOnly: false,
      shouldAutosave: true,
      showReadOnly: false,
      // Topology belongs to document properties, not the editor status bar.
      showCircularity: false,
      showMoleculeType: false,
      annotationsToSupport: SUPPORTED_ANNOTATIONS,
      panelComponents: {
        sequence: {
          comp: GeneCodeSequencePanel,
          panelSpecificProps: ["extraAnnotationProps"],
        },
      },
      enzymeGroupsOverride: ENZYME_GROUPS,
      rightClickOverrides: rightClickOverridesRef.current,
      onCreateNewFromSubsequence: (sequenceData: OveSequenceData) => {
        const result = fromOveData(sequenceData);
        if (result.ok) {
          onCreateDerivedDocumentRef.current?.({
            ...result.doc,
            circular: false,
          });
        } else {
          onSaveErrorRef.current(result.errors.map((error) => error.message));
        }
      },
      // A-STATE-001: undoTool/redoTool are deliberately absent. The canonical
      // operation log in useWorkspace is the single undo/redo source; the
      // engine's internal VE_UNDO stack must never be reachable from the UI,
      // or the History panel and Cmd+Z would diverge again. Undo/Redo live in
      // the app toolbar and the mod+z/mod+shift+z hotkey handler below.
      ToolBarProps: {
        toolList: [
          "cutsiteTool",
          "featureTool",
          "editTool",
          "findTool",
          "visibilityTool",
        ],
      },
      StatusBarProps: {
        showCircularity: false,
        showReadOnly: false,
        showAvailability: false,
      },
      onSelectionOrCaretChanged: (event: { selectionLayer?: { start?: number; end?: number }; caretPosition?: number }) => {
        onSelectionChangeRef.current?.(event.selectionLayer ?? null);
      },
      onSave: (
        _opts: Record<string, unknown>,
        sequenceData: OveSequenceData,
        _props: Record<string, unknown>,
        onSuccessCallback: () => void,
      ) => {
        const result: ConversionResult = fromOveData(sequenceData, docRef.current);
        if (result.ok) {
          const resultHash = fingerprintDocument(result.doc);
          if (agentAutosaveEchoRef.current === resultHash) {
            // updateEditor() can advance OVE's stateTrackingId and trigger its
            // legacy autosave callback. The Agent commit already owns history;
            // consume this one matching echo instead of recording it as manual.
            agentAutosaveEchoRef.current = null;
            if (agentAutosaveEchoTimerRef.current !== null) {
              clearTimeout(agentAutosaveEchoTimerRef.current);
              agentAutosaveEchoTimerRef.current = null;
            }
            onSuccessCallback();
            return;
          }
          onSavedRef.current(result.doc);
          onSuccessCallback();
        } else {
          onSaveErrorRef.current(result.errors.map((e) => e.message));
        }
      },
    });

    editorRef.current = editor;

    // Initialize with sequence data and explicit panel layout.
    editor.updateEditor({
      readOnly: false,
      sequenceData: oveData,
      annotationsToSupport: SUPPORTED_ANNOTATIONS,
      annotationVisibility: {
        cutsites: enzymeMode !== "hidden",
        translations: translationMode !== "off",
        cdsFeatureTranslations: translationMode !== "off",
      },
      frameTranslations: getFrameTranslations(translationMode),
      restrictionEnzymes: {
        filteredRestrictionEnzymes: getEnzymeFilter(enzymeMode),
      },
      panelsShown: buildPanelLayout(viewMode, doc.circular),
    });

    if (commandBridgeRef) {
      const forkEditor = editor as ForkOveEditorInstance;
      if (typeof forkEditor.getStore !== "function") {
        onSaveErrorRef.current(["The local OVE fork does not expose editor.getStore()."]);
      } else {
        const bridgeOptions: OveCommandBridgeOptions = {
          // The bridge reads this adapter from the fork's isolated Redux store.
          // It intentionally does not call the legacy editor.getState() method.
          editor: {
            getState: () => readForkEditorState(forkEditor, EDITOR_NAME),
            updateEditor: (values) => editor.updateEditor(values),
          },
          applyCanonicalDocument: async (nextDocument, context) => {
            const previousDocument = context.baseDocument;
            let editorUpdated = false;

            try {
              // Synchronize OVE first, then commit the canonical workspace. If
              // the workspace rejects the commit, restore OVE before surfacing
              // apply_failed so the two state stores cannot diverge.
              markAutosaveEcho(nextDocument);
              editor.updateEditor({ sequenceData: toOveData(nextDocument) });
              editorUpdated = true;

              if (onAgentCommitRef.current) {
                await onAgentCommitRef.current(nextDocument, context);
              } else {
                // Preserve the legacy host contract for callers that have not
                // opted into the workspace Agent commit boundary yet.
                onSavedRef.current(nextDocument);
              }
              docRef.current = nextDocument;
            } catch (error) {
              if (editorUpdated) {
                try {
                  markAutosaveEcho(previousDocument);
                  editor.updateEditor({ sequenceData: toOveData(previousDocument) });
                  docRef.current = previousDocument;
                } catch {
                  // Preserve the original commit error; the bridge reports it
                  // while the next live-state read still exposes the failure.
                }
              } else {
                agentAutosaveEchoRef.current = null;
              }
              throw error;
            }
          },
        };

        if (getDocumentRevision !== undefined) {
          bridgeOptions.getDocumentRevision = (state, document) =>
            getDocumentRevisionRef.current?.(state, document);
        }
        if (onUndo !== undefined) {
          bridgeOptions.onUndo = () => onUndoRef.current?.();
        }
        if (onRedo !== undefined) {
          bridgeOptions.onRedo = () => onRedoRef.current?.();
        }

        const bridge = createOveCommandBridge(bridgeOptions);
        commandBridgeInstanceRef.current = bridge;
        commandBridgeRef.current = bridge;
      }
    }

    return () => {
      if (agentAutosaveEchoTimerRef.current !== null) {
        clearTimeout(agentAutosaveEchoTimerRef.current);
        agentAutosaveEchoTimerRef.current = null;
      }
      agentAutosaveEchoRef.current = null;
      if (commandBridgeRef?.current === commandBridgeInstanceRef.current) {
        commandBridgeRef.current = null;
      }
      commandBridgeInstanceRef.current = null;
      if (editorRef.current === editor) editorRef.current = null;
      // OVE owns a second React root. React 18 Strict Mode invokes this
      // effect's cleanup while the app root is still committing; synchronously
      // unmounting the OVE root there emits a race warning. Defer only the
      // secondary-root teardown until the current commit has completed.
      queueMicrotask(() => editor.close());
    };
    // Run only on mount/unmount. The parent controls when to remount
    // by changing a key when the document changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * A-STATE-001: canonical undo/redo hotkeys. Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z and
   * Cmd/Ctrl+Y are captured on window in the capture phase and routed through
   * the canonical operation log (onUndo/onRedo props). The engine binds its own
   * mod+z handler on a React-synthetic .hotkeyHandler div (bubble phase inside
   * its mount node), so stopImmediatePropagation here guarantees the engine's
   * internal VE_UNDO stack can never run — the canonical log is the single
   * undo/redo source and the History panel stays in sync.
   */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.altKey) return;
      const key = event.key.toLowerCase();
      const isUndo = key === "z" && !event.shiftKey;
      const isRedo = (key === "z" && event.shiftKey) || key === "y";
      if (!isUndo && !isRedo) return;

      // Let native undo/redo apply while typing in a text field OUTSIDE the
      // editor (dialogs, sidebar search). Editable elements inside the OVE
      // host belong to base editing — there Cmd+Z must undo the operation.
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

      event.preventDefault();
      event.stopImmediatePropagation();
      if (isUndo) onUndoRef.current?.();
      else onRedoRef.current?.();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const key = selection
      ? `${selection.start}:${selection.end}:${selection.wrapsOrigin ? 1 : 0}`
      : "none";
    if (appliedSelectionRef.current === key) return;
    appliedSelectionRef.current = key;

    if (!selection) {
      editor.updateEditor({ selectionLayer: { start: -1, end: -1 } });
      return;
    }

    const inclusiveEnd = selection.wrapsOrigin && selection.end === 0
      ? doc.sequence.length - 1
      : selection.end - 1;
    editor.updateEditor({
      selectionLayer: {
        start: selection.start,
        end: inclusiveEnd,
      },
    });
  }, [doc.sequence.length, selection]);

  useEffect(() => {
    setCopyState("idle");
  }, [selection?.start, selection?.end, selection?.wrapsOrigin]);

  // Consume one-shot trace-alignment requests from the verification dialog:
  // build the tracks with the Sanger chromatogram attached and open the engine
  // AlignmentView panel, mirroring the manual Align dialog flow.
  const consumedTraceRequestRef = useRef<number | null>(null);
  useEffect(() => {
    if (!traceAlignmentRequest) return;
    if (consumedTraceRequestRef.current === traceAlignmentRequest.nonce) return;
    const editor = editorRef.current as ForkOveEditorInstance | null;
    const store = editor?.getStore();
    if (!store || typeof store.dispatch !== "function") {
      // Leave the request unconsumed so a retry is possible once the store is
      // ready; surface the failure on the status bar instead of a dead dialog.
      return;
    }
    consumedTraceRequestRef.current = traceAlignmentRequest.nonce;
    try {
      const tracks = buildAlignmentTracks(
        docRef.current,
        traceAlignmentRequest.name,
        traceAlignmentRequest.sequence,
        traceAlignmentRequest.chromatogramData,
      );
      const alignmentId = `trace-alignment-${traceAlignmentRequest.nonce}`;
      store.dispatch(actions.upsertAlignmentRun({
        id: alignmentId,
        alignmentTracks: tracks,
        // The engine never sets alignmentType itself; the reducer only
        // preserves state[id].alignmentType, so dispatch it explicitly or
        // the AlignmentView header falls back to "Unknown Alignment Type".
        alignmentType: "Trace Alignment",
        // The engine's default alignmentAnnotationVisibility has
        // `chromatogram: false`; turn it on so the Sanger peaks actually
        // render in the AlignmentView for this trace run.
        alignmentAnnotationVisibility: { chromatogram: true },
      }));
      store.dispatch(actions.createNewAlignment(
        { id: alignmentId, name: "Trace Alignment" },
        { editorName: EDITOR_NAME },
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Trace alignment failed.";
      setAlignError(message);
    }
  }, [traceAlignmentRequest]);

  const changeViewMode = (mode: EditorViewMode) => {
    setViewMode(mode);
    window.localStorage.setItem(EDITOR_VIEW_MODE_STORAGE_KEY, mode);
    editorRef.current?.updateEditor({
      panelsShown: buildPanelLayout(
        mode,
        doc.circular,
        readCurrentToolPanels(editorRef.current as ForkOveEditorInstance | null),
      ),
    });
  };

  const changeEnzymeMode = (mode: EnzymeMode) => {
    setEnzymeMode(mode);
    window.localStorage.setItem(ENZYME_MODE_STORAGE_KEY, mode);
    editorRef.current?.updateEditor({
      annotationVisibility: { cutsites: mode !== "hidden" },
      restrictionEnzymes: {
        filteredRestrictionEnzymes: getEnzymeFilter(mode),
      },
    });
  };

  const changeTranslationMode = (mode: TranslationMode) => {
    setTranslationMode(mode);
    window.localStorage.setItem(TRANSLATION_MODE_STORAGE_KEY, mode);
    window.localStorage.setItem(TRANSLATION_MODE_VERSION_STORAGE_KEY, TRANSLATION_MODE_VERSION);
    const shouldOpenSequenceView = mode !== "off" && mode !== "cds" && viewMode === "map";
    if (shouldOpenSequenceView) {
      setViewMode("sequence");
      window.localStorage.setItem(EDITOR_VIEW_MODE_STORAGE_KEY, "sequence");
    }
    editorRef.current?.updateEditor({
      annotationVisibility: {
        translations: mode !== "off",
        cdsFeatureTranslations: mode !== "off",
      },
      frameTranslations: getFrameTranslations(mode),
      ...(shouldOpenSequenceView
        ? { panelsShown: buildPanelLayout(
            "sequence",
            doc.circular,
            readCurrentToolPanels(editorRef.current as ForkOveEditorInstance | null),
          ) }
        : {}),
    });
  };

  /**
   * Open the engine's enzyme manager (EnzymesDialog): browse/group enzymes,
   * test them against the current sequence, and create custom enzymes.
   *
   * Custom enzymes are persisted by the engine store itself (addCustomEnzyme +
   * FILTERED_RESTRICTION_ENZYMES_ADD against this editor's store), so the
   * cutsite layer re-renders automatically when the dialog closes; enzyme mode
   * switches below deep-merge and never drop them.
   */
  const openManageEnzymes = () => {
    showDialog({
      dialogType: "EnzymesDialog",
      props: {
        editorName: EDITOR_NAME,
        inputSequenceToTestAgainst: docRef.current.sequence,
      },
    });
  };

  /** Open the engine's Virtual Digest panel in the live editor. */
  const openDigestPanel = () => {
    if (!dispatchEngineAction(editorRef.current as ForkOveEditorInstance | null, actions.createNewDigest)) {
      onSaveErrorRef.current(["The editor store is not ready."]);
    }
  };

  /** Open the engine's PCR simulation panel in the live editor. */
  const openPcrPanel = () => {
    if (!dispatchEngineAction(editorRef.current as ForkOveEditorInstance | null, actions.createNewPCR)) {
      onSaveErrorRef.current(["The editor store is not ready."]);
    }
  };

  const openAlignDialog = () => {
    setAlignError(null);
    setAlignSequence("");
    setAlignName("Aligned sequence");
    setAlignDialogOpen(true);
  };

  /** Open the interactive cloning wizard (selected region becomes the insert). */
  const openCloneWizard = () => {
    setCloneWizardOpen(true);
  };

  /** Open the simulated construct as a new document via the workspace flow. */
  const createCloneConstruct = (construct: SequenceDocument) => {
    setCloneWizardOpen(false);
    onCreateDerivedDocumentRef.current?.(construct);
  };

  /** Run a local pairwise alignment and open it in the engine AlignmentView. */
  const runAlignment = () => {
    const editor = editorRef.current as ForkOveEditorInstance | null;
    const store = editor?.getStore();
    if (!store || typeof store.dispatch !== "function") {
      setAlignError("The editor store is not ready.");
      return;
    }
    try {
      const querySequence = alignSequence.replace(/[\s\d]/g, "").toUpperCase();
      if (!querySequence) {
        setAlignError("Paste a DNA sequence to align against the current sequence.");
        return;
      }
      const tracks = buildAlignmentTracks(docRef.current, alignName.trim() || "Aligned sequence", querySequence);
      const alignmentId = `local-alignment-${Date.now()}`;
      store.dispatch(actions.upsertAlignmentRun({
        id: alignmentId,
        alignmentTracks: tracks,
        // The engine never sets alignmentType; without it the AlignmentView
        // header shows "Unknown Alignment Type" (A-OVE-001).
        alignmentType: "Local Alignment",
      }));
      store.dispatch(actions.createNewAlignment(
        { id: alignmentId, name: "Local Alignment" },
        { editorName: EDITOR_NAME },
      ));
      setAlignDialogOpen(false);
      setAlignError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Alignment failed.";
      setAlignError(message);
    }
  };

  const handleCreateFeature = (feature: SequenceFeature) => {
    const updated = {
      ...docRef.current,
      features: [...docRef.current.features, feature],
    };
    docRef.current = updated;
    // updateEditor() can trigger OVE's legacy autosave callback (same reason the
    // Agent commit path marks an echo). The explicit onSaved() below already
    // records the canonical history entry; consume the matching autosave echo so
    // the dialog does not double-commit.
    markAutosaveEcho(updated);
    editorRef.current?.updateEditor({ sequenceData: toOveData(updated) });
    setCreateDialog(null);
    onSaved(updated);
  };

  const handleCopySelection = async () => {
    if (!selection?.sequence) return;
    try {
      await copyText(selection.sequence);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  const handleCreateSequenceFromSelection = () => {
    if (!selection) return;
    onCreateDerivedDocumentRef.current?.(
      extractSelectionDocument(docRef.current, selection),
    );
  };

  const selectRange = (start: number, end: number, wrapsOrigin = false) => {
    const editor = editorRef.current;
    if (!editor) return;
    const length = docRef.current.sequence.length;
    if (wrapsOrigin) {
      // Canonical wrap range (start > end): the engine expresses it as an
      // inclusive start > end selection on a circular molecule.
      const inclusiveEnd = end === 0 ? length - 1 : end - 1;
      editor.updateEditor({
        selectionLayer: { start, end: inclusiveEnd },
        caretPosition: -1,
      });
      onSelectionChangeRef.current?.({ start, end: inclusiveEnd });
      return;
    }
    const clampedStart = Math.max(0, Math.min(length - 1, start));
    const clampedEnd = Math.max(clampedStart, Math.min(length - 1, end - 1));
    editor.updateEditor({
      selectionLayer: { start: clampedStart, end: clampedEnd },
      caretPosition: -1,
    });
    // Keep the canonical workspace selection in sync with the editor just like
    // the Clear-selection action does, so the inspector/Agent context follow.
    onSelectionChangeRef.current?.({ start: clampedStart, end: clampedEnd });
  };

  const handleValidationMarkerSelect = (marker: ValidationMarker) => {
    selectRange(marker.start, marker.end);
  };

  const handleDiffMarkerSelect = (marker: PatchDiffMarker) => {
    selectRange(marker.start, Math.max(marker.end, marker.start + 1));
  };

  const handleOverviewFeatureSelect = (feature: SequenceFeature) => {
    // Half-open range → the engine's inclusive selection; SnapGene's map
    // ruler selects the feature span on click. Wrap features select the
    // two arcs via OVE's spans-origin convention (start > end).
    selectRange(feature.start, feature.end, isWrappingFeature(feature));
  };

  const handleClearSelection = () => {
    onSelectionChangeRef.current?.({ start: -1, end: -1 });
  };

  const overviewFeatures = [...doc.features]
    .filter((feature) => getFeatureLength(feature, doc.sequence.length) > 0)
    .sort((left, right) => left.start - right.start);
  const hoveredOverviewFeature =
    (hoveredOverviewFeatureId &&
      overviewFeatures.find((feature) => feature.id === hoveredOverviewFeatureId)) ||
    null;

  // GC content is meaningful here only for the bases the user has selected.
  // Showing the whole plasmid's percentage in the footer looks precise but is
  // not actionable for primer/feature work and can be mistaken for the
  // selected fragment's composition. Wrapped selections already carry their
  // concatenated sequence in the canonical selection object.
  const sequenceText = doc.sequence;
  const selectedSequence = selection && selection.length > 0 ? selection.sequence : "";
  const selectedGcCount = (selectedSequence.match(/[GC]/gi) ?? []).length;
  const selectedGcPercent =
    selectedSequence.length > 0
      ? ((selectedGcCount / selectedSequence.length) * 100).toFixed(1)
      : null;
  const ambiguousCount = (sequenceText.match(/[^ACGTU]/gi) ?? []).length;

  return (
    <div className="ove-editor-shell">
      <div className="ove-view-toolbar" role="toolbar" aria-label="编辑器视图">
        <span className="ove-context-label">显示</span>
        <RestrictionEnzymeMenu
          value={enzymeMode}
          onChange={changeEnzymeMode}
          onManage={openManageEnzymes}
        />
        <label className="ove-translation-filter">
          <span>AA</span>
          <select
            aria-label="氨基酸翻译"
            value={translationMode}
            onChange={(event) => changeTranslationMode(event.target.value as TranslationMode)}
            title="氨基酸翻译显示"
          >
            {TRANSLATION_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <div className="ove-sim-tools" role="group" aria-label="模拟工具">
          <button
            type="button"
            className="ove-selection-action ove-sim-tools__clone"
            onClick={openCloneWizard}
            title="将选中区域或粘贴序列克隆到此载体"
          >
            <span>克隆</span>
          </button>
          <button
            type="button"
            className="ove-selection-action"
            onClick={openDigestPanel}
            title="虚拟酶切（限制酶模拟）"
          >
            <span>酶切</span>
          </button>
          <button
            type="button"
            className="ove-selection-action"
            onClick={openPcrPanel}
            title="模拟 PCR（引物扩增）"
          >
            <span>PCR</span>
          </button>
          <button
            type="button"
            className="ove-selection-action"
            onClick={openAlignDialog}
            title="将序列与此序列比对"
          >
            <span>比对</span>
          </button>
        </div>
        {selection && selection.length > 0 && (
          <div className="ove-selection-actions" aria-label="选区操作">
            <span className="ove-selection-actions__summary">
              已选 {selection.length.toLocaleString()} bp
            </span>
            <button
              type="button"
              className="ove-selection-action"
              onClick={() => openCreateDialogRef.current("annotation", {})}
              title="从选区添加注释"
            >
              <Tag aria-hidden="true" />
              <span>注释</span>
            </button>
            <button
              type="button"
              className="ove-selection-action"
              onClick={() => openCreateDialogRef.current("primer", {})}
              title="从选区添加引物"
            >
              <TestTube2 aria-hidden="true" />
              <span>引物</span>
            </button>
            <button
              type="button"
              className="ove-selection-action"
              onClick={handleCreateSequenceFromSelection}
              disabled={!onCreateDerivedDocument}
              title="从选区创建新序列"
            >
              <FilePlus2 aria-hidden="true" />
              <span>新建序列</span>
            </button>
            <button
              type="button"
              className="ove-selection-action"
              onClick={handleCopySelection}
              title="复制选中序列"
              aria-label="复制选中序列"
            >
              <Copy aria-hidden="true" />
              <span>{copyState === "copied" ? "已复制" : copyState === "error" ? "复制失败" : "复制"}</span>
            </button>
            <button
              type="button"
              className="ove-selection-action ove-selection-action--icon"
              onClick={handleClearSelection}
              title="清除选区"
              aria-label="清除选区"
            >
              <X aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      <div className="ove-workbench">
        <aside className="ove-tool-rail" aria-label="编辑器工具">
          <button
            type="button"
            className="ove-tool-rail__button ove-tool-rail__button--active"
            aria-label="选择工具"
            title="选中序列区域"
          >
            <MousePointer2 aria-hidden="true" />
          </button>
          <span className="ove-tool-rail__rule" aria-hidden="true" />
          {/* A-UI-002: selection-gated tools explain WHY they are disabled
              instead of sitting as dead buttons — native disabled buttons
              swallow their title, so use aria-disabled + a descriptive
              tooltip and no-op the click. */}
          <button
            type="button"
            className={`ove-tool-rail__button${!selection || selection.length === 0 ? " ove-tool-rail__button--disabled" : ""}`}
            aria-label="添加注释工具"
            aria-disabled={!selection || selection.length === 0}
            title={
              selection && selection.length > 0
                ? "从选区添加注释"
                : "先选中一段序列（在画布上拖选或双击特征）后可添加注解"
            }
            onClick={() => {
              if (!selection || selection.length === 0) return;
              openCreateDialogRef.current("annotation", {});
            }}
          >
            <Tag aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`ove-tool-rail__button${!selection || selection.length === 0 ? " ove-tool-rail__button--disabled" : ""}`}
            aria-label="添加引物工具"
            aria-disabled={!selection || selection.length === 0}
            title={
              selection && selection.length > 0
                ? "从选区添加引物"
                : "先选中一段序列（在画布上拖选或双击特征）后可添加引物"
            }
            onClick={() => {
              if (!selection || selection.length === 0) return;
              openCreateDialogRef.current("primer", {});
            }}
          >
            <TestTube2 aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`ove-tool-rail__button${!selection || selection.length === 0 ? " ove-tool-rail__button--disabled" : ""}`}
            aria-label="清除选区工具"
            aria-disabled={!selection || selection.length === 0}
            title={
              selection && selection.length > 0
                ? "清除选区"
                : "先选中一段序列后可清除选区"
            }
            onClick={() => {
              if (!selection || selection.length === 0) return;
              handleClearSelection();
            }}
          >
            <Scissors aria-hidden="true" />
          </button>
        </aside>          <div className="ove-editor-canvas">
          <div className="ove-feature-overview" aria-label="特征总览">
            <span className="ove-feature-overview__label">特征</span>
            <div className="ove-feature-overview__track">
              {overviewFeatures.flatMap((feature) => {
                const color = resolveDisplayColor(feature);
                const segments = getFeatureSegments(feature, doc.sequence.length);
                return segments.map((segment, segmentIndex) => {
                  const start = Math.max(0, Math.min(99.4, (segment.start / Math.max(doc.sequence.length, 1)) * 100));
                  const width = Math.max(0.7, Math.min(100 - start, ((segment.end - segment.start) / Math.max(doc.sequence.length, 1)) * 100));
                  return (
                    <button
                      type="button"
                      key={`${feature.id}-${segmentIndex}`}
                      className="ove-feature-overview__feature"
                      style={{
                        left: `${start}%`,
                        width: `${width}%`,
                        backgroundColor: color,
                      }}
                      onClick={() => handleOverviewFeatureSelect(feature)}
                      onMouseEnter={() => setHoveredOverviewFeatureId(feature.id)}
                      onMouseLeave={() => setHoveredOverviewFeatureId(null)}
                      onFocus={() => setHoveredOverviewFeatureId(feature.id)}
                      onBlur={() => setHoveredOverviewFeatureId(null)}
                      aria-label={`选择 ${feature.name || feature.type}（${feature.start + 1}-${feature.end}）`}
                    />
                  );
                });
              })}
              {hoveredOverviewFeature && (() => {
                const featureLength = getFeatureLength(
                  hoveredOverviewFeature,
                  doc.sequence.length,
                );
                const center =
                  (hoveredOverviewFeature.start + featureLength / 2) /
                  Math.max(doc.sequence.length, 1) *
                  100;
                return (
                  <div
                    className="ove-feature-overview__tooltip"
                    role="tooltip"
                    style={{ left: `${Math.max(12, Math.min(88, center))}%` }}
                  >
                    <span
                      className="ove-feature-overview__tooltip-swatch"
                      style={{ backgroundColor: resolveDisplayColor(hoveredOverviewFeature) }}
                      aria-hidden="true"
                    />
                    <span className="ove-feature-overview__tooltip-name">
                      {hoveredOverviewFeature.name || hoveredOverviewFeature.type}
                    </span>
                    <span className="ove-feature-overview__tooltip-meta">
                      {hoveredOverviewFeature.type} · {hoveredOverviewFeature.start + 1}–{hoveredOverviewFeature.end} bp
                    </span>
                  </div>
                );
              })()}
            </div>
            <span className="ove-feature-overview__count">{overviewFeatures.length}</span>
          </div>
          {validationMarkers.length > 0 && (
            <div className="ove-validation-track" aria-label="验证总览">
              <span className="ove-validation-track__label">已验证</span>
              <div className="ove-validation-track__track">
                {validationMarkers.map((marker) => {
                  const start = Math.max(0, Math.min(99.4, (marker.start / Math.max(doc.sequence.length, 1)) * 100));
                  const width = Math.max(0.7, Math.min(100 - start, ((marker.end - marker.start) / Math.max(doc.sequence.length, 1)) * 100));
                  return (
                    <button
                      type="button"
                      key={marker.id}
                      className={`ove-validation-track__marker ${VALIDATION_TONE_CLASS[marker.tone]}`}
                      style={{ left: `${start}%`, width: `${width}%` }}
                      onClick={() => handleValidationMarkerSelect(marker)}
                      title={`${marker.label}${marker.detail ? ` — ${marker.detail}` : ""}`}
                      aria-label={`Select ${marker.label} at ${marker.start + 1}-${marker.end}`}
                    />
                  );
                })}
              </div>
              <span className="ove-validation-track__count">{validationMarkers.length}</span>
            </div>
          )}
          {patchDiffMarkers.length > 0 && (
            <div className="ove-validation-track ove-diff-track" aria-label="建议更改总览">
              <span className="ove-validation-track__label ove-diff-track__label">建议</span>
              <div className="ove-diff-track-wrap">
                <div className="ove-validation-track__track">
                  {patchDiffMarkers.map((marker, index) => {
                    const { start, width } = diffMarkerGeometry(marker, doc.sequence.length);
                    const isInsert = marker.kind === "insert" && marker.end === marker.start;
                    const revealed = index < patchDiffRevealCount;
                    const hovered = hoveredDiffMarkerId === marker.id;
                    return (
                      <button
                        type="button"
                        key={marker.id}
                        className={`ove-validation-track__marker ${DIFF_KIND_CLASS[marker.kind]}${
                          revealed
                            ? " ove-diff-track__marker--revealed"
                            : " ove-diff-track__marker--ghost"
                        }${hovered ? " ove-diff-track__marker--hovered" : ""}`}
                        style={{ left: `${start}%`, width: `${width}%` }}
                        onClick={() => handleDiffMarkerSelect(marker)}
                        onMouseEnter={() => setHoveredDiffMarkerId(marker.id)}
                        onMouseLeave={() => setHoveredDiffMarkerId(null)}
                        onFocus={() => setHoveredDiffMarkerId(marker.id)}
                        onBlur={() => setHoveredDiffMarkerId(null)}
                        aria-label={
                          isInsert
                            ? `Select ${marker.label} at position ${marker.start + 1}`
                            : `Select ${marker.label} at ${marker.start + 1}-${marker.end}`
                        }
                      />
                    );
                  })}
                </div>
                {hoveredDiffMarkerId && (() => {
                  const marker = patchDiffMarkers.find((m) => m.id === hoveredDiffMarkerId);
                  if (!marker) return null;
                  const { center } = diffMarkerGeometry(marker, doc.sequence.length);
                  return (
                    <DiffMarkerTooltip
                      marker={marker}
                      className="ove-diff-track__tooltip"
                      leftPercent={center}
                    />
                  );
                })()}
              </div>
              <span className="ove-validation-track__count">{patchDiffMarkers.length}</span>
            </div>
          )}
          <div ref={hostRef} className="ove-editor-host" />
        </div>
      </div>
      {showDescription && (
        <div className="ove-description-panel" aria-label="序列描述">
          <span className="ove-description-panel__name">{doc.name}</span>
          <span>{doc.sequence.length.toLocaleString()} bp {doc.circular ? "环状" : "线性"}</span>
          <span>{doc.features.length} 个特征</span>
          {selectedGcPercent !== null && <span>选区 GC {selectedGcPercent}%</span>}
          {ambiguousCount > 0 && <span className="ove-footer-chip--warn">{ambiguousCount} 个模糊碱基</span>}
          {doc.accession && <span>登录号 {doc.accession}</span>}
        </div>
      )}
      <nav className="ove-view-footer" aria-label="编辑器状态与视图">
        <div className="ove-view-footer__left">
          <span className="ove-molecule-chip" title={doc.name}>
            <span className="ove-molecule-chip__dot" aria-hidden="true" />
            <span className="ove-molecule-chip__name">{doc.name}</span>
            <small className="ove-molecule-chip__meta">
              {doc.sequence.length.toLocaleString()} bp · {doc.circular ? "环状" : "线性"}
            </small>
          </span>
        </div>
        <div className="ove-view-footer__center">
          <div className="ove-view-segmented" role="group" aria-label="编辑器视图模式">
            <button
              type="button"
              className={`ove-view-button${viewMode === "map" ? " ove-view-button--active" : ""}`}
              aria-label="图谱视图"
              aria-pressed={viewMode === "map"}
              title="图谱视图"
              onClick={() => changeViewMode("map")}
            >
              <span>图谱</span>
            </button>
            <button
              type="button"
              className={`ove-view-button${viewMode === "sequence" ? " ove-view-button--active" : ""}`}
              aria-label="序列视图"
              aria-pressed={viewMode === "sequence"}
              title="序列视图"
              onClick={() => changeViewMode("sequence")}
            >
              <span>序列</span>
            </button>
            <button
              type="button"
              className={`ove-view-button${viewMode === "split" ? " ove-view-button--active" : ""}`}
              aria-label="分屏视图"
              aria-pressed={viewMode === "split"}
              title="图谱与序列"
              onClick={() => changeViewMode("split")}
            >
              <span>双视图</span>
            </button>
          </div>
          <div className="ove-view-footer__panels" role="group" aria-label="侧栏面板">
            <button
              type="button"
              className="ove-view-button ove-view-footer__link"
              aria-label="特征面板"
              title="打开特征列表"
              onClick={() => onOpenPanel?.("annotations")}
            >
              <span>特征</span>
            </button>
            <button
              type="button"
              className="ove-view-button ove-view-footer__link"
              aria-label="历史面板"
              title="打开编辑历史"
              onClick={() => onOpenPanel?.("history")}
            >
              <span>历史</span>
            </button>
          </div>
        </div>
        <div className="ove-view-footer__right">
          {selectedGcPercent !== null && (
            <span className="ove-footer-chip" title="当前选中序列的 GC 含量">
              选区 GC {selectedGcPercent}%
            </span>
          )}
          {ambiguousCount > 0 && (
            <span className="ove-footer-chip ove-footer-chip--warn" title={`${ambiguousCount} 个模糊碱基`}>
              {ambiguousCount} 个模糊
            </span>
          )}
          <span className="ove-footer-chip">{doc.features.length} 个特征</span>
          <label className="ove-footer-check">
            <input
              type="checkbox"
              checked={showDescription}
              onChange={(event) => setShowDescription(event.target.checked)}
              aria-label="显示描述面板"
            />
            <span>描述</span>
          </label>
        </div>
      </nav>
      {cloneWizardOpen && (
        <CloningWizardDialog
          vector={doc}
          selection={selection ?? null}
          onCreate={createCloneConstruct}
          onCancel={() => setCloneWizardOpen(false)}
        />
      )}
      {createDialog && (
        <CreateFeatureDialog
          doc={doc}
          request={createDialog}
          onCancel={() => setCreateDialog(null)}
          onCreate={handleCreateFeature}
        />
      )}
      {alignDialogOpen && createPortal(
        <div className="paste-sequence-overlay" onMouseDown={() => setAlignDialogOpen(false)}>
          <form
            className="paste-sequence create-feature-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="align-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              runAlignment();
            }}
          >
            <div className="paste-sequence__header">
              <div>
                <h2 id="align-dialog-title">序列比对</h2>
                <p className="create-feature-dialog__selection">
                  与“{doc.name}”进行双序列比对
                </p>
              </div>
              <button type="button" onClick={() => setAlignDialogOpen(false)} aria-label="关闭比对对话框">
                <X aria-hidden="true" />
              </button>
            </div>
            <label>
              <span>查询名称</span>
              <input autoFocus value={alignName} onChange={(event) => setAlignName(event.target.value)} />
            </label>
            <label>
              <span>查询序列</span>
              <textarea
                value={alignSequence}
                onChange={(event) => {
                  setAlignSequence(event.target.value);
                  setAlignError(null);
                }}
                placeholder="粘贴要与当前序列比对的 DNA 序列"
                rows={5}
              />
            </label>
            {alignError && <p className="paste-sequence__error" role="alert">{alignError}</p>}
            <div className="paste-sequence__actions">
              <button type="button" className="editor-start__secondary" onClick={() => setAlignDialogOpen(false)}>取消</button>
              <button type="submit" className="editor-start__primary">开始比对</button>
            </div>
          </form>
        </div>,
        document.body,
      )}
    </div>
  );
}
