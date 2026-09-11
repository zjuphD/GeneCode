/**
 * Agent panel — task-driven execution workspace.
 *
 * Single task stream with objective, progress, tool activity, results,
 * and review. Compact, work-focused right sidebar for molecular cloning
 * workflow.
 */

import { useId, useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  AlertTriangle, ArrowDown, ArrowUp, Check, ChevronDown, ChevronLeft,
  ChevronRight, Columns2, Download, FileText, History, Maximize2, Plus,
  RefreshCw, Square, SquarePen, WifiOff, X,
} from "lucide-react";
import type { SequenceDocument, SequenceFeatureInput, SequenceSelection } from "../types";
import { parseSequenceFile } from "../editor/fileFormats";
import { chooseSequenceFile, readSequenceFile } from "../services/sequenceFiles";
import type { PatchPreview } from "../agent/patchTypes";
import PatchPreviewPanel from "./PatchPreview";
import { useAgentSession } from "../agent/useAgentSession";
import type { ServiceStatus } from "../agent/useAgentSession";
import { listAgentRuns, type AgentMode, type AgentSequenceAttachment } from "../agent/service";
// Types from responseTypes are used indirectly via agentPanelHelpers.ts
import { fingerprintDocument } from "../agent/fingerprint";
import { CandidateCards } from "./CandidateCards";
import { CopyActionButton } from "./CopyActionButton";
import { ValidationDetails } from "./ValidationDetails";
import { RunHistoryPanel } from "./RunHistoryPanel";
import { AgentConversationHistory } from "./AgentConversationHistory";
import { TaskConfirmationPanel } from "./TaskConfirmationPanel";
import type { AgentProjectSequence } from "./CloningSetupPanel";
import { loadRunHistory, RUN_HISTORY_UPDATED_EVENT } from "../agent/runHistory";
import {
  loadConversationHistory,
  CONVERSATION_HISTORY_UPDATED_EVENT,
} from "../agent/conversationHistory";
import { buildStepGraph } from "../agent/stepGraph";
import type { StepNode } from "../agent/stepGraph";
import { buildValidationMarkers } from "../agent/validationMarkers";
import type { ValidationMarker } from "../agent/validationMarkers";
import { buildPatchDiffMarkers } from "../agent/patchDiffMarkers";
import type { PatchDiffMarker } from "../agent/patchDiffMarkers";
import { buildNodeTooltip, resolveNodeTarget } from "../agent/nodeLocate";
import type { NodeLocateTarget, NodeTooltipContent } from "../agent/nodeLocate";
import { AgentStepFlow } from "./AgentStepFlow";
import type { RunLogRow } from "../agent/responseTypes";
import {
  AGENT_MODE_OPTIONS,
  MODE_PLACEHOLDERS,
  UNIFIED_TASK_STARTERS,
  inferWorkspaceFromGoal,
  workspaceDisplayLabel,
  mapPlanRowStatus,
  mapRunLogStatus,
  derivePlanningStatus,
  deriveToolStatus,
  deriveResultStatus,
  validationStatusLine,
  buildRunNoteText,
  buildArtifactCsv,
  buildCandidatesCsv,
} from "./agentPanelHelpers";
import type { TaskNodeStatus, TaskStarter } from "./agentPanelHelpers";

// ── Small components ──────────────────────────────────────

// ── Small components ──────────────────────────────────────

function StatusDot({ status }: { status: ServiceStatus }) {
  const color =
    status === "online"
      ? "var(--color-success)"
      : status === "checking" || status === "starting"
        ? "var(--color-warning)"
        : "var(--color-danger)";
  return (
    <span
      className="agent-status-dot"
      style={{ background: color }}
      title={status}
    />
  );
}

/**
 * Semantic tone for the header status pill (P0): maps the derived task state
 * onto a colored pill so the current phase is readable at a glance.
 */
type HeaderStatusTone = "neutral" | "busy" | "waiting" | "ready" | "error";

function headerStatusTone(
  taskState: string,
  serviceStatus: ServiceStatus,
): HeaderStatusTone {
  if (serviceStatus === "offline") return "error";
  if (serviceStatus === "starting" || serviceStatus === "checking") return "waiting";
  if (taskState === "正在规划" || taskState === "运行工具中" || taskState === "验证中") {
    return "busy";
  }
  if (taskState === "等待输入") return "waiting";
  if (taskState === "结果就绪" || taskState === "可继续") return "ready";
  return "neutral";
}

function presentGoal(goal: string): string {
  const normalized = goal.trim().toLowerCase();
  if (normalized.startsWith("i want to clone an insert")) return "将插入片段克隆到当前载体";
  if (normalized.startsWith("design rt-qpcr primers")) return "设计 RT-qPCR 引物";
  if (normalized.startsWith("design knockout sgrnas") || normalized.startsWith("design ko sgrna")) return "设计 KO sgRNA";
  if (normalized.startsWith("design sirna")) return "设计 siRNA 双链体";
  if (normalized.startsWith("design dna point mutation") || normalized.startsWith("design amino-acid mutation")) return "设计点突变引物";
  return goal;
}

/**
 * Minimal, dependency-free inline markdown for chat bubbles: **bold**,
 * *italic*, `code`. Content is HTML-escaped first so it cannot inject markup.
 */
function renderMessageText(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/**
 * Reveal a newly-arrived Agent reply in short text chunks. The backend still
 * owns the authoritative response; this keeps the UI from flashing a whole
 * paragraph into the conversation when that response arrives. A future true
 * token stream can update `content` here without changing the renderer.
 */
function ProgressiveMessageText({
  content,
  animate,
}: {
  content: string;
  animate: boolean;
}) {
  const [visibleLength, setVisibleLength] = useState(animate ? 0 : content.length);

  useEffect(() => {
    if (!animate) {
      setVisibleLength(content.length);
      return undefined;
    }

    let cursor = 0;
    const chunkSize = content.length > 240 ? 5 : 2;
    setVisibleLength(0);
    const timer = window.setInterval(() => {
      cursor = Math.min(content.length, cursor + chunkSize);
      setVisibleLength(cursor);
      if (cursor >= content.length) window.clearInterval(timer);
    }, 24);
    return () => window.clearInterval(timer);
  }, [animate, content]);

  const streaming = animate && visibleLength < content.length;
  return (
    <>
      <span
        className="agent-streaming-text"
        aria-busy={streaming}
        dangerouslySetInnerHTML={{ __html: renderMessageText(content.slice(0, visibleLength)) }}
      />
      {streaming && <span className="agent-streaming-caret" aria-hidden="true">▍</span>}
    </>
  );
}

function OfflineState({
  healthLabel,
  onRetry,
}: {
  healthLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="agent-offline agent-offline--card">
      <div className="agent-offline__icon" aria-hidden="true">
        <WifiOff />
      </div>
      <div className="agent-offline__content">
        <strong className="agent-offline__title">Agent 服务不可用</strong>
        <p className="agent-offline__hint">本地 Agent 服务不可用。</p>
        <code className="agent-offline__addr">预期地址：http://127.0.0.1:8000</code>
        <p className="agent-offline__reason">{healthLabel}</p>
        <button
          type="button"
          className="agent-btn agent-btn--primary agent-offline__retry"
          onClick={onRetry}
        >
          <RefreshCw aria-hidden="true" />
          重试
        </button>
      </div>
    </div>
  );
}

// ── Task node row ─────────────────────────────────────────

function TaskNodeRow({
  status,
  label,
  detail,
  className,
  children,
}: {
  status: TaskNodeStatus;
  label: string;
  detail?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`task-node task-node--${status}${className ? ` ${className}` : ""}`}>
      <div className="task-node__header">
        <span className="task-node__dot" />
        <span className="task-node__label">{label}</span>
        {detail !== undefined && detail !== "" && (
          <span className="task-node__detail">{detail}</span>
        )}
      </div>
      {children && <div className="task-node__content">{children}</div>}
    </div>
  );
}

/** Trigger a browser download of a CSV string (shared by auto-archive export). */
function triggerCsvDownload(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const el = document.createElement("a");
  el.href = url;
  el.download = filename;
  el.click();
  URL.revokeObjectURL(url);
}

function AgentWorkingIndicator({
  phase,
  validationRunning,
  activeTool,
}: {
  phase: "idle" | "planning" | "executing";
  validationRunning: boolean;
  activeTool: string;
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    setElapsedSeconds(0);
    const intervalId = window.setInterval(() => {
      setElapsedSeconds((value) => value + 1);
    }, 1_000);
    return () => window.clearInterval(intervalId);
  }, [phase, validationRunning]);

  let title = "思考中…";
  let detail = elapsedSeconds >= 10
    ? "仍在运行；复杂任务可能需要更长时间"
    : "正在理解任务、读取序列并准备计划";
  if (phase === "executing") {
    title = "运行工具…";
    detail = activeTool ? `正在运行 ${activeTool}` : "正在启动分子设计工具";
  } else if (validationRunning) {
    title = "验证中…";
    detail = "正在检查外部数据库并复核候选结果";
  }

  return (
    <div className="agent-working" role="status" aria-live="polite" aria-atomic="true">
      <span className="agent-working__spinner" aria-hidden="true" />
      <span className="agent-working__content">
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      <span className="agent-working__elapsed">{elapsedSeconds}s</span>
    </div>
  );
}

// ── Copy action ───────────────────────────────────────────

// CopyActionButton extracted to ./CopyActionButton.tsx

// ── Step detail panel ───────────────────────────────────────

/** Format a server-measured step duration (ms) for the detail panel. */
function formatStepDuration(durationMs: number | undefined): string | null {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}

function StepJsonBlock({ label, value }: { label: string; value: unknown }) {
  // Data is runtime-normalized JSON, so stringify cannot throw.
  const text = JSON.stringify(value, null, 2);
  return (
    <div className="agent-runlog-detail__block">
      <span className="agent-runlog-detail__block-label">{label}</span>
      <pre className="agent-runlog-detail__json">{text}</pre>
    </div>
  );
}

/**
 * Expandable per-step detail row: tool, status, wall-clock duration, the
 * compact resolved inputs (args), and the compact result summary (design
 * doc §9.4). Only rendered when the backend attached any of these fields.
 */
function RunLogDetailRow({ row }: { row: RunLogRow }) {
  const duration = formatStepDuration(row.durationMs);
  const hasDetail = Boolean(
    row.args !== undefined || row.result !== undefined || duration !== null,
  );
  return (
    <TaskNodeRow
      status={mapRunLogStatus(row.status)}
      label={row.tool || row.step || "Tool"}
      detail={row.message || undefined}
    >
      {hasDetail && (
        <details className="agent-runlog-detail">
          <summary className="agent-runlog-detail__summary">
            <span>步骤详情</span>
            {duration && <span className="agent-runlog-detail__duration">{duration}</span>}
          </summary>
          <div className="agent-runlog-detail__body">
            {row.args !== undefined && <StepJsonBlock label="输入参数" value={row.args} />}
            {row.result !== undefined && <StepJsonBlock label="结果摘要" value={row.result} />}
          </div>
        </details>
      )}
    </TaskNodeRow>
  );
}

// ── Candidate display ─────────────────────────────────────

// PrimerExplanation and CandidateCards are extracted to separate files.

// ── Input composer ────────────────────────────────────────

function InputComposer({
  busy,
  available,
  placeholder,
  resetSignal,
  onSend,
  onCancel,
  attachment,
  attaching,
  attachmentError,
  onAttach,
  onRemoveAttachment,
  context,
  controls,
  mode,
}: {
  busy: boolean;
  available: boolean;
  placeholder: string;
  /** Incremented by the New task action to clear and focus the composer. */
  resetSignal: number;
  onSend: (message: string) => void;
  onCancel: () => void;
  attachment: { name: string; detail: string } | null;
  attaching: boolean;
  attachmentError: string | null;
  onAttach: () => void;
  onRemoveAttachment: () => void;
  context: React.ReactNode;
  controls: React.ReactNode;
  mode: AgentMode;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (resetSignal === 0) return;
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "64px";
      textareaRef.current.focus();
    }
  }, [resetSignal]);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if ((!trimmed && !attachment) || busy || !available) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "64px";
    }
  }, [value, attachment, busy, available, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !busy && available && (value.trim() || attachment)) {
        e.preventDefault();
        handleSend();
      }
    },
    [value, attachment, busy, available, handleSend],
  );

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = "64px";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, []);

  return (
    <div
      className={`agent-composer${busy ? " agent-composer--busy" : ""}${available ? "" : " agent-composer--unavailable"}`}
      aria-busy={busy}
    >
      {attachment && (
        <div className="agent-composer__attachment">
          <span>
            <strong>{attachment.name}</strong>
            <small>{attachment.detail}</small>
          </span>
          <button
            type="button"
            className="agent-btn agent-btn--icon"
            onClick={onRemoveAttachment}
            disabled={busy}
            aria-label="Remove attached sequence"
            title="Remove attachment"
          >
            <X aria-hidden="true" />
          </button>
        </div>
      )}
      {attachmentError && (
        <div className="agent-composer__attachment-error" role="alert">
          {attachmentError}
        </div>
      )}
      <div className="agent-composer__field">
        {context}
        <textarea
          ref={textareaRef}
          className="agent-composer__input"
          placeholder={placeholder}
          aria-label="Agent message input"
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          rows={2}
        />
        <div className="agent-composer__actions">
        <button
          type="button"
          className="agent-btn agent-btn--icon agent-composer__attach"
          onClick={onAttach}
          disabled={busy || attaching || !available}
          aria-label="Attach sequence file"
          title="Attach GenBank, FASTA, or SnapGene sequence"
        >
          <Plus aria-hidden="true" />
        </button>
        {controls}
        <button
          type="button"
          className={`agent-btn agent-composer__send${busy ? " agent-composer__send--stop" : " agent-btn--primary"}`}
          onClick={busy ? onCancel : handleSend}
          disabled={!busy && ((!value.trim() && !attachment) || !available)}
          aria-label={busy ? "停止 Agent" : "发送消息"}
        >
          {busy ? <Square aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
        </button>
        </div>
      </div>
      <span className="agent-composer__hint">
        {mode === "auto" ? "自动执行 · 序列修改另存为副本" : mode === "review" ? "仅审阅 · 不修改序列" : "先确认计划，再执行设计"}
        <span>Shift + Enter 换行</span>
      </span>
    </div>
  );
}

function AgentModeSelector({
  mode,
  busy,
  available,
  onChange,
}: {
  mode: AgentMode;
  busy: boolean;
  available: boolean;
  onChange: (mode: AgentMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = AGENT_MODE_OPTIONS.find((option) => option.id === mode) ?? AGENT_MODE_OPTIONS[1]!;

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!selectorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const disabled = busy || !available;
  return (
    <div
      ref={selectorRef}
      className={`agent-mode-selector${open ? " agent-mode-selector--open" : ""}`}
      aria-label="Agent 权限模式"
    >
      <button
        ref={triggerRef}
        type="button"
        className="agent-mode-trigger"
        aria-label={`Agent 权限模式：${selected.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((isOpen) => !isOpen)}
        disabled={disabled}
      >
        <span className="agent-mode-trigger__label">{selected.label}</span>
        <ChevronDown className="agent-mode-trigger__chevron" aria-hidden="true" />
      </button>

      {open && !disabled && (
        <div className="agent-mode-menu" role="menu" aria-label="选择 Agent 模式">
          {AGENT_MODE_OPTIONS.map((option) => {
            const active = option.id === selected.id;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={`agent-mode-option${active ? " agent-mode-option--active" : ""}`}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
              >
                <span className="agent-mode-option__check" aria-hidden="true">
                  {active && <Check size={14} />}
                </span>
                <span className="agent-mode-option__copy">
                  <span className="agent-mode-option__label">{option.label}</span>
                  <span className="agent-mode-option__description">{option.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────

export interface AgentPanelProps {
  sessionKey?: string;
  doc: SequenceDocument | null;
  selection: SequenceSelection | null;
  pendingPreview: PatchPreview | null;
  revertDocument: SequenceDocument | null;
  /** Accepts unknown to preserve the runtime boundary. */
  onLoadPreview: (patch: unknown) => boolean;
  onApply: () => void;
  /**
   * Apply the pending change to a copy of the document opened as a new file,
   * leaving the original document/file untouched.
   */
  onApplyAsNewFile?: () => void;
  onReject: () => void;
  onRevert: () => void;
  /** Add a feature annotation to the current document. */
  onAddFeature?: (feature: SequenceFeatureInput) => void;
  /**
   * Remote validation markers resolved against the open sequence, reported
   * so the workspace can render them on the editor track.
   */
  onValidationMarkersChange?: (markers: ValidationMarker[]) => void;
  /**
   * Agent patch diff markers resolved from the pending preview, reported so
   * the workspace can render the "Proposed" track on the editor before apply.
   */
  onPatchDiffMarkersChange?: (markers: PatchDiffMarker[]) => void;
  /**
   * Timeline-playback reveal progress for the diff track: how many of the
   * patch diff markers are currently lit up. Reported so the workspace can
   * mirror the reveal on the editor's "Proposed" track.
   */
  onDiffRevealChange?: (revealedCount: number) => void;
  /**
   * Locate a result region in the sequence editor (called when a step node
   * with a locatable target is clicked).
   */
  onLocateRegion?: (region: { start: number; end: number; label?: string }) => void;
  /** Local sequence library exposed as selectable insert sources. */
  sequenceLibrary?: AgentProjectSequence[];
  activeProjectId?: string | null;
  /** Optional controlled visibility used by the workspace shell. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hide the legacy collapsed rail when the shell provides its own launcher. */
  hideCollapsedRail?: boolean;
  /** Reads the live OVE document/selection at action time when available. */
  getLiveEditorContext?: () => {
    document: SequenceDocument;
    selection: SequenceSelection | null;
    caretPosition: number | null;
  } | null;
  /** Stable shell id used by the Agent launcher aria-controls relationship. */
  id?: string;
}

interface AgentActionContext {
  document: SequenceDocument | null;
  selection: SequenceSelection | null;
  caretPosition: number | null;
}

/** Preserve a caret-only OVE context through the existing selection API. */
function selectionForAgentContext(context: AgentActionContext): SequenceSelection | null {
  if (context.selection || context.caretPosition === null || !context.document) return context.selection;
  const position = Math.max(0, Math.min(context.document.sequence.length, context.caretPosition));
  return {
    start: position,
    end: position,
    length: 0,
    wrapsOrigin: false,
    sequence: "",
    cursor: true,
  };
}

// ── Main panel ────────────────────────────────────────────

const AGENT_PANEL_WIDTH_STORAGE_KEY = "genecode-agent-panel-width";

function AgentPanel({
  sessionKey,
  doc,
  selection,
  pendingPreview,
  revertDocument,
  onLoadPreview,
  onApply,
  onApplyAsNewFile,
  onReject,
  onRevert,
  onAddFeature,
  onValidationMarkersChange,
  onPatchDiffMarkersChange,
  onDiffRevealChange,
  onLocateRegion,
  open,
  onOpenChange,
  hideCollapsedRail = false,
  getLiveEditorContext,
  id,
}: AgentPanelProps) {
  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState(() =>
    typeof window !== "undefined" && window.innerWidth < 900,
  );
  const collapsed = open === undefined ? uncontrolledCollapsed : !open;
  const [wide, setWide] = useState(() => window.localStorage.getItem("genecode-agent-focus") === "true");
  useEffect(() => {
    window.localStorage.setItem("genecode-agent-focus", String(wide));
  }, [wide]);
  const [panelWidth, setPanelWidth] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = Number(window.localStorage.getItem(AGENT_PANEL_WIDTH_STORAGE_KEY));
    return Number.isFinite(stored) && stored >= 280 && stored <= 800 ? stored : null;
  });
  const isResizingRef = useRef(false);
  const [showOlderMessages, setShowOlderMessages] = useState(false);
  const [composerResetSignal, setComposerResetSignal] = useState(0);
  const [newTaskNotice, setNewTaskNotice] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<SequenceDocument | null>(null);
  const [attachmentLoading, setAttachmentLoading] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [historyCount, setHistoryCount] = useState(() => loadRunHistory().length);
  const [backendHistoryCount, setBackendHistoryCount] = useState(0);
  const [conversationHistoryCount, setConversationHistoryCount] = useState(
    () => loadConversationHistory().length,
  );
  const [conversationHistoryOpen, setConversationHistoryOpen] = useState(false);
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);
  const [focusedCandidate, setFocusedCandidate] = useState<{ index: number; token: number } | null>(null);
  const prevPatchIdRef = useRef<string | null>(null);
  const bodyId = useId();
  const taskStreamRef = useRef<HTMLDivElement>(null);
  const [followLatest, setFollowLatest] = useState(true);
  const prevDocHashRef = useRef<string | null>(null);

  const session = useAgentSession(sessionKey);

  // The browser-side notebook is fast and local; the Sidecar Journal is the
  // authority after a restart. The bounded list keeps this check cheap while
  // also allowing the disclosure count to reflect durable runs.
  useEffect(() => {
    if (import.meta.env.MODE === "test" || session.serviceStatus !== "online") {
      setBackendHistoryCount(0);
      return undefined;
    }
    const controller = new AbortController();
    void listAgentRuns(50, controller.signal)
      .then((runs) => setBackendHistoryCount(runs.length))
      .catch(() => {
        if (!controller.signal.aborted) setBackendHistoryCount(0);
      });
    return () => controller.abort();
  }, [session.serviceStatus]);
  const readActionContext = useCallback((): AgentActionContext => {
    const live = getLiveEditorContext?.();
    return {
      document: live?.document ?? doc,
      selection: live?.selection ?? selection,
      caretPosition: live?.caretPosition ?? null,
    };
  }, [doc, getLiveEditorContext, selection]);

  // Derive the visual step DAG from session state
  const stepGraph = useMemo(
    () =>
      buildStepGraph({
        plan: session.plan,
        runLog: session.runLog,
        timeline: session.timeline,
        phase: session.phase,
        validationStatus: session.validationStatus,
        hasResults:
          session.recommendation !== null ||
          session.candidates.length > 0 ||
          session.resultCount !== null,
      }),
    [
      session.plan,
      session.runLog,
      session.timeline,
      session.phase,
      session.validationStatus,
      session.recommendation,
      session.candidates,
      session.resultCount,
    ],
  );

  // Resolve validation results onto the open sequence for the editor track
  const validationMarkers = useMemo(
    () =>
      buildValidationMarkers({
        validationResults: session.validationResults,
        candidates: session.candidates,
        sequence: doc?.sequence ?? "",
        workspace: session.workspace,
      }),
    [session.validationResults, session.candidates, session.workspace, doc?.sequence],
  );

  // Report markers whenever they change (and clear when a task resets)
  const hasValidationActivity = session.validationStatus === "completed" || session.validationResults.length > 0;
  useEffect(() => {
    if (typeof onValidationMarkersChange !== "function") return;
    onValidationMarkersChange(hasValidationActivity ? validationMarkers : []);
  }, [hasValidationActivity, onValidationMarkersChange, validationMarkers]);

  // Resolve the pending patch preview onto the before-sequence coordinates so
  // the editor can show where the proposed change lands before apply.
  const patchDiffMarkers = useMemo(
    () => (pendingPreview ? buildPatchDiffMarkers(pendingPreview) : []),
    [pendingPreview],
  );
  useEffect(() => {
    if (typeof onPatchDiffMarkersChange !== "function") return;
    onPatchDiffMarkersChange(pendingPreview ? patchDiffMarkers : []);
  }, [onPatchDiffMarkersChange, patchDiffMarkers, pendingPreview]);

  // ── Timeline playback reveal ────────────────────────────────────────
  // When a patch preview arrives (usually at the end of execution), the diff
  // track does not flash everything at once. Instead the blocks light up / grow
  // one by one in operation order, paced like the tools that produced them, so
  // the user watches the Agent's edits progressively appear on the sequence.
  const [diffRevealCount, setDiffRevealCount] = useState(0);
  const prevRevealPreviewIdRef = useRef<string | null>(null);

  // Completed tool steps pace the reveal when a preview is present while the
  // tools are still running (e.g. planning-stage patches): each finished step
  // grants one more lit block. After execution the whole set plays out.
  const completedStepCount = useMemo(
    () => session.runLog.filter((row) => row.status === "completed").length,
    [session.runLog],
  );

  // When the timeline playback finishes (every block lit), auto-locate the
  // sequence editor to the LAST lit diff region and focus the corresponding
  // operation row in the preview table, so the user lands on the final change
  // without hunting for it. Guarded per preview id so a mid-stream marker
  // refresh never re-fires the locate.
  const [focusedOperationId, setFocusedOperationId] = useState<string | null>(null);
  const locatedFinalRef = useRef<string | null>(null);

  // Restart the reveal from zero the moment a different preview appears (or is
  // cleared). Adjusting state during render (React docs pattern) keeps the
  // reset in the same commit as the report effect below, so onDiffRevealChange
  // never emits a stale count against the new preview's markers.
  const revealPreviewId = pendingPreview?.patchId ?? null;
  if (revealPreviewId !== prevRevealPreviewIdRef.current) {
    prevRevealPreviewIdRef.current = revealPreviewId;
    setDiffRevealCount(0);
    setFocusedOperationId(null);
  }

  // Play the timeline: step one marker per tick until the full set is lit.
  // While executing, cap at the completed step count so live runs reveal in
  // lockstep with tool completion; otherwise reveal the whole operation list.
  useEffect(() => {
    if (patchDiffMarkers.length === 0) return;
    const isExecuting = session.phase === "executing" || session.validationStatus === "running";
    const liveCap = isExecuting
      ? Math.min(patchDiffMarkers.length, Math.max(1, completedStepCount))
      : patchDiffMarkers.length;
    if (diffRevealCount >= liveCap) return;
    const timer = window.setTimeout(() => {
      setDiffRevealCount((count) => Math.min(liveCap, count + 1));
    }, 320);
    return () => window.clearTimeout(timer);
  }, [diffRevealCount, patchDiffMarkers.length, completedStepCount, session.phase, session.validationStatus]);

  // Report the reveal progress so the workspace mirrors it on the editor track.
  useEffect(() => {
    if (typeof onDiffRevealChange !== "function") return;
    onDiffRevealChange(pendingPreview ? diffRevealCount : 0);
  }, [onDiffRevealChange, pendingPreview, diffRevealCount]);

  // When the whole diff track has played out, locate the last lit region in
  // the editor and focus its operation row in the preview table. This runs
  // once per preview (per-preview ref guard): the user watches the playback
  // complete, then lands directly on the final change.
  const revealFinished =
    patchDiffMarkers.length > 0 &&
    diffRevealCount >= patchDiffMarkers.length &&
    session.phase !== "executing" &&
    session.validationStatus !== "running";
  useEffect(() => {
    if (!revealFinished) return;
    const patchId = pendingPreview?.patchId ?? null;
    if (!patchId || locatedFinalRef.current === patchId) return;
    locatedFinalRef.current = patchId;
    const last = patchDiffMarkers[patchDiffMarkers.length - 1];
    if (!last) return;
    // Zero-width insert markers widen to a single base so the editor can
    // scroll to the insertion point.
    const length = doc?.sequence.length ?? last.end;
    let start = Math.max(0, Math.min(length, last.start));
    let end = Math.max(start, Math.min(length, last.end));
    if (end <= start) {
      end = Math.min(length, start + 1);
      start = Math.max(0, end - 1);
    }
    if (end <= start) return;
    onLocateRegion?.({ start, end, label: last.label });
    setFocusedOperationId(last.id);
  }, [revealFinished, patchDiffMarkers, pendingPreview?.patchId, doc?.sequence.length, onLocateRegion]);

  // Reset the auto-locate guard whenever the preview changes (or is cleared);
  // the focused row itself is cleared in the same render-phase reset above.
  useEffect(() => {
    locatedFinalRef.current = null;
  }, [pendingPreview?.patchId]);

  // Auto mode: apply the pending change directly to a copy of the document
  // opened as a new file, without waiting for the user to click the apply
  // button. The copy flow is non-destructive (the original file stays
  // untouched) and the sandbox diff opens automatically so the user can still
  // review the result. Guarded per preview id so marker/preview refreshes
  // never re-apply the same patch.
  const autoAppliedPreviewIdRef = useRef<string | null>(null);
  // Patch ids observed while the plan was still awaiting confirmation. Those
  // are plan sketches, not the final design: they must never be auto-applied,
  // even if execution later flips readyToExecute to false without producing a
  // fresh patch (the stale preview would otherwise slip through the gate).
  const planSketchPreviewIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (session.agentMode !== "auto") return;
    if (typeof onApplyAsNewFile !== "function") return;
    if (!pendingPreview || pendingPreview.errors.length > 0) return;
    const patchId = pendingPreview.patchId;
    if (!patchId) return;
    // Planning-stage responses may carry a draft sequencePatch while the plan
    // is still awaiting confirmation (readyToExecute is true). Record it as a
    // sketch and bail — auto-applying it would open a copy before the real
    // design has run.
    if (session.readyToExecute) {
      planSketchPreviewIdRef.current = patchId;
      return;
    }
    if (planSketchPreviewIdRef.current === patchId) return;
    if (autoAppliedPreviewIdRef.current === patchId) return;
    autoAppliedPreviewIdRef.current = patchId;
    onApplyAsNewFile();
  }, [session.agentMode, session.readyToExecute, pendingPreview, onApplyAsNewFile]);

  // Auto mode: pure design runs (candidates, no sequencePatch) have no copy/diff
  // landing point — the run would end with results stranded in the panel. So
  // auto-archive the candidate results to a downloadable CSV and surface a
  // notice, giving the run a concrete artifact exactly like patch tasks get
  // the sandbox diff. Guarded per run id so re-renders/marker refreshes never
  // re-export the same run.
  const [autoArchivedRun, setAutoArchivedRun] = useState<{
    runId: string;
    filename: string;
    csv: string;
  } | null>(null);
  const autoArchivedRunIdRef = useRef<string | null>(null);
  useEffect(() => {
    // Clear any previous archive notice when the run identity changes (new
    // run starts or the session resets) so a stale notice never lingers.
    if (autoArchivedRun && session.agentRun.runId !== autoArchivedRun.runId) {
      setAutoArchivedRun(null);
    }
    if (session.agentMode !== "auto") return;
    if (session.phase !== "idle") return;
    if (pendingPreview) return; // patch flow owns its landing point
    const runId = session.agentRun.runId;
    if (!runId || session.candidates.length === 0) return;
    if (autoArchivedRunIdRef.current === runId) return;
    const csv = buildCandidatesCsv(session.candidates);
    if (!csv) return;
    // Guard consumed only after the CSV is confirmed non-empty, so an empty
    // export never permanently marks the run archived without a landing point.
    autoArchivedRunIdRef.current = runId;
    const filename = `genecode-${session.workspace}-${runId}.csv`;
    setAutoArchivedRun({ runId, filename, csv });
    triggerCsvDownload(filename, csv);
  }, [session.agentMode, session.phase, session.agentRun.runId, session.candidates, session.workspace, pendingPreview, autoArchivedRun]);

  // Resolve which step nodes are locatable and to which editor region + card
  const nodeTargets = useMemo(() => {
    const targets = new Map<string, NodeLocateTarget>();
    for (const node of stepGraph.nodes) {
      const target = resolveNodeTarget({
        node,
        candidates: session.candidates,
        markers: validationMarkers,
        sequence: doc?.sequence ?? "",
        workspace: session.workspace,
      });
      if (target) targets.set(node.id, target);
    }
    return targets;
  }, [stepGraph.nodes, session.candidates, validationMarkers, doc?.sequence, session.workspace]);
  const clickableNodeIds = useMemo(() => new Set(nodeTargets.keys()), [nodeTargets]);

  // Hover tooltips for clickable nodes: validation status (when applicable)
  // plus the resolved region coordinates and a locate-in-editor hint.
  const nodeTooltips = useMemo(() => {
    const tips = new Map<string, NodeTooltipContent>();
    for (const node of stepGraph.nodes) {
      const target = nodeTargets.get(node.id);
      if (!target) continue;
      const isCheckLike =
        node.layer === 2 || (node.tool || "").toLowerCase().startsWith("check");
      const validationStatus = isCheckLike
        ? session.validationStatus === "error"
          ? "Remote validation failed"
          : session.validationStatus === "running"
            ? "Running remote validation"
            : session.validationStatus === "completed"
              ? (() => {
                  const result = session.validationResults[target.candidateIndex ?? 0];
                  return result ? validationStatusLine(result) : "Validation complete";
                })()
              : null
        : null;
      const content = buildNodeTooltip(target, validationStatus);
      if (content) tips.set(node.id, content);
    }
    return tips;
  }, [stepGraph.nodes, nodeTargets, session.validationStatus, session.validationResults]);

  const handleStepNodeClick = useCallback((node: StepNode) => {
    const target = nodeTargets.get(node.id);
    if (!target || target.regions.length === 0) return;
    // Explicitly locating a tool result reveals the sequence canvas; live
    // background updates must not switch the user's chosen conversation view.
    setWide(false);
    if (window.innerWidth < 1000) {
      if (open === undefined) setUncontrolledCollapsed(true);
      onOpenChange?.(false);
    }
    const start = Math.min(...target.regions.map((region) => region.start));
    const end = Math.max(...target.regions.map((region) => region.end));
    onLocateRegion?.({ start, end, label: target.regions[0]?.label });
    if (target.candidateIndex != null) {
      setFocusedCandidate((current) => ({
        index: target.candidateIndex!,
        token: (current?.token ?? 0) + 1,
      }));
    }
  }, [nodeTargets, onLocateRegion, open, onOpenChange]);

  // Current-step live tracking: when a tool/validation node becomes active
  // and it has a locatable target, auto-locate the region in the editor and
  // focus the candidate card so the user sees where the running tool acts.
  // A ref guard ensures we only re-locate when the active node transitions,
  // so candidate/marker refreshes mid-execution don't spam onLocateRegion.
  const activeLiveNodeId = useMemo(() => {
    if (session.phase !== "executing" && session.validationStatus !== "running") return null;
    const active = stepGraph.nodes.find((node) => node.status === "active");
    return active?.id ?? null;
  }, [session.phase, session.validationStatus, stepGraph.nodes]);
  const activeLiveTarget = activeLiveNodeId ? nodeTargets.get(activeLiveNodeId) : undefined;
  const locatedLiveNodeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeLiveNodeId || !activeLiveTarget || activeLiveTarget.regions.length === 0) return;
    if (locatedLiveNodeRef.current === activeLiveNodeId) return;
    locatedLiveNodeRef.current = activeLiveNodeId;
    const start = Math.min(...activeLiveTarget.regions.map((region) => region.start));
    const end = Math.max(...activeLiveTarget.regions.map((region) => region.end));
    onLocateRegion?.({ start, end, label: activeLiveTarget.regions[0]?.label });
    if (activeLiveTarget.candidateIndex != null) {
      setFocusedCandidate((current) => ({
        index: activeLiveTarget.candidateIndex!,
        token: (current?.token ?? 0) + 1,
      }));
    }
  }, [activeLiveNodeId, activeLiveTarget, onLocateRegion]);

  useEffect(() => {
    const refreshHistoryCount = () => setHistoryCount(loadRunHistory().length);
    refreshHistoryCount();
    window.addEventListener(RUN_HISTORY_UPDATED_EVENT, refreshHistoryCount);
    return () => window.removeEventListener(RUN_HISTORY_UPDATED_EVENT, refreshHistoryCount);
  }, []);

  useEffect(() => {
    const refreshConversationHistoryCount = () =>
      setConversationHistoryCount(loadConversationHistory().length);
    refreshConversationHistoryCount();
    window.addEventListener(
      CONVERSATION_HISTORY_UPDATED_EVENT,
      refreshConversationHistoryCount,
    );
    return () =>
      window.removeEventListener(
        CONVERSATION_HISTORY_UPDATED_EVENT,
        refreshConversationHistoryCount,
      );
  }, []);

  // Drag-to-resize handle
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    const startX = e.clientX;
    const measuredWidth = e.currentTarget.parentElement?.getBoundingClientRect().width ?? 0;
    const startWidth = measuredWidth > 0 ? measuredWidth : panelWidth ?? 420;
    let latestWidth = startWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = startX - ev.clientX; // Drag the right-docked panel's left edge.
      const newWidth = Math.max(360, Math.min(800, startWidth + delta));
      latestWidth = newWidth;
      setPanelWidth(newWidth);
    };

    const handleUp = () => {
      isResizingRef.current = false;
      window.localStorage.setItem(AGENT_PANEL_WIDTH_STORAGE_KEY, String(Math.round(latestWidth)));
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, [panelWidth]);

  // Wire sequencePatch handoff to TASK-005 validation boundary
  useEffect(() => {
    session.setOnSequencePatchReceived((patch: unknown) => {
      onLoadPreview(patch);
    });
    return () => session.setOnSequencePatchReceived(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onLoadPreview]);

  // Context invalidation: detect document hash changes
  useEffect(() => {
    const hash = doc ? fingerprintDocument(doc) : null;
    if (hash !== prevDocHashRef.current) {
      session.onDocumentHashChange(hash);
      prevDocHashRef.current = hash;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  // Auto-scroll to bottom on new stream content (throttled to avoid excessive reflows)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!followLatest) return;
    if (scrollTimerRef.current) return; // already scheduled
    scrollTimerRef.current = setTimeout(() => {
      scrollTimerRef.current = null;
      const stream = taskStreamRef.current;
      if (stream) {
        if (typeof stream.scrollTo === "function") {
          stream.scrollTo({ top: stream.scrollHeight, behavior: "smooth" });
        } else {
          stream.scrollTop = stream.scrollHeight;
        }
      }
    }, 100);
    return () => {
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = null;
      }
    };
  }, [followLatest, session.messages, session.plan, session.runLog, session.recommendation, session.candidates, session.phase, session.validationStatus, pendingPreview]);

  // Reset acknowledgement when the proposal changes
  useEffect(() => {
    const newId = pendingPreview?.patchId ?? null;
    if (newId !== prevPatchIdRef.current) {
      setWarningsAcknowledged(false);
      prevPatchIdRef.current = newId;
    }
  }, [pendingPreview?.patchId]);

  const handleSend = useCallback(
    (message: string) => {
      setNewTaskNotice(false);
      setFollowLatest(true);
      setShowOlderMessages(false);
      const attachment: AgentSequenceAttachment | undefined = pendingAttachment
        ? {
            name: pendingAttachment.name,
            sequence: pendingAttachment.sequence,
            circular: pendingAttachment.circular,
            featureCount: pendingAttachment.features.length,
          }
        : undefined;
      const goal = message.trim() || "请读取附件序列并继续当前任务。";
      const displayMessage = pendingAttachment
        ? `${message.trim() ? `${message.trim()}\n` : ""}附件：${pendingAttachment.name} · ${pendingAttachment.sequence.length.toLocaleString()} bp`
        : undefined;
      const current = readActionContext();
      const agentSelection = selectionForAgentContext(current);
      if (attachment) {
        session.sendMessage(goal, current.document, undefined, agentSelection, attachment, displayMessage);
      } else {
        session.sendMessage(goal, current.document, undefined, agentSelection);
      }
      setPendingAttachment(null);
      setAttachmentError(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.sendMessage, pendingAttachment, readActionContext],
  );

  // Starters are workspace-locked: the chip pins its workspace so the snapshot
  // is built for the right formState slots and routing never drifts from the
  // task intent (P1-8). Free-form composer messages stay workspace-agnostic.
  // A pending attached sequence is forwarded exactly like handleSend does so
  // starting from a chip never silently drops the attachment.
  const handleStarterSend = useCallback(
    (task: TaskStarter) => {
      setNewTaskNotice(false);
      setFollowLatest(true);
      setShowOlderMessages(false);
      const attachment: AgentSequenceAttachment | undefined = pendingAttachment
        ? {
            name: pendingAttachment.name,
            sequence: pendingAttachment.sequence,
            circular: pendingAttachment.circular,
            featureCount: pendingAttachment.features.length,
          }
        : undefined;
      const current = readActionContext();
      const agentSelection = selectionForAgentContext(current);
      session.sendMessage(task.prompt, current.document, task.workspace, agentSelection, attachment);
      setPendingAttachment(null);
      setAttachmentError(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.sendMessage, pendingAttachment, readActionContext],
  );

  const handleAttachSequence = useCallback(async () => {
    setAttachmentError(null);
    setAttachmentLoading(true);
    try {
      const path = await chooseSequenceFile();
      if (!path) return;
      const contents = await readSequenceFile(path);
      const parsed = await parseSequenceFile(contents, path);
      if (!parsed.sequence) {
        throw new Error("The selected file has no sequence.");
      }
      if (parsed.sequence.length > 2_000_000) {
        throw new Error("This sequence is too large for an Agent attachment (maximum 2 Mb).");
      }
      setPendingAttachment(parsed);
    } catch (error) {
      setPendingAttachment(null);
      setAttachmentError(error instanceof Error ? error.message : "Could not attach this sequence file.");
    } finally {
      setAttachmentLoading(false);
    }
  }, []);

  const handleExecute = useCallback(() => {
    const current = readActionContext();
    session.executeDesign(current.document, session.workspace, selectionForAgentContext(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.executeDesign, session.workspace, readActionContext]);

  const handleTaskConfirmation = useCallback((params: Record<string, string>) => {
    setNewTaskNotice(false);
    const labels: Record<string, string> = {
      insertSequence: "Insert sequence",
      insertName: "Insert name",
      vectorSequence: "Vector sequence",
      insertionAnchorLabel: "Insertion position",
      insertionAnchorSide: "Relative position",
      expressionStrategy: "Expression strategy",
      removeUpstreamStop: "Remove upstream stop codon",
      leftHomology: "Left homology arm",
      rightHomology: "Right homology arm",
      forwardSite: "Forward restriction site",
      reverseSite: "Reverse restriction site",
    };
    const visible = Object.entries(params).map(([key, value]) => {
      const label = labels[key] ?? key;
      const isSequence = /sequence|homology/i.test(key);
      const detail = isSequence
        ? `${value.replace(/[^A-Za-z]/g, "").length.toLocaleString()} bp`
        : value === "true"
          ? "confirmed"
          : value;
      return `${label}: ${detail}`;
    }).join("; ");
    setFollowLatest(true);
    setShowOlderMessages(false);
    const current = readActionContext();
    const agentSelection = selectionForAgentContext(current);
    session.sendMessage(
      "Continue the current molecular design task with these structured inputs.",
      current.document,
      session.workspace,
      agentSelection,
      undefined,
      visible,
      params,
    );
  }, [readActionContext, session]);

  const isBusy = session.phase !== "idle" || session.validationStatus === "running";
  const isOnline = session.serviceStatus === "online";
  const showOffline = session.serviceStatus === "offline";
  const showStarting = session.serviceStatus === "starting" || session.serviceStatus === "checking";

  const handleNewTask = useCallback(() => {
    if (isBusy) return;
    session.clearSession();
    setShowOlderMessages(false);
    setFollowLatest(true);
    setPendingAttachment(null);
    setAttachmentError(null);
    setComposerResetSignal((signal) => signal + 1);
    setNewTaskNotice(true);
  }, [isBusy, session]);

  const hasGoal = session.lastUserGoal.length > 0;
  const isContextChangeNotice = (message: { role: string; content: string }) =>
    message.role === "assistant" && message.content.startsWith("[Context changed");
  const seenMessageKeysRef = useRef<Set<string>>(new Set());
  const [streamingMessageKey, setStreamingMessageKey] = useState<string | null>(null);
  const messageKeyFor = (message: { role: string; content: string }, index: number) =>
    `${index}:${message.role}:${message.content}`;
  useEffect(() => {
    if (session.messages.length === 0) {
      seenMessageKeysRef.current.clear();
      setStreamingMessageKey(null);
      return;
    }
    const currentKeys = new Set(
      session.messages.map((message, index) => messageKeyFor(message, index)),
    );
    const previouslySeen = seenMessageKeysRef.current.size > 0;
    const newlyArrivedAssistant = [...session.messages]
      .map((message, index) => ({ message, key: messageKeyFor(message, index) }))
      .reverse()
      .find(({ message, key }) => message.role === "assistant" && !seenMessageKeysRef.current.has(key));
    if (previouslySeen && newlyArrivedAssistant) {
      setStreamingMessageKey(newlyArrivedAssistant.key);
    }
    seenMessageKeysRef.current = currentKeys;
    if (streamingMessageKey && !currentKeys.has(streamingMessageKey)) {
      setStreamingMessageKey(null);
    }
  }, [session.messages, streamingMessageKey]);
  const meaningfulMessages = session.messages.filter((message) => !isContextChangeNotice(message));
  const hasContextChangeNotice = session.messages.some(isContextChangeNotice);
  const hasMeaningfulConversation = meaningfulMessages.some((message) => message.role === "user");
  const hasActivity =
    meaningfulMessages.length > 0 ||
    session.plan.length > 0 ||
    session.runLog.length > 0 ||
    session.recommendation !== null ||
    session.candidates.length > 0 ||
    session.resultCount !== null;

  // Derive task-node statuses from structured state only
  const planningStatus = derivePlanningStatus(session.phase, session.plan);
  const toolStatus = deriveToolStatus(session.phase, session.runLog);
  const resultStatus = deriveResultStatus(
    session.phase,
    session.recommendation,
    session.candidates,
    session.resultCount,
    session.agentRun.runId,
  );
  const activeTool = session.runLog.reduce(
    (current, row) => row.status === "running" ? (row.tool || row.step) : current,
    "",
  );

  // Replan events (P2 ReAct-lite loop): the backend appends a synthetic
  // ``llm_planner`` runLog row right after the step that failed.  Surface it
  // as a dedicated badge in both the tool worklog and the timeline, carrying
  // the original failure reason so the user understands why the LLM re-planned.
  const replanEvents = useMemo(() => {
    const byRow = new Map<RunLogRow, {
      failedTool: string;
      failedStep: string;
      failedMessage: string;
    }>();
    for (let index = 0; index < session.runLog.length; index += 1) {
      const row = session.runLog[index];
      if (!row || row.tool !== "llm_planner") continue;
      // Walk backwards to the nearest failed/error row as the failure cause.
      let failed: RunLogRow | null = null;
      for (let back = index - 1; back >= 0; back -= 1) {
        const candidate = session.runLog[back];
        if (!candidate) break;
        if (candidate.status === "failed" || candidate.status === "error") {
          failed = candidate;
          break;
        }
      }
      byRow.set(row, {
        failedTool: failed?.tool ?? "",
        failedStep: failed?.step ?? "",
        failedMessage: failed?.message ?? "",
      });
    }
    return byRow;
  }, [session.runLog]);
  const displayWorkspace = inferWorkspaceFromGoal(session.lastUserGoal, session.workspace);
  const taskTypeLabel = workspaceDisplayLabel(displayWorkspace);
  const taskTypePending = session.phase === "planning";
  const hiddenMessageCount = Math.max(0, meaningfulMessages.length - 4);
  const visibleMessages = showOlderMessages
    ? meaningfulMessages
    : meaningfulMessages.slice(-4);
  const hasCompletedResult =
    session.recommendation !== null ||
    session.candidates.length > 0 ||
    (session.resultCount !== null && session.resultCount > 0) ||
    Boolean(
      session.agentRun.runId &&
      ["completed", "success"].includes(session.agentRun.status ?? ""),
    );
  const confirmation = session.taskConfirmation;
  const hasBlockingInputs = Boolean(
    confirmation && (
      confirmation.blockers.length > 0 ||
      confirmation.missingParameters.length > 0
    ),
  );
  const hasConfirmationNotes = Boolean(
    confirmation && (
      confirmation.assumptions.length > 0 ||
      confirmation.warnings.length > 0
    ),
  );
  const headerTaskState = newTaskNotice
    ? "已创建新任务"
    : !isOnline
    ? showStarting ? "连接中" : "离线"
    : session.phase === "planning"
      ? "正在规划"
      : session.phase === "executing"
        ? "运行工具中"
        : session.validationStatus === "running"
          ? "验证中"
          : pendingPreview
            ? "审阅更改"
            : hasBlockingInputs
              ? "等待输入"
              : hasCompletedResult
                ? "结果就绪"
                : hasGoal
                  ? "可继续"
                  : "新任务";
  const headerDiagnostics = [
    session.healthLabel,
    session.agentRun.runId ? `Run ${session.agentRun.runId}` : null,
  ].filter(Boolean).join(" · ");

  // Plan provenance badge (design doc §6.3): shows which track planned the
  // execution and whether the LLM planner fell back to the rules pipeline.
  const planBadge = (() => {
    const provenance = session.planProvenance;
    if (!provenance || !provenance.source) return null;
    if (provenance.source === "llm") {
      return {
        className: "agent-planned-by agent-planned-by--llm",
        label: "LLM 规划",
        title: "由大模型基于工具注册表规划多步执行",
      };
    }
    if (provenance.errors.length > 0) {
      return {
        className: "agent-planned-by agent-planned-by--fallback",
        label: "已回退规则规划",
        title: `LLM 规划未通过校验，已回退规则管线：${provenance.errors.join("；")}`,
      };
    }
    return {
      className: "agent-planned-by agent-planned-by--rules",
      label: "规则规划",
      title: "由确定性规则管线规划（resolve → design → verify）",
    };
  })();

  const panelClasses = [
    "agent-panel",
    collapsed && "agent-panel--collapsed",
    hideCollapsedRail && "agent-panel--rail-hidden",
    wide && "agent-panel--wide",
    !hasGoal && !hasActivity && "agent-panel--welcome",
  ]
    .filter(Boolean)
    .join(" ");

  const panelStyle = panelWidth && !collapsed && !wide ? { width: `${panelWidth}px` } : undefined;
  const setPanelCollapsed = (nextCollapsed: boolean) => {
    if (open === undefined) setUncontrolledCollapsed(nextCollapsed);
    onOpenChange?.(!nextCollapsed);
  };

  return (
    <aside id={id} className={panelClasses} style={panelStyle} aria-label="GeneCode Agent">
      {/* Drag-to-resize handle */}
      {!collapsed && (
        <div
          className="agent-panel__resize-handle"
          onMouseDown={handleResizeStart}
          title="Drag to resize"
          role="separator"
          tabIndex={0}
          aria-label="调整 Agent 面板宽度"
          aria-orientation="vertical"
          aria-valuemin={360}
          aria-valuemax={800}
          aria-valuenow={Math.max(360, panelWidth ?? 420)}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            setWide(false);
            const measured = event.currentTarget.parentElement?.getBoundingClientRect().width;
            const current = measured || panelWidth || 420;
            const next = event.key === "Home" ? 360 : event.key === "End" ? 800
              : Math.max(360, Math.min(800, current + (event.key === "ArrowLeft" ? 40 : -40)));
            setPanelWidth(next);
            window.localStorage.setItem(AGENT_PANEL_WIDTH_STORAGE_KEY, String(next));
          }}
        />
      )}
      <div className="agent-header">
        {!collapsed && (
          <div className="agent-header__left">
            <div className="agent-header__identity">
              <span className="agent-header__title">GeneCode Agent</span>
              <span className={`agent-header__status agent-header__status--${headerStatusTone(headerTaskState, session.serviceStatus)}`}>
                <StatusDot status={session.serviceStatus} />
                <span className="agent-header__status-label" title={headerDiagnostics}>
                  {headerTaskState}
                </span>
              </span>
              {planBadge && (
                <span className={planBadge.className} title={planBadge.title}>
                  {planBadge.label}
                </span>
              )}
            </div>
          </div>
        )}
        <div className="agent-header__right">
          {!collapsed && (
            <button
              type="button"
              className="agent-btn agent-btn--icon"
              onClick={handleNewTask}
              title="新任务"
              aria-label="新任务"
              disabled={isBusy}
            >
              <SquarePen aria-hidden="true" />
            </button>
          )}
          {!collapsed && (
            <button
              type="button"
              className={`agent-btn agent-btn--icon agent-history-trigger${conversationHistoryOpen ? " is-active" : ""}`}
              onClick={() => setConversationHistoryOpen((current) => !current)}
              title="历史对话"
              aria-label="历史对话"
              aria-pressed={conversationHistoryOpen}
            >
              <History aria-hidden="true" />
              {conversationHistoryCount > 0 && (
                <span className="agent-history-trigger__count" aria-label={`${conversationHistoryCount} 个历史对话`}>
                  {conversationHistoryCount > 99 ? "99+" : conversationHistoryCount}
                </span>
              )}
            </button>
          )}
          {!collapsed && (
            <button
              type="button"
              className="agent-btn agent-focus-toggle"
              onClick={() => setWide(!wide)}
              title={wide ? "与序列工作区并排显示" : "展开为专注对话视图"}
              aria-label={wide ? "序列并排" : "专注对话"}
            >
              {wide ? <Columns2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
              <span>{wide ? "序列并排" : "专注对话"}</span>
            </button>
          )}
          <button
            className="agent-toggle"
            onClick={() => setPanelCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand GeneCode Agent panel" : hideCollapsedRail ? "Close GeneCode Agent" : "Collapse GeneCode Agent panel"}
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            title={collapsed ? "Expand" : hideCollapsedRail ? "Close" : "Collapse"}
          >
            {collapsed
              ? <ChevronLeft aria-hidden="true" />
              : hideCollapsedRail
                ? <X aria-hidden="true" />
                : <ChevronRight aria-hidden="true" />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="agent-body" id={bodyId}>
          {/* Offline state */}
          {showOffline && (
            <OfflineState
              healthLabel={session.healthLabel}
              onRetry={session.checkHealth}
            />
          )}

          {showStarting && (
            <div className="agent-offline agent-offline--starting">
              <p>{session.healthLabel}</p>
            </div>
          )}

          {/* Online content */}
          {isOnline && (
            <>
              {conversationHistoryOpen && (
                <AgentConversationHistory
                  onClose={() => setConversationHistoryOpen(false)}
                  onContinue={(entry) => {
                    session.restoreConversation(entry);
                    setConversationHistoryOpen(false);
                    setShowOlderMessages(false);
                  }}
                />
              )}
              <div
                className="task-stream"
                ref={taskStreamRef}
                onScroll={(event) => {
                  const target = event.currentTarget;
                  const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 72;
                  setFollowLatest(nearBottom);
                }}
              >
                {hasContextChangeNotice && (hasGoal || hasMeaningfulConversation) && (
                  <p className="agent-context-update" role="status">
                    Sequence changed; the previous draft was cleared.
                  </p>
                )}

                {/* Starter cards when idle with no activity (P2 onboarding) */}
                {!hasGoal && !hasActivity && (
                  <div className="agent-welcome">
                    <div className="agent-welcome__identity" aria-label="GeneCode Agent 自我介绍">
                      <div className="agent-welcome__identity-copy">
                        <span className="agent-welcome__eyebrow">序列在手，想法开始。</span>
                        <div className="agent-welcome__greeting" role="heading" aria-level={2}>
                          从一个想法，到下一步设计。
                        </div>
                        <p className="agent-welcome__description">
                          描述你的目标，或从下方选择一个任务。
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {meaningfulMessages.length > 0 && (
                  <section
                    className="agent-conversation-history"
                    aria-label="当前对话"
                  >
                    <div className="agent-conversation-history__content">
                      {hiddenMessageCount > 0 && (
                        <button
                          type="button"
                          className="agent-history-toggle"
                          onClick={() => setShowOlderMessages((value) => !value)}
                        >
                          {showOlderMessages
                            ? "隐藏较早消息"
                            : `显示 ${hiddenMessageCount} 条较早消息`}
                        </button>
                      )}
                      {visibleMessages.map((msg, i) => {
                        const messageKey = messageKeyFor(msg, i);
                        return (
                        <div key={messageKey} className={`task-activity task-activity--${msg.role}`}>
                          <div className="task-activity__bubble">
                            <span className="task-activity__role">
                              {msg.role === "user" ? "你" : "GeneCode"}
                            </span>
                            <div className="task-activity__text">
                              <ProgressiveMessageText
                                content={msg.role === "user" ? presentGoal(msg.content) : msg.content}
                                animate={messageKey === streamingMessageKey}
                              />
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {hasGoal && !hasMeaningfulConversation && (
                  <section className="agent-conversation-history" aria-label="当前目标">
                    <div className="task-activity task-activity--user">
                      <div className="task-activity__text">{presentGoal(session.lastUserGoal)}</div>
                    </div>
                  </section>
                )}

                {!session.conversationOnly && hasGoal && (
                  <span className="agent-task-type" aria-label="检测到的任务类型">
                    {taskTypePending ? "正在识别任务…" : taskTypeLabel}
                  </span>
                )}

                {confirmation && (hasBlockingInputs || hasConfirmationNotes) && (
                  <TaskNodeRow
                    status={hasBlockingInputs ? "waiting" : "review"}
                    label={hasBlockingInputs ? "需要输入" : "审查提示"}
                    className={`agent-required-inputs-node${!hasBlockingInputs && confirmation.warnings.length === 0 ? " agent-required-inputs-node--notes" : ""}`}
                  >
                    <TaskConfirmationPanel
                      confirmation={confirmation}
                      onSubmit={handleTaskConfirmation}
                    />
                  </TaskNodeRow>
                )}

                {!session.conversationOnly && (session.plan.length > 0 || session.phase === "planning") && (
                  <details className="agent-disclosure agent-plan-disclosure" open={session.readyToExecute && !hasCompletedResult ? true : undefined}>
                  <summary>{session.plan.length > 0 ? "执行计划" : "正在整理计划"}{session.plan.length > 0 && <span>{session.plan.length} 个步骤</span>}<ChevronDown aria-hidden="true" /></summary>
                  <TaskNodeRow status={planningStatus} label="规划" className="agent-plan-node">
                    {session.plan.length === 0 && (
                      <span className="task-node__detail">正在根据序列上下文生成计划…</span>
                    )}
                    {session.plan.map((row, i) => {
                      const detailParts: string[] = [];
                      if (row.summary) detailParts.push(row.summary);
                      return (
                        <TaskNodeRow
                          key={i}
                          status={mapPlanRowStatus(row.status)}
                          label={row.label || `Step ${i + 1}`}
                          detail={detailParts.length > 0 ? detailParts.join(" · ") : undefined}
                        />
                      );
                    })}
                  </TaskNodeRow>
                  </details>
                )}

                {/* Live Step flow — stream the same normalized graph as a
                    chat-like activity feed instead of a second task card. */}
                {(stepGraph.nodes.length > 0 || isBusy) && (
                  <AgentStepFlow
                    graph={stepGraph}
                    phase={session.phase}
                    validationStatus={session.validationStatus}
                    runLog={session.runLog}
                    timeline={session.timeline}
                    isBusy={isBusy}
                    hasCompletedResult={hasCompletedResult}
                    error={session.error}
                    onNodeClick={handleStepNodeClick}
                    clickableNodeIds={clickableNodeIds}
                    nodeTooltips={nodeTooltips}
                  />
                )}

                {session.readyToExecute && session.draft && (
                  <TaskNodeRow status="active" label="下一步" className="agent-next-action-node">
                    {session.agentMode !== "review" ? (
                      session.agentMode === "auto" ? (
                        session.error ? (
                          /* Auto-execution failed; let the user retry manually. */
                          <button
                            type="button"
                            className="agent-btn agent-btn--primary agent-next-action"
                            onClick={handleExecute}
                            disabled={session.phase !== "idle"}
                          >
                            重试执行
                          </button>
                        ) : (
                          /* Auto mode executes the ready plan immediately — no
                             confirmation click needed (zero-interaction flow). */
                          <span className="task-node__detail agent-auto-run-note">
                            自动模式：计划已就绪，正在执行…
                          </span>
                        )
                      ) : (
                        <button
                          type="button"
                          className="agent-btn agent-btn--primary agent-next-action"
                          onClick={handleExecute}
                          disabled={session.phase !== "idle"}
                        >
                          {session.workspace === "cloning"
                            ? "确认计划并生成预览"
                            : "执行分子设计"}
                        </button>
                      )
                    ) : (
                      <span className="task-node__detail">
                        已完成审阅。切换到引导或自动模式后，才能执行设计工具。
                      </span>
                    )}
                  </TaskNodeRow>
                )}


                {/* Tool execution nodes from run log */}
                {(session.phase === "executing" || session.runLog.length > 0 || session.timeline.length > 0) && (
                  <TaskNodeRow status={toolStatus} label="工具执行" className="agent-tool-node">
                    {session.runLog.length === 0 && session.timeline.length === 0 && session.phase === "executing" && (
                      <span className="task-node__detail">正在执行工具…</span>
                    )}
                    {(session.runLog.length > 0 || session.timeline.length > 0) && (
                      <details
                        className="agent-worklog agent-worklog--tools"
                        open={session.phase === "executing" ? true : undefined}
                      >
                        <summary>
                          工具活动
                          <span>{session.runLog.length || session.timeline.length} event(s)</span>
                        </summary>
                        <div className="agent-worklog__content">
                          {session.runLog.map((row, i) => {
                            if (row.tool === "llm_planner") {
                              const event = replanEvents.get(row);
                              const failedLabel = event?.failedStep || event?.failedTool || "";
                              return (
                                <div key={`log-${i}`} className="agent-replan" role="status">
                                  <span className="agent-replan__badge">LLM 重新规划</span>
                                  <span className="agent-replan__detail">
                                    {row.message || "LLM 已自动重新规划剩余步骤。"}
                                  </span>
                                  {failedLabel && (
                                    <span className="agent-replan__reason">
                                      失败步骤「{failedLabel}」：{event!.failedMessage || "未知原因"}
                                    </span>
                                  )}
                                </div>
                              );
                            }
                            return (
                              <RunLogDetailRow key={`log-${i}`} row={row} />
                            );
                          })}
                          {(session.timeline.length > 0 || replanEvents.size > 0) && (
                            <div className="agent-timeline">
                              {[...replanEvents.values()].map((event, index) => {
                                const failedLabel = event.failedStep || event.failedTool || "";
                                return (
                                  <div key={`replan-timeline-${index}`} className="agent-timeline__event agent-timeline__event--replan">
                                    <span className="agent-timeline__dot agent-timeline__dot--warning" />
                                    <span className="agent-timeline__summary">
                                      LLM 重新规划
                                      {failedLabel
                                        ? `：步骤「${failedLabel}」失败后已自动调整剩余计划`
                                        : "：失败后已自动调整剩余计划"}
                                    </span>
                                  </div>
                                );
                              })}
                              {session.timeline.map((evt) => (
                                <div key={evt.event_id || evt.type} className="agent-timeline__event">
                                  <span className={`agent-timeline__dot agent-timeline__dot--${evt.status || "ok"}`} />
                                  <span className="agent-timeline__summary">{evt.summary}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </details>
                    )}
                  </TaskNodeRow>
                )}

                {/* Results node */}
                {hasCompletedResult && (
                  <TaskNodeRow status={resultStatus} label="结果" className="agent-results-node">
                    {/* A-AGT-002: never claim validity when verification was
                        degraded/skipped or execution failed. */}
                    {session.claimLevel === "unvalidated" && (
                      <div className="agent-claim-banner agent-claim-banner--unvalidated" role="alert">
                        <span className="agent-claim-banner__title">结果未经验证</span>
                        <span className="agent-claim-banner__detail">
                          自动验证未完成（降级或跳过），此结果不应直接用于实验设计，请人工复核后再使用。
                        </span>
                      </div>
                    )}
                    {session.claimLevel === "failed" && (
                      <div className="agent-claim-banner agent-claim-banner--failed" role="alert">
                        <span className="agent-claim-banner__title">执行失败</span>
                        <span className="agent-claim-banner__detail">
                          设计工具未完成执行，当前结果不可用，请重新规划后重试。
                        </span>
                      </div>
                    )}
                    {session.recommendation && (
                      <div className="agent-recommendation">
                        <div className="agent-recommendation__title">
                          {session.recommendation.title}
                        </div>
                        {session.recommendation.summary && (
                          <div className="agent-recommendation__summary">
                            {session.recommendation.summary}
                          </div>
                        )}
                        {session.recommendation.risks.length > 0 && (
                          <ul className="agent-recommendation__risks">
                            {session.recommendation.risks.map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                        )}
                        {session.recommendation.confidence !== null && (
                          <div
                            className={`agent-recommendation__confidence${
                              session.recommendation.confidence >= 80
                                ? " agent-recommendation__confidence--high"
                                : session.recommendation.confidence >= 50
                                  ? " agent-recommendation__confidence--mid"
                                  : " agent-recommendation__confidence--low"
                            }`}
                          >
                            <span className="agent-recommendation__confidence-track" aria-hidden="true">
                              <span
                                style={{ width: `${Math.max(4, Math.min(100, session.recommendation.confidence))}%` }}
                              />
                            </span>
                            <span title="规划器给出的推荐置信度，不代表实验成功率">推荐置信度 {session.recommendation.confidence}%</span>
                          </div>
                        )}
                      </div>
                    )}
                    {autoArchivedRun && autoArchivedRun.runId === session.agentRun.runId && (
                      <div className="agent-auto-archive" role="status">
                        <span className="agent-auto-archive__badge"><Check aria-hidden="true" />已归档，未改动序列</span>
                        <button
                          type="button"
                          className="agent-btn agent-btn--secondary agent-auto-archive__reload"
                          onClick={() => triggerCsvDownload(autoArchivedRun.filename, autoArchivedRun.csv)}
                          title={autoArchivedRun.filename}
                        >
                          <Download aria-hidden="true" />重新导出 CSV
                        </button>
                      </div>
                    )}
                    {session.candidates.length > 0 && (
                      <CandidateCards
                        candidates={session.candidates}
                        document={doc}
                        onAddFeature={onAddFeature}
                        focusedIndex={focusedCandidate?.index ?? null}
                        focusToken={focusedCandidate?.token ?? 0}
                      />
                    )}
                    {session.resultCount !== null && (
                      <div className="agent-result-count">
                        共生成 {session.resultCount} 个候选
                      </div>
                    )}
                    {session.artifactPackage && session.artifactPackage.artifacts.length > 0 && (
                      <details className="agent-artifacts agent-disclosure">
                        <summary>结果文件<span>{session.artifactPackage.artifacts.length} 个文件</span><ChevronDown aria-hidden="true" /></summary>
                        <div className="agent-artifacts__list">
                        {session.artifactPackage.artifacts.map((a) => (
                          <div key={a.artifact_id} className="agent-artifacts__item">
                            <span className="agent-artifacts__icon" aria-hidden="true">
                              <FileText />
                            </span>
                            <div className="agent-artifacts__body">
                              <span className="agent-artifacts__name">{a.title}</span>
                              <span className="agent-artifacts__meta">
                                <span className={`agent-artifacts__status agent-artifacts__status--${a.status}`} />
                                {a.filename}
                              </span>
                            </div>
                            <button
                              type="button"
                              className="agent-artifacts__download"
                              title={`下载 ${a.filename}`}
                              aria-label={`下载 ${a.filename}`}
                              onClick={() => {
                                let content: string;
                                let filename = a.filename || `${a.type}.json`;
                                if (a.type === "protocol_draft") {
                                  content = typeof a.data.summaryMarkdown === "string" ? a.data.summaryMarkdown : JSON.stringify(a.data, null, 2);
                                } else if ((a.type === "candidate_table" || a.type === "ordering_table") && Array.isArray(a.data.candidates ?? a.data.items)) {
                                  content = buildArtifactCsv(a.data);
                                  filename = filename.replace(/\.json$/, ".csv");
                                } else {
                                  content = JSON.stringify(a.data, null, 2);
                                }
                                const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
                                const url = URL.createObjectURL(blob);
                                const el = document.createElement("a");
                                el.href = url;
                                el.download = filename;
                                el.click();
                                URL.revokeObjectURL(url);
                              }}
                            >
                              <Download aria-hidden="true" />
                              <span>下载</span>
                            </button>
                          </div>
                        ))}
                        </div>
                        {session.artifactPackage.summaryMarkdown && (
                          <CopyActionButton
                            label="复制结果摘要"
                            getText={() => session.artifactPackage!.summaryMarkdown}
                          />
                        )}
                      </details>
                    )}
                    <div className="agent-result-actions">
                    {(session.workspace === "rtqpcr" || session.workspace === "sgrna" || session.workspace === "sirna") && session.candidates.length > 0 && (
                      <div className="agent-validation">
                        <button
                          type="button"
                          className="agent-btn agent-btn--secondary"
                          onClick={session.validateResults}
                          disabled={session.validationStatus === "running" || isBusy}
                        >
                          {session.validationStatus === "running"
                            ? "正在进行远程验证…"
                            : session.workspace === "rtqpcr"
                              ? "检查 BLAST 特异性"
                              : "检查脱靶风险"}
                        </button>
                        {session.validationMessages.map((message, index) => (
                          <div key={`validation-message-${index}`} className="task-node__detail">{message}</div>
                        ))}
                        {session.validationResults.map((result, index) => {
                          const check = result.specificityCheck ?? result.genomeOfftargetCheck ?? result.transcriptomeOfftargetCheck;
                          if (typeof check === "object" && check !== null && !Array.isArray(check)) {
                            return (
                              <ValidationDetails
                                key={`validation-${index}`}
                                candidateLabel={`候选 ${index + 1}`}
                                check={check as Record<string, unknown>}
                              />
                            );
                          }
                          return (
                            <div key={`validation-${index}`} className="agent-validation__result">
                              候选 {index + 1}：{validationStatusLine(result)}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {session.agentRun.runId && (
                      <div
                        className={`agent-run-meta${session.agentRun.status === "failed" || session.agentRun.status === "error" ? " agent-run-meta--failed" : ""}`}
                      >
                        {session.agentRun.status === "failed" || session.agentRun.status === "error" ? (
                          <>
                            <span className="agent-run-meta__icon" aria-hidden="true">
                              <AlertTriangle />
                            </span>
                            <span>
                              Run {session.agentRun.runId}
                              {session.agentRun.status && ` — ${session.agentRun.status}`}
                            </span>
                            <button
                              type="button"
                              className="agent-run-meta__copy"
                              onClick={() => {
                                const note = buildRunNoteText({
                                  recommendation: session.recommendation,
                                  candidates: session.candidates,
                                  agentRun: session.agentRun,
                                });
                                void navigator.clipboard?.writeText(note).catch(() => {});
                              }}
                            >
                              复制记录
                            </button>
                          </>
                        ) : (
                          <span>
                            Run {session.agentRun.runId}
                            {session.agentRun.status && ` — ${session.agentRun.status}`}
                          </span>
                        )}
                      </div>
                    )}
                    {(session.recommendation ||
                      session.candidates.length > 0 ||
                      session.agentRun.runId) && (
                      <CopyActionButton
                        label="复制运行记录"
                        getText={() =>
                          buildRunNoteText({
                            recommendation: session.recommendation,
                            candidates: session.candidates,
                            agentRun: session.agentRun,
                          })
                        }
                      />
                    )}
                    </div>
                  </TaskNodeRow>
                )}

                {/* Completed runs stay out of the task stream until one exists. */}
                {conversationHistoryOpen && (historyCount > 0 || backendHistoryCount > 0 || session.serviceStatus === "online") && (
                  <details className="agent-worklog agent-history-node" open>
                    <summary>
                      最近运行
                      <span>{Math.max(historyCount, backendHistoryCount)}</span>
                    </summary>
                    <div className="agent-worklog__content">
                      <RunHistoryPanel
                        onRestore={(entry) => session.restoreFromHistory(entry)}
                        onBackendCount={setBackendHistoryCount}
                      />
                    </div>
                  </details>
                )}

                {/* Error */}
                {session.error && (
                  <div className="agent-error" role="alert">
                    <span className="agent-error__icon" aria-hidden="true">
                      <AlertTriangle />
                    </span>
                    <div className="agent-error__content">
                      <strong>运行失败</strong>
                      <span className="agent-error__message">{session.error}</span>
                    </div>
                    <div className="agent-error__actions">
                      {!(session.readyToExecute && session.draft) && (
                        <button
                          type="button"
                          className="agent-btn agent-btn--primary agent-error__action"
                          onClick={handleExecute}
                          disabled={session.phase !== "idle"}
                        >
                          重试运行
                        </button>
                      )}
                      <button
                        type="button"
                        className="agent-btn agent-btn--secondary agent-error__action"
                        onClick={handleNewTask}
                      >
                        新任务
                      </button>
                      <button
                        type="button"
                        className="agent-btn agent-btn--icon"
                        onClick={session.clearError}
                        title="忽略"
                        aria-label="忽略错误"
                      >
                        <X aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Review node — pending patch preview */}
                {pendingPreview && (
                  <TaskNodeRow status="review" label="审阅补丁" className="agent-review-node">
                    <PatchPreviewPanel
                      preview={pendingPreview}
                      warningsAcknowledged={warningsAcknowledged}
                      onAcknowledgeWarnings={setWarningsAcknowledged}
                      onApply={onApply}
                      onApplyAsNewFile={onApplyAsNewFile}
                      onReject={onReject}
                      revealedCount={diffRevealCount}
                      focusedOperationId={focusedOperationId}
                    />
                  </TaskNodeRow>
                )}

                {/* Revert node */}
                {!pendingPreview && revertDocument && (
                  <TaskNodeRow status="done" label="补丁已应用" className="agent-revert-node">
                    <button
                      type="button"
                      className="agent-btn agent-btn--secondary"
                      onClick={onRevert}
                    >
                      撤销上一次 Agent 更改
                    </button>
                  </TaskNodeRow>
                )}

              </div>

              {!followLatest && (
                <button
                  type="button"
                  className="agent-jump-latest"
                  onClick={() => {
                    setFollowLatest(true);
                    const stream = taskStreamRef.current;
                    if (stream) stream.scrollTop = stream.scrollHeight;
                  }}
                >
                  <ArrowDown aria-hidden="true" />
                  最新
                </button>
              )}

              {isBusy && (
                <AgentWorkingIndicator
                  phase={session.phase}
                  validationRunning={session.validationStatus === "running"}
                  activeTool={activeTool}
                />
              )}

            </>
          )}

          <div className="agent-input-dock">
            {/* Keep the composer visible while offline so the Agent entry point never disappears. */}
            <InputComposer
              mode={session.agentMode as AgentMode}
              controls={<AgentModeSelector mode={session.agentMode as AgentMode} busy={isBusy} available={isOnline} onChange={session.setAgentMode} />}
              context={doc && doc.sequence.length > 0 ? (
                <div className="agent-composer__context" aria-label="序列信息">
                  <button type="button" onClick={() => setPanelCollapsed(true)} title="在序列工作区查看" className="agent-context-file">
                    <FileText aria-hidden="true" /><span>{doc.name}</span><small>{doc.sequence.length.toLocaleString()} bp · {doc.circular ? "环状" : "线性"}</small>
                  </button>
                  {selection && <span className="agent-context-selection">{selection.wrapsOrigin
                    ? `选区 ${selection.start + 1}–${doc.sequence.length} / 1–${selection.end} · ${selection.length.toLocaleString()} bp · 跨越起点`
                    : `选区 ${selection.start + 1}–${selection.end} · ${selection.length.toLocaleString()} bp`}</span>}
                </div>
              ) : <div className="agent-composer__context"><span className="agent-context-selection">{doc ? "无序列" : "无文档"} · 可直接描述目标或添加序列文件</span></div>}
              busy={isBusy}
              available={isOnline}
              resetSignal={composerResetSignal}
              placeholder={isOnline
                ? MODE_PLACEHOLDERS[session.agentMode as AgentMode]
                : "Agent 服务离线。请先写消息，再重试连接…"}
              onSend={handleSend}
              onCancel={session.cancelRequest}
              attachment={pendingAttachment
                ? {
                    name: pendingAttachment.name,
                    detail: `${pendingAttachment.sequence.length.toLocaleString()} bp · ${pendingAttachment.circular ? "环状" : "线性"} · ${pendingAttachment.features.length} 个特征`,
                  }
                : null}
              attaching={attachmentLoading}
              attachmentError={attachmentError}
              onAttach={handleAttachSequence}
              onRemoveAttachment={() => {
                setPendingAttachment(null);
                setAttachmentError(null);
              }}
            />
            {!hasGoal && !hasActivity && isOnline && (
              <div className="agent-starter-grid" aria-label="新建分子设计">
                {UNIFIED_TASK_STARTERS.map((task) => (
                  <button key={task.label} type="button" className="agent-starter-card"
                    aria-label={task.label} onClick={() => handleStarterSend(task)} disabled={isBusy}>
                    {workspaceDisplayLabel(task.workspace)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

export default AgentPanel;
