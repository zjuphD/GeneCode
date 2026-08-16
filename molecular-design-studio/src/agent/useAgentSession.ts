/**
 * Agent session hook — owns conversation, plan, draft, execution, and result state.
 *
 * Rules:
 * - Health check runs once on mount and can be retried manually
 * - Sending appends user message immediately
 * - A successful plan appends normalized assistant messages
 * - Execution requires a valid draft, readyToExecute; in plan/review modes an
 *   explicit click is required, while in auto mode a freshly-arrived ready
 *   plan executes immediately (zero-interaction auto flow)
 * - Abort or ignore late responses after unmount
 * - Context invalidation clears draft/plan/results when document hash changes
 * - A monotonic generation token guards against late responses restoring stale state
 */

import { useState, useCallback, useRef, useEffect } from "react";
import type { SequenceDocument, SequenceSelection } from "../types";
import type { AgentResponse, AgentHealth, PlanRow, RunLogRow, AgentRecommendation, AgentRunMeta, ResultCandidate, TimelineEvent, AgentArtifactPackage, TaskConfirmation, PlanProvenance } from "./responseTypes";
import { buildRunHistoryEntry, saveRunHistoryEntry, type RunHistoryEntry } from "./runHistory";
import {
  buildConversationHistoryEntry,
  saveConversationHistoryEntry,
  type AgentConversationHistoryEntry,
  type AgentConversationMessage,
} from "./conversationHistory";
import {
  checkAgentHealth,
  planAgentTask,
  executeAgentTaskStream,
  cancelAgentTask,
  buildDocumentSnapshot,
  AgentServiceError,
  type AgentChatRequest,
  type AgentExecuteRequest,
  type AgentStructuredInputs,
  type AgentWorkspace,
  type AgentMode,
  type AgentSequenceAttachment,
} from "./service";
import { ensureLocalAgentService } from "./launcher";
import { fingerprintDocument } from "./fingerprint";
import {
  clearPersistedAgentSession,
  loadAgentSession,
  saveAgentSession,
} from "./sessionPersistence";
// ── Types ────────────────────────────────────────────────────

export type ServiceStatus = "starting" | "checking" | "online" | "offline";
export type RequestPhase = "idle" | "planning" | "executing";
export type ValidationStatus = "idle" | "running" | "completed" | "error";

/**
 * A-AGT-002: what the design may truthfully be claimed to be.
 * - "validated":   the verification gate completed and passed.
 * - "unvalidated": verification was degraded or skipped — never claim valid.
 * - "failed":      execution itself errored.
 * null means no execute has completed yet in this session.
 */
export type ClaimLevel = "validated" | "unvalidated" | "failed";

function claimLevelFromMeta(meta: Record<string, unknown> | undefined | null): ClaimLevel | null {
  if (!meta || typeof meta !== "object") return null;
  const explicit = meta.claimLevel;
  if (explicit === "validated" || explicit === "unvalidated" || explicit === "failed") {
    return explicit;
  }
  // Fallback derivation for older backends that only emit verificationStatus.
  const verificationStatus = meta.verificationStatus;
  if (verificationStatus === "completed") return "validated";
  if (verificationStatus === "degraded" || verificationStatus === "skipped") return "unvalidated";
  if (meta.executionStatus === "failed" || meta.runStatus === "cancelled") return "failed";
  return null;
}

/**
 * Build a runLog row from an SSE step event, carrying the per-step detail
 * (compact args, result summary, duration) that the backend attaches to
 * step_start / step_done for the detail panel (design doc §9.4).
 */
function runLogRowFromEvent(data: unknown): Omit<RunLogRow, "status"> {
  const record = (typeof data === "object" && data !== null)
    ? data as Record<string, unknown>
    : {};
  const tool = String(record.tool ?? "");
  const step = String(record.label ?? record.step ?? (tool || "Tool"));
  const message = String(record.summary ?? "");
  const args = (typeof record.args === "object" && record.args !== null && !Array.isArray(record.args))
    ? record.args as Record<string, unknown>
    : undefined;
  const result = (typeof record.result === "object" && record.result !== null && !Array.isArray(record.result))
    ? record.result as Record<string, unknown>
    : undefined;
  const durationMs = typeof record.durationMs === "number" && Number.isFinite(record.durationMs)
    ? record.durationMs
    : undefined;
  return {
    step,
    tool,
    message,
    ...(args !== undefined ? { args } : {}),
    ...(result !== undefined ? { result } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  /** Full local context sent back to the Agent, kept out of the visible chat. */
  requestContent?: string;
}

function createConversationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `conv_${crypto.randomUUID()}`;
  }
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export interface AgentSessionState {
  serviceStatus: ServiceStatus;
  healthLabel: string;
  messages: ConversationMessage[];
  plan: PlanRow[];
  draft: Record<string, unknown> | null;
  readyToExecute: boolean;
  runLog: RunLogRow[];
  timeline: TimelineEvent[];
  recommendation: AgentRecommendation | null;
  artifactPackage: AgentArtifactPackage | null;
  taskConfirmation: TaskConfirmation | null;
  resultCount: number | null;
  candidates: ResultCandidate[];
  agentRun: AgentRunMeta;
  workspace: AgentWorkspace;
  phase: RequestPhase;
  error: string | null;
  lastUserGoal: string;
  sequencePatch: unknown;
  /** Document hash captured at plan time — used to detect stale execute. */
  planSnapshotHash: string | null;
  /** Agent behavior mode: review (read-only), plan (confirm+execute), auto (auto-execute low-risk). */
  agentMode: AgentMode;
  validationStatus: ValidationStatus;
  validationMessages: string[];
  validationResults: Array<Record<string, unknown>>;
  conversationOnly: boolean;
  /** Which track planned the execution (llm / rules) — null until an execute ran. */
  planProvenance: PlanProvenance | null;
  /** What the last completed execute may truthfully claim (A-AGT-002). */
  claimLevel: ClaimLevel | null;
}

export interface AgentSessionActions {
  checkHealth: () => void;
  sendMessage: (
    message: string,
    doc: SequenceDocument | null,
    workspace?: AgentWorkspace,
    selection?: SequenceSelection | null,
    attachment?: AgentSequenceAttachment,
    displayMessage?: string,
    structuredInputs?: AgentStructuredInputs,
  ) => void;
  cancelRequest: () => void;
  setAgentMode: (mode: AgentMode) => void;
  executeDesign: (doc: SequenceDocument | null, workspace?: AgentWorkspace, selection?: SequenceSelection | null) => void;
  validateResults: () => void;
  clearSession: () => void;
  clearError: () => void;
  restoreFromHistory: (entry: RunHistoryEntry) => void;
  /** Restore a visible conversation so the user can continue it. */
  restoreConversation: (entry: AgentConversationHistoryEntry) => void;
  onDocumentHashChange: (hash: string | null) => void;
  /** Callback to hand a service patch to the TASK-005 validation boundary. */
  onSequencePatchReceived: ((patch: unknown) => void) | null;
  setOnSequencePatchReceived: (fn: ((patch: unknown) => void) | null) => void;
}

// ── Draft merging for cross-turn slot memory ──────────────────

/**
 * Merge a new draft response into an existing draft, preserving slot values
 * from earlier turns that the user already provided.
 *
 * Rules:
 * - Top-level scalar fields (workspace, designType, mode) always use the new value.
 * - Nested objects (designPayload, resolvePayload, confirmations, scanPayload)
 *   are merged: new values win, but old values survive when the new value is
 *   absent/null/undefined.
 * - This prevents the user from having to repeat slot values across messages.
 */
function mergeDrafts(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...prev };

  // Top-level scalars: always use new value
  for (const key of ["workspace", "designType", "mode", "summary"]) {
    if (key in next) merged[key] = next[key];
  }

  // Nested objects: merge preserving existing values
  for (const key of ["designPayload", "resolvePayload", "confirmations", "scanPayload", "suggestedPair"]) {
    const prevObj = prev[key];
    const nextObj = next[key];
    if (nextObj && typeof nextObj === "object" && !Array.isArray(nextObj)) {
      merged[key] = {
        ...(prevObj && typeof prevObj === "object" && !Array.isArray(prevObj) ? prevObj : {}),
        ...nextObj,
      };
    }
    // If nextObj is null/undefined, keep the previous value
  }

  return merged;
}

function structuredInputsContext(
  message: string,
  values: AgentStructuredInputs,
): string {
  const lines = [message];
  for (const [key, value] of Object.entries(values)) {
    if (value === "" || value === null || value === undefined) continue;
    if (key === "insertSequence") lines.push(`insert sequence: ${String(value)}`);
    else if (key === "vectorSequence") lines.push(`vector sequence: ${String(value)}`);
    else if (key === "insertionAnchorLabel") lines.push(`insertion anchor: ${String(value)}`);
    else if (key === "insertionAnchorSide") lines.push(`insertion side: ${String(value)}`);
    else if (key === "expressionStrategy") lines.push(`expression strategy: ${String(value)}`);
    else if (key === "preserveReadingFrame") lines.push(`preserve reading frame: ${String(value)}`);
    else if (key === "removeUpstreamStop") lines.push(`remove upstream stop: ${String(value)}`);
    else lines.push(`${key}: ${String(value)}`);
  }
  return lines.join("\n");
}

// ── Hook ─────────────────────────────────────────────────────

export function useAgentSession(sessionKey?: string): AgentSessionState & AgentSessionActions {
  const [restoredSession] = useState(() => loadAgentSession(undefined, sessionKey));
  const conversationIdRef = useRef(restoredSession?.conversationId || createConversationId());
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>("checking");
  const [healthLabel, setHealthLabel] = useState("Checking…");
  const [messages, setMessages] = useState<ConversationMessage[]>(restoredSession?.messages ?? []);
  const [plan, setPlan] = useState<PlanRow[]>(restoredSession?.plan ?? []);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(restoredSession?.draft ?? null);
  const [readyToExecute, setReadyToExecute] = useState(restoredSession?.readyToExecute ?? false);
  const [runLog, setRunLog] = useState<RunLogRow[]>(restoredSession?.runLog ?? []);
  const [timeline, setTimeline] = useState<TimelineEvent[]>(restoredSession?.timeline ?? []);
  const [recommendation, setRecommendation] = useState<AgentRecommendation | null>(restoredSession?.recommendation ?? null);
  const [artifactPackage, setArtifactPackage] = useState<AgentArtifactPackage | null>(restoredSession?.artifactPackage ?? null);
  const [taskConfirmation, setTaskConfirmation] = useState<TaskConfirmation | null>(
    restoredSession?.taskConfirmation ?? null,
  );
  const [resultCount, setResultCount] = useState<number | null>(restoredSession?.resultCount ?? null);
  const [candidates, setCandidates] = useState<ResultCandidate[]>(restoredSession?.candidates ?? []);
  const [agentRun, setAgentRun] = useState<AgentRunMeta>(restoredSession?.agentRun ?? { runId: null, status: null });
  const [workspace, setWorkspace] = useState<AgentWorkspace>(restoredSession?.workspace ?? "cloning");
  const [phase, setPhase] = useState<RequestPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastUserGoal, setLastUserGoal] = useState(restoredSession?.lastUserGoal ?? "");
  const [sequencePatch, setSequencePatch] = useState<unknown>(undefined);
  const [planSnapshotHash, setPlanSnapshotHash] = useState<string | null>(restoredSession?.planSnapshotHash ?? null);
  const [agentMode, setAgentMode] = useState<AgentMode>(restoredSession?.agentMode ?? "plan");
  const [validationStatus, setValidationStatus] = useState<ValidationStatus>("idle");
  const [validationMessages, setValidationMessages] = useState<string[]>([]);
  const [validationResults, setValidationResults] = useState<Array<Record<string, unknown>>>([]);
  const [conversationOnly, setConversationOnly] = useState(false);
  const [planProvenance, setPlanProvenance] = useState<PlanProvenance | null>(
    restoredSession?.planProvenance ?? null,
  );
  const [claimLevel, setClaimLevel] = useState<ClaimLevel | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const lastHashRef = useRef<string | null>(restoredSession?.contextHash ?? null);
  const onSequencePatchReceivedRef = useRef<((patch: unknown) => void) | null>(null);

  // Monotonically increasing generation token.
  // A request captures the current token; success/failure handlers compare
  // their captured token against the ref before updating state. This prevents
  // late responses (after context invalidation or clearSession) from restoring
  // stale draft/plan/result state.
  const generationRef = useRef(0);

  // Refs for values captured in callbacks — avoids stale closures (H6-H8)
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const lastUserGoalRef = useRef(lastUserGoal);
  lastUserGoalRef.current = lastUserGoal;
  const agentRunRef = useRef(agentRun);
  agentRunRef.current = agentRun;
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const agentModeRef = useRef(agentMode);
  agentModeRef.current = agentMode;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const validationStatusRef = useRef(validationStatus);
  validationStatusRef.current = validationStatus;

  // Auto mode: the document/selection the plan was built from, captured at
  // sendMessage time so a ready plan can be executed without a user click.
  const lastSendDocRef = useRef<SequenceDocument | null>(null);
  const lastSendSelectionRef = useRef<SequenceSelection | null>(null);
  // Auto-execute is "armed" only by a fresh sendMessage (set true before the
  // plan request; a plan response consumes it by executing). Mount/restore
  // never arms it, so a restored readyToExecute session cannot auto-run, and
  // a failed execution (which keeps readyToExecute true) cannot restart the
  // run in a loop.
  const autoExecuteArmedRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      abortRef.current?.abort();
    };
  }, []);

  // Health check on mount
  useEffect(() => {
    performHealthCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh the provider label after settings changes or sidecar restarts.
  // A lightweight background check never interrupts an active Agent request.
  // A-OBS-001: exponential backoff polling (1s → 5s → 30s, bounded) with
  // self-scheduling timeouts, so an offline sidecar stops producing a steady
  // stream of connection-refused requests; success resets to the 30s cadence.
  useEffect(() => {
    const HEALTH_POLL_DELAYS = [1_000, 5_000, 30_000];
    const healthDelayRef = {
      current: HEALTH_POLL_DELAYS[HEALTH_POLL_DELAYS.length - 1]!,
    };
    let timerId: number | null = null;

    const scheduleNext = () => {
      if (!mountedRef.current) return;
      timerId = window.setTimeout(refreshHealth, healthDelayRef.current);
    };

    const refreshHealth = () => {
      if (
        !mountedRef.current ||
        phaseRef.current !== "idle" ||
        validationStatusRef.current === "running"
      ) {
        scheduleNext();
        return;
      }
      checkAgentHealth()
        .then((health) => {
          if (!mountedRef.current) return;
          healthDelayRef.current = HEALTH_POLL_DELAYS[HEALTH_POLL_DELAYS.length - 1]!;
          setServiceStatus(health.status);
          setHealthLabel(health.label);
        })
        .catch(() => {
          // Failure probe: a healthy 30s cadence drops to the 1s fast probe,
          // then walks 1s → 5s → 30s, so a transient outage is retried
          // quickly while a long outage settles at one request per 30s.
          const idx = HEALTH_POLL_DELAYS.indexOf(healthDelayRef.current);
          healthDelayRef.current =
            idx >= HEALTH_POLL_DELAYS.length - 1
              ? HEALTH_POLL_DELAYS[0]!
              : (HEALTH_POLL_DELAYS[idx + 1] ?? HEALTH_POLL_DELAYS[0]!);
        })
        .finally(() => {
          if (mountedRef.current) scheduleNext();
        });
    };

    // Kick off the recurring poll; the mount-time check lives in the separate
    // performHealthCheck effect.
    scheduleNext();

    const onWake = () => {
      if (document.visibilityState === "visible") {
        healthDelayRef.current = HEALTH_POLL_DELAYS[HEALTH_POLL_DELAYS.length - 1]!;
        if (timerId !== null) {
          window.clearTimeout(timerId);
          timerId = null;
        }
        refreshHealth();
      }
    };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      if (timerId !== null) window.clearTimeout(timerId);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, []);

  useEffect(() => {
    if (phase !== "idle") return;
    const hasSession =
      messages.length > 0 ||
      plan.length > 0 ||
      runLog.length > 0 ||
      candidates.length > 0 ||
      recommendation !== null ||
      lastUserGoal.length > 0;
    if (!hasSession) {
      clearPersistedAgentSession(undefined, sessionKey);
      return;
    }
    const conversationMessages: AgentConversationMessage[] = messages
      .filter((message) => message.content.trim())
      .map(({ role, content }) => ({ role, content }));
    if (conversationMessages.some((message) => message.role === "user")) {
      saveConversationHistoryEntry(
        buildConversationHistoryEntry({
          id: conversationIdRef.current,
          goal: lastUserGoal,
          workspace,
          agentMode,
          messages: conversationMessages,
          runId: agentRun.runId,
        }),
      );
    }
    saveAgentSession({
      version: 1,
      savedAt: Date.now(),
      conversationId: conversationIdRef.current,
      contextHash: lastHashRef.current ?? planSnapshotHash,
      messages: messages.slice(-80),
      plan,
      draft,
      readyToExecute,
      runLog,
      timeline: timeline.slice(-200),
      recommendation,
      artifactPackage,
      taskConfirmation,
      resultCount,
      candidates,
      agentRun,
      workspace,
      lastUserGoal,
      planSnapshotHash,
      agentMode,
      planProvenance,
    }, undefined, sessionKey);
  }, [
    phase,
    messages,
    plan,
    draft,
    readyToExecute,
    runLog,
    timeline,
    recommendation,
    artifactPackage,
    taskConfirmation,
    resultCount,
    candidates,
    agentRun,
    workspace,
    lastUserGoal,
    planSnapshotHash,
    agentMode,
    planProvenance,
    sessionKey,
  ]);

  const setOnSequencePatchReceived = useCallback((fn: ((patch: unknown) => void) | null) => {
    onSequencePatchReceivedRef.current = fn;
  }, []);

  /** Capture the current generation token for a new request. */
  function captureGeneration(): number {
    return generationRef.current;
  }

  /** Return true if the generation is still current. */
  function isGenerationCurrent(gen: number): boolean {
    return gen === generationRef.current;
  }

  /** Increment the generation, invalidating all in-flight requests. */
  function invalidateGeneration(): void {
    generationRef.current += 1;
  }

  function normalizeWorkspace(value: unknown): AgentWorkspace | null {
    if (
      value === "cloning" ||
      value === "rtqpcr" ||
      value === "sgrna" ||
      value === "sirna" ||
      value === "mutagenesis"
    ) {
      return value;
    }
    return null;
  }

  function buildEmptySnapshot(selectedWorkspace: AgentWorkspace) {
    return buildDocumentSnapshot({
      name: "",
      sequence: "",
      circular: false,
      features: [],
    }, selectedWorkspace, null);
  }

  function workspaceFromDraft(rawDraft: Record<string, unknown> | null): AgentWorkspace | null {
    if (!rawDraft) return null;
    return normalizeWorkspace(rawDraft.workspace);
  }

  /**
   * Return true if an error is a caller-initiated cancellation (not a timeout).
   * These are expected after context invalidation and should not surface to the user.
   */
  function isCancellation(err: unknown): boolean {
    if (err instanceof DOMException && err.name === "AbortError") return true;
    if (err instanceof Error && err.name === "AbortError") return true;
    if (err instanceof AgentServiceError && err.message === "Request timed out") return false;
    return false;
  }

  const performHealthCheck = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setServiceStatus("starting");
    setHealthLabel("Starting…");
    setError(null);

    ensureLocalAgentService()
      .then((launch) => {
        if (!mountedRef.current) return null;
        if (launch.status === "unavailable") {
          setServiceStatus("offline");
          setHealthLabel(launch.message);
          return null;
        }
        setServiceStatus("checking");
        setHealthLabel("Checking…");
        return checkAgentHealth(controller.signal);
      })
      .then((health: AgentHealth | null) => {
        if (!health) return;
        if (!mountedRef.current) return;
        setServiceStatus(health.status);
        setHealthLabel(health.label);
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        if (isCancellation(err)) return;
        if (err instanceof AgentServiceError) {
          setServiceStatus("offline");
          setHealthLabel(err.message);
        } else {
          setServiceStatus("offline");
          setHealthLabel("Unreachable");
        }
      });
  }, []);

  const clearDraftPlanResults = useCallback((notice?: string) => {
    autoExecuteArmedRef.current = false;
    setPlan([]);
    setDraft(null);
    setReadyToExecute(false);
    setRunLog([]);
    setTimeline([]);
    setRecommendation(null);
    setArtifactPackage(null);
    setTaskConfirmation(null);
    setResultCount(null);
    setCandidates([]);
    setAgentRun({ runId: null, status: null });
    setSequencePatch(undefined);
    setValidationStatus("idle");
    setValidationMessages([]);
    setValidationResults([]);
    setConversationOnly(false);
    setPlanProvenance(null);
    setClaimLevel(null);
    if (notice && mountedRef.current) {
      setMessages((prev) => {
        const hasUserTask = prev.some((message) => message.role === "user");
        const alreadyNotified = prev[prev.length - 1]?.content === notice;
        if (!hasUserTask || alreadyNotified) return prev;
        return [
          ...prev,
          { role: "assistant" as const, content: notice },
        ];
      });
    }
  }, []);

  const sendMessage = useCallback(
    (
      message: string,
      doc: SequenceDocument | null,
      selectedWorkspace?: AgentWorkspace,
      selection: SequenceSelection | null = null,
      attachment?: AgentSequenceAttachment,
      displayMessage?: string,
      structuredInputs?: AgentStructuredInputs,
    ) => {
      if (
        !message.trim() ||
        phase !== "idle" ||
        validationStatusRef.current === "running"
      ) return;

      // Capture the context for auto-execution: if this planning round ends
      // ready, auto mode runs the design with the same document/selection.
      lastSendDocRef.current = doc;
      lastSendSelectionRef.current = selection;
      autoExecuteArmedRef.current = true;

      abortRef.current?.abort();
      invalidateGeneration();
      const gen = captureGeneration();
      const controller = new AbortController();
      abortRef.current = controller;

      // Clear plan/results but PRESERVE draft for cross-turn slot memory.
      // The draft carries extracted parameters (method, homology, enzyme sites)
      // that the user provided in earlier messages.  The backend will rebuild
      // the draft from the current snapshot; applyPlanResponse merges the new
      // draft into the existing one so previously-supplied slots survive.
      setPlan([]);
      setReadyToExecute(false);
      setRunLog([]);
      setTimeline([]);
      setRecommendation(null);
    setArtifactPackage(null);
    setTaskConfirmation(null);
      setResultCount(null);
      setCandidates([]);
      setAgentRun({ runId: null, status: null });
      setSequencePatch(undefined);
      setValidationStatus("idle");
      setValidationMessages([]);
      setValidationResults([]);
      setConversationOnly(false);
      setPlanProvenance(null);

      const userMsg: ConversationMessage = {
        role: "user",
        content: displayMessage?.trim() || message.trim(),
        ...((attachment || structuredInputs)
          ? {
              requestContent: [
                structuredInputs
                  ? structuredInputsContext(message.trim(), structuredInputs)
                  : message.trim(),
                attachment ? `agent attachment sequence: ${attachment.sequence}` : "",
              ].filter(Boolean).join("\n"),
            }
          : {}),
      };
      setMessages((prev) => [...prev, userMsg]);
      setPhase("planning");
      setError(null);
      if (!structuredInputs) setLastUserGoal(message.trim());
      setConversationOnly(false);

      // Explicit callers can still pin a workspace. The unified Agent UI omits
      // it so the service can route the task from the message and context.
      if (selectedWorkspace && selectedWorkspace !== workspaceRef.current) {
        setDraft(null);
      }

      if (selectedWorkspace) {
        setWorkspace(selectedWorkspace);
      }

      const contextWorkspace = selectedWorkspace ?? workspaceRef.current ?? "cloning";

      // Snapshot versioning: record the document hash at plan time so
      // execute can reject if the document changed in between.
      const currentHash = doc ? fingerprintDocument(doc) : null;
      setPlanSnapshotHash(currentHash);

      const snapshot = doc
        ? buildDocumentSnapshot(doc, contextWorkspace, selection, currentHash ?? undefined)
        : buildEmptySnapshot(contextWorkspace);

      const history: AgentChatRequest["history"] = messagesRef.current.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.requestContent ? { contextContent: m.requestContent } : {}),
      }));

      const request: AgentChatRequest = {
        message: message.trim(),
        ...(selectedWorkspace ? { workspace: selectedWorkspace } : {}),
        runMode: "precise",
        agentMode,
        snapshot,
        history,
        ...(attachment ? { attachments: [attachment] } : {}),
        ...(structuredInputs ? { structuredInputs } : {}),
      };

      planAgentTask(request, controller.signal)
        .then((response: AgentResponse) => {
          if (!mountedRef.current || !isGenerationCurrent(gen)) return;
          applyPlanResponse(response);
        })
        .catch((err: unknown) => {
          if (!mountedRef.current || !isGenerationCurrent(gen)) return;
          if (isCancellation(err)) {
            setPhase("idle");
            return;
          }
          handleRequestError(err, "Planning failed");
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phase, messages],
  );

  const applyPlanResponse = useCallback(
    (response: AgentResponse) => {
      const responseWorkspace = normalizeWorkspace(response.workspace);

      // Append assistant messages
      if (response.messages.length > 0) {
        setMessages((prev) => [
          ...prev,
          ...response.messages.map((content) => ({ role: "assistant" as const, content })),
        ]);
      }

      setPlan(response.plan);
      setPlanProvenance(response.planProvenance ?? null);

      // Cross-turn slot memory: merge new draft into existing one.
      // The backend rebuilds the draft from the current snapshot each turn.
      // Previously-supplied slot values (method, homology, enzyme sites) that
      // the user provided in earlier messages may not be re-extracted if the
      // backend's LLM doesn't see them in the latest message.  By merging,
      // we preserve those values so the user doesn't have to repeat themselves.
      if (response.draft) {
        setDraft((prev) => {
          if (!prev || (responseWorkspace && responseWorkspace !== workspaceRef.current)) {
            return response.draft;
          }
          return mergeDrafts(prev, response.draft!);
        });
      }
      // If response.draft is null (missing inputs), keep the previous draft
      // so the user can see what was already extracted.

      setReadyToExecute(response.readyToExecute);
      setConversationOnly(response.conversationOnly === true);
      setAgentRun(response.agentRun);
      if (response.llmStatus?.message || response.llmStatus?.label) {
        setHealthLabel(response.llmStatus.message || response.llmStatus.label);
      }
      setSequencePatch(response.sequencePatch);
      if (response.taskConfirmation) {
        setTaskConfirmation(response.taskConfirmation);
      }
      if (responseWorkspace) setWorkspace(responseWorkspace);
      setPhase("idle");
      setError(null);

      // Preserve planning-stage runLog so backend context tools appear immediately
      if (response.runLog.length > 0) {
        setRunLog(response.runLog);
      }
      if (response.timeline && response.timeline.length > 0) {
        setTimeline((prev) => [...prev, ...response.timeline!]);
      }

      // Hand off sequencePatch to TASK-005 validation boundary
      if (response.sequencePatch !== undefined && onSequencePatchReceivedRef.current) {
        onSequencePatchReceivedRef.current(response.sequencePatch);
      }
    },
    [],
  );

  const executeDesign = useCallback(
    (doc: SequenceDocument | null, selectedWorkspace: AgentWorkspace = "cloning", selection: SequenceSelection | null = null) => {
      if (
        !draft ||
        !readyToExecute ||
        phase !== "idle" ||
        validationStatusRef.current === "running"
      ) return;

      abortRef.current?.abort();
      invalidateGeneration();
      const gen = captureGeneration();
      const controller = new AbortController();
      abortRef.current = controller;

      setPhase("executing");
      setError(null);
      const executionWorkspace =
        workspaceFromDraft(draftRef.current) ?? workspaceRef.current ?? selectedWorkspace;

      // Snapshot version guard: reject if document changed since plan.
      const executeHash = doc ? fingerprintDocument(doc) : null;
      if (planSnapshotHash && executeHash && planSnapshotHash !== executeHash) {
        setError("序列已在规划后被修改，请重新规划后再执行。");
        setPhase("idle");
        return;
      }

      const snapshot = doc
        ? buildDocumentSnapshot(doc, executionWorkspace, selection, executeHash ?? undefined)
        : buildEmptySnapshot(executionWorkspace);

      const history: AgentChatRequest["history"] = messagesRef.current.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.requestContent ? { contextContent: m.requestContent } : {}),
      }));

      const request: AgentExecuteRequest = {
        draft: draftRef.current!,  // non-null: guarded by draft check at entry
        snapshot,
        history,
        workspace: executionWorkspace,
        runMode: "precise",
        agentMode,
        message: lastUserGoalRef.current,
        runId: agentRunRef.current.runId ?? undefined,
        planSnapshotHash: planSnapshotHash ?? undefined,
        requestId: crypto.randomUUID(),
      };

      setRunLog([]);
      executeAgentTaskStream(
        request,
        (event) => {
          if (!mountedRef.current || !isGenerationCurrent(gen)) return;
          if (event.type !== "step_start" && event.type !== "step_done") return;
          const row = runLogRowFromEvent(event.data);
          const status = event.type === "step_start" ? "running" : "completed";
          setRunLog((previous) => {
            const next = [...previous];
            let match = -1;
            for (let index = next.length - 1; index >= 0; index -= 1) {
              if (next[index]?.tool === row.tool && next[index]?.status === "running") {
                match = index;
                break;
              }
            }
            if (match >= 0) next[match] = { ...next[match]!, ...row, status };
            else next.push({ ...row, status });
            return next;
          });
        },
        controller.signal,
        // Reasoning-model planning (DeepSeek V4 via opencode-go) can take
        // well over a minute of chain-of-thought before the first tool step
        // emits. Keep the stream open long enough instead of surfacing a
        // client-side timeout mid-plan.
        240_000,
      )
        .then((response: AgentResponse) => {
          if (!mountedRef.current || !isGenerationCurrent(gen)) return;
          applyExecuteResponse(response);
        })
        .catch((err: unknown) => {
          if (!mountedRef.current || !isGenerationCurrent(gen)) return;
          if (isCancellation(err)) {
            setPhase("idle");
            return;
          }
          handleRequestError(err, "Execution failed");
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, readyToExecute, phase, messages, lastUserGoal, agentRun, workspace],
  );

  // Auto mode overrides the "Confirm and run" click: the moment a freshly-
  // planned response is ready, start execution with the document/selection
  // captured at sendMessage time. The armed flag is set only by sendMessage
  // and consumed here, so restored sessions or context invalidation never
  // auto-execute, and a failed execute (which keeps readyToExecute true)
  // cannot re-trigger in a loop. Plans that still need user input (blockers
  // or missing parameters) are left for the confirmation panel.
  useEffect(() => {
    if (agentMode !== "auto") return;
    if (!autoExecuteArmedRef.current) return;
    if (!readyToExecute || !draft || phase !== "idle") return;
    if (conversationOnly) return;
    if (
      taskConfirmation &&
      (taskConfirmation.blockers.length > 0 || taskConfirmation.missingParameters.length > 0)
    ) return;
    autoExecuteArmedRef.current = false;
    executeDesign(lastSendDocRef.current, workspaceRef.current, lastSendSelectionRef.current);
  }, [agentMode, readyToExecute, draft, phase, conversationOnly, taskConfirmation, executeDesign]);

  const applyExecuteResponse = useCallback((response: AgentResponse) => {
    // Append result messages
    if (response.messages.length > 0) {
      setMessages((prev) => [
        ...prev,
        ...response.messages.map((content) => ({ role: "assistant" as const, content })),
      ]);
    }

    // If execute returned a non-empty plan, replace the planning-stage rows
    // so that statuses become completed.
    if (response.plan.length > 0) {
      setPlan(response.plan);
    }
    setPlanProvenance(response.planProvenance ?? null);
    setClaimLevel(claimLevelFromMeta(response.meta));

    setRunLog(response.runLog);
    if (response.timeline && response.timeline.length > 0) {
      setTimeline((prev) => [...prev, ...response.timeline!]);
    }
    setRecommendation(response.recommendation);
    if (response.artifactPackage) {
      setArtifactPackage(response.artifactPackage);
    }
    if (response.taskConfirmation) {
      setTaskConfirmation(response.taskConfirmation);
    }
    setResultCount(response.resultCount);
    setCandidates(response.candidates ?? []);
    setAgentRun(response.agentRun);
    if (response.llmStatus?.message || response.llmStatus?.label) {
      setHealthLabel(response.llmStatus.message || response.llmStatus.label);
    }

    // Save run to history for later review/restore
    if (response.agentRun.runId && response.candidates && response.candidates.length > 0) {
      const entry = buildRunHistoryEntry({
        runId: response.agentRun.runId,
        workspace: workspaceRef.current,
        agentMode: agentModeRef.current,
        goal: lastUserGoalRef.current,
        plan: response.plan,
        candidates: response.candidates,
        recommendation: response.recommendation,
        timeline: response.timeline ?? [],
        runRecord: response.runRecord,
      });
      saveRunHistoryEntry(entry);
    }
    setSequencePatch(response.sequencePatch);
    const responseWorkspace = normalizeWorkspace(response.workspace);
    if (responseWorkspace) setWorkspace(responseWorkspace);
    setReadyToExecute(false);
    setPhase("idle");
    setError(null);
    setValidationStatus("idle");
    setValidationMessages([]);
    setValidationResults([]);
    setConversationOnly(false);

    // Hand off sequencePatch to TASK-005 validation boundary
    if (response.sequencePatch !== undefined && onSequencePatchReceivedRef.current) {
      onSequencePatchReceivedRef.current(response.sequencePatch);
    }
  }, []);

  const validateResults = useCallback(() => {
    if (phase !== "idle" || validationStatus === "running") return;
    if (workspace !== "rtqpcr" && workspace !== "sgrna" && workspace !== "sirna") return;
    if (candidates.length === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setValidationStatus("running");
    setValidationMessages([]);
    setValidationResults([]);
    setError(null);
    invalidateGeneration();
    const gen = captureGeneration();

    // Route validation through the agent execute pipeline so the check tool
    // (check_rt_specificity / check_sgrna_offtarget / check_sirna_offtarget)
    // enters the timeline and tool observations and obeys the mode policy.
    const history: AgentChatRequest["history"] = messagesRef.current.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.requestContent ? { contextContent: m.requestContent } : {}),
    }));
    const request: AgentExecuteRequest = {
      draft: draftRef.current ?? {},
      snapshot: buildEmptySnapshot(workspaceRef.current),
      history,
      workspace: workspaceRef.current,
      runMode: "precise",
      agentMode: agentModeRef.current,
      message: lastUserGoalRef.current || "运行远程验证",
      runId: agentRunRef.current.runId ?? undefined,
      requestId: crypto.randomUUID(),
      checkResults: candidates.map((candidate) => candidate.raw ?? {}),
    };

    executeAgentTaskStream(
      request,
      (event) => {
        if (!mountedRef.current || !isGenerationCurrent(gen)) return;
        if (event.type !== "step_start" && event.type !== "step_done") return;
        const row = runLogRowFromEvent(event.data);
        const status = event.type === "step_start" ? "running" : "completed";
        setRunLog((previous) => {
          const next = [...previous];
          let match = -1;
          for (let index = next.length - 1; index >= 0; index -= 1) {
            if (next[index]?.tool === row.tool && next[index]?.status === "running") {
              match = index;
              break;
            }
          }
          if (match >= 0) next[match] = { ...next[match]!, ...row, status };
          else next.push({ ...row, status });
          return next;
        });
      },
      controller.signal,
      // Remote BLAST checks can take up to 90s server-side; keep the old
      // runExternalValidation 120s budget so NCBI latency doesn't surface
      // as a client-side timeout.
      120_000,
    )
      .then((response) => {
        if (!mountedRef.current || !isGenerationCurrent(gen)) return;
        setValidationStatus("completed");
        setValidationMessages(response.check?.messages ?? response.messages);
        setValidationResults(response.check?.results ?? []);
        if (response.timeline && response.timeline.length > 0) {
          setTimeline((prev) => [...prev, ...response.timeline!]);
        }
        if (response.agentRun.runId) setAgentRun(response.agentRun);
      })
      .catch((err: unknown) => {
        if (!mountedRef.current || !isGenerationCurrent(gen)) return;
        if (isCancellation(err)) return;
        setValidationStatus("error");
        setError(err instanceof Error ? err.message : "Remote validation failed");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, validationStatus, workspace, candidates, draft]);

  const handleRequestError = useCallback((err: unknown, fallback: string) => {
    if (!mountedRef.current) return;
    const message =
      err instanceof Error && err.name === "AgentServiceError"
        ? err.message
        : fallback;
    setError(message);
    setPhase("idle");
    // Clear draft on planning failure — the old draft may be stale after
    // the user's new message changed context.  Execute errors do not
    // clear the draft so the user can retry.
    if (fallback === "Planning failed") {
      setDraft(null);
      setReadyToExecute(false);
    }
  }, []);

  const cancelRequest = useCallback(() => {
    if (phase === "idle" && validationStatus !== "running") return;
    // A-AGT-003: Stop must reach the server, not just the client stream.
    // Fire-and-forget so the UI abort is never delayed by the cancel POST.
    const activeRunId = agentRunRef.current.runId;
    if (activeRunId) {
      void cancelAgentTask(activeRunId);
    }
    abortRef.current?.abort();
    abortRef.current = null;
    invalidateGeneration();
    setPhase("idle");
    setValidationStatus("idle");
    setRunLog((previous) => previous.map((row) =>
      row.status === "running"
        ? { ...row, status: "cancelled", message: row.message || "Stopped by user" }
        : row,
    ));
    setError(null);
    setMessages((previous) => [
      ...previous,
      { role: "assistant", content: "已停止当前操作。" },
    ]);
  }, [phase, validationStatus]);

  const clearSession = useCallback(() => {
    const currentMessages: AgentConversationMessage[] = messagesRef.current
      .filter((message) => message.content.trim())
      .map(({ role, content }) => ({ role, content }));
    if (currentMessages.some((message) => message.role === "user")) {
      saveConversationHistoryEntry(
        buildConversationHistoryEntry({
          id: conversationIdRef.current,
          goal: lastUserGoalRef.current,
          workspace: workspaceRef.current,
          agentMode: agentModeRef.current,
          messages: currentMessages,
          runId: agentRunRef.current.runId,
        }),
      );
    }
    conversationIdRef.current = createConversationId();
    autoExecuteArmedRef.current = false;
    abortRef.current?.abort();
    invalidateGeneration();
    setMessages([]);
    setPlan([]);
    setDraft(null);
    setReadyToExecute(false);
    setRunLog([]);
    setTimeline([]);
    setRecommendation(null);
    setArtifactPackage(null);
    setTaskConfirmation(null);
    setResultCount(null);
    setCandidates([]);
    setAgentRun({ runId: null, status: null });
    setPhase("idle");
    setError(null);
    setLastUserGoal("");
    setSequencePatch(undefined);
    setValidationStatus("idle");
    setValidationMessages([]);
    setValidationResults([]);
    setConversationOnly(false);
    setPlanSnapshotHash(null);
    setPlanProvenance(null);
    clearPersistedAgentSession(undefined, sessionKey);
  }, [sessionKey]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const restoreFromHistory = useCallback((entry: RunHistoryEntry) => {
    setCandidates(entry.candidates);
    setRecommendation(entry.recommendation);
    setResultCount(entry.candidates.length);
    setPhase("idle");
    setError(null);
    setMessages((prev) => [
      ...prev,
      { role: "assistant" as const, content: `已恢复历史方案（${entry.goal}），共 ${entry.candidates.length} 个候选。` },
    ]);
  }, []);

  const restoreConversation = useCallback(
    (entry: AgentConversationHistoryEntry) => {
      if (entry.messages.length === 0) return;

      // A restored conversation must never leave an in-flight plan or execute
      // response able to write back into the newly selected transcript.
      abortRef.current?.abort();
      abortRef.current = null;
      invalidateGeneration();
      autoExecuteArmedRef.current = false;

      conversationIdRef.current = entry.id;
      setMessages(
        entry.messages.map(({ role, content }) => ({
          role,
          content,
        })),
      );
      setWorkspace(entry.workspace);
      setAgentMode(entry.agentMode);
      setLastUserGoal(
        [...entry.messages].reverse().find((message) => message.role === "user")?.content ?? entry.title,
      );

      // Historical chat messages are safe to continue, but a plan/result from
      // another document must not be silently reused or applied here.
      clearDraftPlanResults();
      setPlanSnapshotHash(null);
      setPhase("idle");
      setError(null);
      setConversationOnly(true);

      // Remove the old per-tab snapshot immediately. The persistence effect
      // will write the restored conversation under its stable conversation id.
      clearPersistedAgentSession(undefined, sessionKey);
    },
    [clearDraftPlanResults, sessionKey],
  );

  /**
   * Called when the document hash changes (file open, OVE commit, etc.).
   * Clears draft/plan/results while preserving conversation with a notice.
   * Aborts in-flight requests and invalidates the generation token so late
   * responses cannot restore stale state.
   */
  const onDocumentHashChange = useCallback(
    (hash: string | null) => {
      // Skip the initial null→hash transition (first document load)
      if (lastHashRef.current === null && hash !== null) {
        lastHashRef.current = hash;
        return;
      }
      if (hash === lastHashRef.current) return;
      lastHashRef.current = hash;

      // Abort in-flight requests and invalidate generation
      abortRef.current?.abort();
      invalidateGeneration();
      setPhase("idle");
      setError(null);
      setPlanSnapshotHash(null);

      // Clear draft/plan/results with a notice
      clearDraftPlanResults("[Context changed — prior plan and draft cleared]");
    },
    [clearDraftPlanResults],
  );

  return {
    serviceStatus,
    healthLabel,
    messages,
    plan,
    draft,
    readyToExecute,
    runLog,
    timeline,
    recommendation,
    artifactPackage,
    taskConfirmation,
    resultCount,
    candidates,
    agentRun,
    workspace,
    phase,
    error,
    lastUserGoal,
    sequencePatch,
    planSnapshotHash,
    agentMode,
    validationStatus,
    validationMessages,
    validationResults,
    conversationOnly,
    planProvenance,
    claimLevel,
    setAgentMode,
    checkHealth: performHealthCheck,
    sendMessage,
    cancelRequest,
    executeDesign,
    validateResults,
    clearSession,
    clearError,
    restoreFromHistory,
    restoreConversation,
    onDocumentHashChange,
    onSequencePatchReceived: null,
    setOnSequencePatchReceived,
  };
}
