/**
 * Local Agent HTTP client.
 *
 * Communicates with the Python sidecar at the configured base URL.
 * All responses cross a runtime `unknown` boundary — the caller normalizes.
 */

import type { SequenceDocument, SequenceSelection } from "../types";
import type { AgentResponse, AgentHealth } from "./responseTypes";
import { normalizeAgentResponse, normalizeAgentHealth } from "./responseTypes";

// ── Configuration ────────────────────────────────────────────

const DEFAULT_BASE_URL = "http://127.0.0.1:8000";
const REQUEST_TIMEOUT_MS = 30_000;
// One Agent turn can include both an intent decision and a free-form model
// response. Reasoning models may legitimately need more than 30 seconds for
// that pair, while health/config requests should remain short.
const AGENT_TASK_TIMEOUT_MS = 120_000;

export type AgentWorkspace =
  | "cloning"
  | "rtqpcr"
  | "sgrna"
  | "sirna"
  | "mutagenesis";

export type AgentStructuredInputValue =
  | string
  | boolean
  | number
  | Array<string | { name?: string; label?: string; sequence?: string; dna?: string }>;
export type AgentStructuredInputs = Record<string, AgentStructuredInputValue>;

export function getAgentBaseUrl(): string {
  const env = import.meta.env.VITE_AGENT_API_BASE;
  if (typeof env === "string" && env.trim().length > 0) {
    return env.trim().replace(/\/+$/, "");
  }
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__
    ? "http://127.0.0.1:18764"
    : DEFAULT_BASE_URL;
}

// ── Local API token (A-API-001) ──────────────────────────────

const API_TOKEN_HEADER = "X-GeneCode-Token";

let cachedApiToken: string | null = null;
let apiTokenPromise: Promise<string | null> | null = null;

interface TauriInvokeApi {
  invoke: (command: string) => Promise<unknown>;
}

/**
 * The desktop app provisions a random 256-bit token in Rust and injects it
 * into the Python sidecar via GENE_CODE_API_TOKEN. This mirrors that command
 * so every Agent request can present the same token. In plain-browser dev
 * mode (no Tauri) we fall back to VITE_AGENT_API_TOKEN; when neither exists
 * the requests simply go out without a header (the sidecar then runs with
 * enforcement disabled). The result is cached for the app lifetime.
 */
export function getAgentApiToken(): Promise<string | null> {
  if (cachedApiToken !== null) return Promise.resolve(cachedApiToken);
  if (apiTokenPromise) return apiTokenPromise;

  apiTokenPromise = (async (): Promise<string | null> => {
    const tauriApi = (globalThis as { __TAURI_INTERNALS__?: TauriInvokeApi })
      .__TAURI_INTERNALS__;
    if (tauriApi?.invoke) {
      try {
        const token = await tauriApi.invoke("get_agent_api_token");
        if (typeof token === "string" && token.length > 0) {
          cachedApiToken = token;
          return token;
        }
      } catch {
        // Fall through to the dev-mode env fallback.
      }
    }
    const env = import.meta.env.VITE_AGENT_API_TOKEN;
    const fallback = typeof env === "string" && env.trim().length > 0 ? env.trim() : null;
    if (fallback) cachedApiToken = fallback;
    return fallback;
  })();
  return apiTokenPromise;
}

/** Reset the cached token (used by tests and after a server restart). */
export function resetAgentApiTokenCache(): void {
  cachedApiToken = null;
  apiTokenPromise = null;
}

async function withTokenHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const token = await getAgentApiToken();
  return {
    ...extra,
    ...(token ? { [API_TOKEN_HEADER]: token } : {}),
  };
}

// ── Helpers ──────────────────────────────────────────────────

export class AgentServiceError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AgentServiceError";
  }
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new AgentServiceError(
      "Agent service returned a non-JSON response",
      response.status,
    );
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new AgentServiceError("Agent service returned malformed JSON");
  }
}

/**
 * Create a request controller that merges a caller signal with a timeout.
 * Returns the controller, a cleanup function, and a closure-scoped `timedOut`
 * flag so the caller can distinguish timeout from caller-initiated abort.
 */
function createRequestController(
  callerSignal: AbortSignal | undefined,
  timeoutMs = REQUEST_TIMEOUT_MS,
): {
  controller: AbortController;
  cleanup: () => void;
  /** True if the internal timeout fired (set before controller.abort). */
  timedOut: () => boolean;
} {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  let timedOut = false;

  // Forward caller abort
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort(callerSignal.reason);
      return { controller, cleanup: () => {}, timedOut: () => false };
    }
    const onCallerAbort = () => controller.abort(callerSignal.reason);
    callerSignal.addEventListener("abort", onCallerAbort, { once: true });
    cleanups.push(() => callerSignal.removeEventListener("abort", onCallerAbort));
  }

  // Timeout abort — sets a flag so the catch block can distinguish it
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort(new AgentServiceError("Request timed out"));
  }, timeoutMs);
  cleanups.push(() => clearTimeout(timeoutId));

  return {
    controller,
    cleanup: () => {
      for (const fn of cleanups) fn();
    },
    timedOut: () => timedOut,
  };
}

// ── Request types ────────────────────────────────────────────

/**
 * Snapshot payload matching the service's expected shape:
 * snapshot.lastWorkbenchPage, snapshot.currentSequenceDocument,
 * snapshot.formState.cloning.*
 */
export interface AgentSnapshot {
  lastWorkbenchPage: AgentWorkspace;
  currentSequenceDocument: {
    name: string;
    sequence: string;
    circular: boolean;
    accession?: string;
    version?: string;
    featureSummary: Array<{ name: string; type: string; start: number; end: number; strand: 1 | -1 }>;
  };
  currentSelection: {
    start: number;
    end: number;
    length: number;
    wrapsOrigin: boolean;
    sequence: string;
    cursor?: boolean;
  } | null;
  /** FNV-1a 64-bit fingerprint of the document at snapshot build time. */
  documentHash?: string;
  formState: {
    cloning: {
      vectorSequence: string;
      vectorTopology: "circular" | "linear";
      vectorLabel: string;
    };
    custom: {
      sequence: string;
      label: string;
    };
    rt: {
      query: string;
      species: string;
      strain: string;
      gdnaCheck: boolean;
      includeProbe: boolean;
    };
    sg: {
      sequence: string;
      query: string;
      label: string;
      species: string;
      strain: string;
      selectedAccession: string;
      mode: "ko" | "ki";
      pamSet: string;
    };
    sirna: {
      sequence: string;
      query: string;
      label: string;
      species: string;
      strain: string;
      selectedAccession: string;
      duplexLength: number;
      overhangMode: "dtdt" | "none";
      preferShared: boolean;
      cdsOnly: boolean;
      excludeHighRisk: boolean;
    };
    mutation: {
      sequence: string;
      label: string;
      mode: "dna" | "aa";
      position: string;
      reference: string;
      alternate: string;
      cdsStart: string;
      aaPosition: string;
      sourceAa: string;
      targetAa: string;
    };
  };
}

export interface AgentChatRequest {
  message: string;
  /** Omit to let the Agent route the task from the message and document context. */
  workspace?: AgentWorkspace;
  runMode: "precise";
  agentMode?: AgentMode;
  snapshot: AgentSnapshot;
  history: Array<{
    role: "user" | "assistant";
    content: string;
    /** Local-only structured context; the backend excludes this from LLM history. */
    contextContent?: string;
  }>;
  attachments?: AgentSequenceAttachment[];
  /**
   * Local task slots collected by structured confirmation controls.
   * The backend consumes these deterministically and does not include raw
   * sequence values in the model-facing conversation prompt.
   */
  structuredInputs?: AgentStructuredInputs;
}

export interface AgentSequenceAttachment {
  name: string;
  sequence: string;
  circular: boolean;
  featureCount: number;
}

export interface AgentExecuteRequest {
  draft: Record<string, unknown>;
  snapshot: AgentSnapshot;
  history: AgentChatRequest["history"];
  workspace: AgentWorkspace;
  runMode: "precise";
  agentMode?: AgentMode;
  message: string;
  runId?: string;
  /** Hash of the document at plan time — execute rejects if it doesn't match current. */
  planSnapshotHash?: string;
  /** Unique id for this execute call — backend rejects duplicates within a TTL window. */
  requestId?: string;
  /**
   * Raw design candidates for a registered remote check tool
   * (check_rt_specificity / check_sgrna_offtarget / check_sirna_offtarget).
   * Presence routes this execute to the check pipeline instead of the design
   * engine, so the verification step enters the timeline and tool observations
   * and is gated by the agent mode policy.
   */
  checkResults?: Array<Record<string, unknown>>;
}

/** Agent behavior mode — controls what tools the agent may invoke. */
export type AgentMode = "review" | "plan" | "auto";

export interface AgentStreamEvent {
  type: string;
  data: Record<string, unknown>;
}

export interface AgentJournalRun {
  run_id: string;
  mode: string;
  workspace: string;
  status: string;
  plan_snapshot_hash?: string;
  execute_snapshot_hash?: string;
  created_at?: number;
  updated_at?: number;
  events?: Array<Record<string, unknown>>;
  artifacts?: Array<Record<string, unknown>>;
}

export interface AgentArtifactRead {
  artifact_id: string;
  type?: string;
  title?: string;
  description?: string;
  status?: string;
  filename?: string;
  content_hash?: string;
  byte_size?: number;
  data?: Record<string, unknown>;
  dataPreview?: string;
  dataTruncated?: boolean;
}

export interface AgentLlmConnectionResult {
  connected: boolean;
  message: string;
}

export interface AgentModelSwitchInput {
  model: string;
  baseUrl?: string;
  provider?: string;
}

export interface AgentModelSwitchResult {
  ok: boolean;
  llm: {
    provider?: string;
    model?: string;
    mode?: string;
    message?: string;
  };
}

// ── API calls ────────────────────────────────────────────────

/**
 * Workspace → snapshot formState slot key that carries the open sequence.
 *
 * Only the slot matching the snapshot workspace is populated with the full
 * sequence; the others keep empty sequences so a >100 kb open document is not
 * copied up to six times into the request body. The service falls back to the
 * canonical `currentSequenceDocument.sequence` when a message routes to a
 * different workspace than the snapshot.
 *
 * Note the intentional naming asymmetry: the mutagenesis *workspace* id is
 * "mutagenesis", but its snapshot formState *key* is "mutation" — the Python
 * service reads formState.mutation (server.py: mutagenesis_state_from_snapshot).
 * Keeping the mapping in one place makes the pairing explicit and documented.
 */
export const WORKSPACE_FORM_STATE_KEY: Record<AgentWorkspace, keyof AgentSnapshot["formState"]> = {
  cloning: "cloning",
  rtqpcr: "custom",
  sgrna: "sg",
  sirna: "sirna",
  mutagenesis: "mutation",
};

/**
 * Build a compact document snapshot for the Agent service.
 * The open vector is sent as context under snapshot.formState.cloning,
 * never silently as the insert.
 */
export function buildDocumentSnapshot(
  doc: SequenceDocument,
  workspace: AgentWorkspace = "cloning",
  selection: SequenceSelection | null = null,
  documentHash?: string,
): AgentSnapshot {
  const sequenceSlot = WORKSPACE_FORM_STATE_KEY[workspace];
  const sequenceFor = (slot: keyof AgentSnapshot["formState"]): string =>
    slot === sequenceSlot ? doc.sequence : "";

  return {
    lastWorkbenchPage: workspace,
    currentSequenceDocument: {
      name: doc.name,
      sequence: doc.sequence,
      circular: doc.circular,
      accession: doc.accession,
      version: doc.version,
      featureSummary: doc.features.map((f) => ({
        name: f.name,
        type: f.type,
        start: f.start,
        end: f.end,
        strand: f.strand,
      })),
    },
    currentSelection: selection
      ? {
          start: selection.start,
          end: selection.end,
          length: selection.length,
          wrapsOrigin: selection.wrapsOrigin,
          sequence: selection.sequence,
          ...(selection.cursor ? { cursor: true } : {}),
        }
      : null,
    ...(documentHash ? { documentHash } : {}),
    formState: {
      cloning: {
        vectorSequence: sequenceFor("cloning"),
        vectorTopology: doc.circular ? "circular" : "linear",
        vectorLabel: doc.name,
      },
      custom: {
        sequence: sequenceFor("custom"),
        label: doc.name,
      },
      rt: {
        query: "",
        species: "Homo sapiens",
        strain: "",
        gdnaCheck: true,
        includeProbe: false,
      },
      sg: {
        sequence: sequenceFor("sg"),
        query: "",
        label: doc.name,
        species: "Homo sapiens",
        strain: "",
        selectedAccession: "",
        mode: "ko",
        pamSet: "spcas9_ngg",
      },
      sirna: {
        sequence: sequenceFor("sirna"),
        query: "",
        label: doc.name,
        species: "Homo sapiens",
        strain: "",
        selectedAccession: "",
        duplexLength: 21,
        overhangMode: "dtdt",
        preferShared: false,
        cdsOnly: false,
        excludeHighRisk: false,
      },
      mutation: {
        sequence: sequenceFor("mutation"),
        label: doc.name,
        mode: "dna",
        position: "",
        reference: "",
        alternate: "",
        cdsStart: "1",
        aaPosition: "",
        sourceAa: "",
        targetAa: "",
      },
    },
  };
}

export async function checkAgentHealth(
  signal?: AbortSignal,
): Promise<AgentHealth> {
  const base = getAgentBaseUrl();
  const { controller, cleanup, timedOut } = createRequestController(signal);

  try {
    const response = await fetch(`${base}/api/health`, {
      method: "GET",
      headers: await withTokenHeaders({ Accept: "application/json" }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new AgentServiceError(
        `Health check failed (${response.status})`,
        response.status,
      );
    }

    const raw = await parseJsonSafe(response);
    return normalizeAgentHealth(raw);
  } catch (err) {
    if (timedOut()) {
      throw new AgentServiceError("Health check timed out");
    }
    if (err instanceof AgentServiceError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    throw new AgentServiceError("Cannot reach Agent service");
  } finally {
    cleanup();
  }
}

/** Read durable backend Run metadata without loading artifact bodies. */
export async function listAgentRuns(
  limit = 50,
  signal?: AbortSignal,
): Promise<AgentJournalRun[]> {
  const base = getAgentBaseUrl();
  const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const { controller, cleanup, timedOut } = createRequestController(signal, 10_000);
  try {
    const response = await fetch(`${base}/api/agent/runs?limit=${boundedLimit}`, {
      method: "GET",
      headers: await withTokenHeaders({ Accept: "application/json" }),
      signal: controller.signal,
    });
    const raw = await parseJsonSafe(response);
    if (!response.ok) {
      const message = raw && typeof raw === "object" && "error" in raw
        ? String((raw as Record<string, unknown>).error)
        : `Run history request failed (${response.status})`;
      throw new AgentServiceError(message, response.status);
    }
    const runs: unknown[] = raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).runs)
      ? (raw as Record<string, unknown>).runs as unknown[]
      : [];
    return runs.filter((value: unknown): value is AgentJournalRun => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const row = value as Record<string, unknown>;
      return typeof row.run_id === "string" && typeof row.status === "string";
    });
  } catch (err) {
    if (timedOut()) throw new AgentServiceError("Run history request timed out");
    if (err instanceof AgentServiceError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new AgentServiceError("Run history request failed");
  } finally {
    cleanup();
  }
}

/** Restore one durable Run projection, including its compact event list. */
export async function getAgentRun(
  runId: string,
  signal?: AbortSignal,
): Promise<AgentJournalRun> {
  const base = getAgentBaseUrl();
  const { controller, cleanup, timedOut } = createRequestController(signal, 10_000);
  try {
    const response = await fetch(`${base}/api/agent/runs/${encodeURIComponent(runId)}`, {
      method: "GET",
      headers: await withTokenHeaders({ Accept: "application/json" }),
      signal: controller.signal,
    });
    const raw = await parseJsonSafe(response);
    if (!response.ok) {
      const message = raw && typeof raw === "object" && "error" in raw
        ? String((raw as Record<string, unknown>).error)
        : `Run request failed (${response.status})`;
      throw new AgentServiceError(message, response.status);
    }
    const run = raw && typeof raw === "object" ? (raw as Record<string, unknown>).run : null;
    if (!run || typeof run !== "object" || Array.isArray(run) || typeof (run as Record<string, unknown>).run_id !== "string") {
      throw new AgentServiceError("Run request returned malformed data");
    }
    return run as AgentJournalRun;
  } catch (err) {
    if (timedOut()) throw new AgentServiceError("Run request timed out");
    if (err instanceof AgentServiceError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new AgentServiceError("Run request failed");
  } finally {
    cleanup();
  }
}

/** Read an artifact with a bounded preview by default. */
export async function getAgentArtifact(
  runId: string,
  artifactId: string,
  options: { preview?: boolean; maxBytes?: number; signal?: AbortSignal } = {},
): Promise<AgentArtifactRead> {
  const base = getAgentBaseUrl();
  const maxBytes = Math.max(1_024, Math.min(8_000_000, Math.floor(options.maxBytes ?? 32_768)));
  const query = new URLSearchParams({ preview: options.preview === false ? "0" : "1", maxBytes: String(maxBytes) });
  const { controller, cleanup, timedOut } = createRequestController(options.signal, 15_000);
  try {
    const response = await fetch(`${base}/api/agent/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}?${query}`, {
      method: "GET",
      headers: await withTokenHeaders({ Accept: "application/json" }),
      signal: controller.signal,
    });
    const raw = await parseJsonSafe(response);
    if (!response.ok) {
      const message = raw && typeof raw === "object" && "error" in raw
        ? String((raw as Record<string, unknown>).error)
        : `Artifact request failed (${response.status})`;
      throw new AgentServiceError(message, response.status);
    }
    const artifact = raw && typeof raw === "object" ? (raw as Record<string, unknown>).artifact : null;
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact) || typeof (artifact as Record<string, unknown>).artifact_id !== "string") {
      throw new AgentServiceError("Artifact request returned malformed data");
    }
    return artifact as AgentArtifactRead;
  } catch (err) {
    if (timedOut()) throw new AgentServiceError("Artifact request timed out");
    if (err instanceof AgentServiceError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new AgentServiceError("Artifact request failed");
  } finally {
    cleanup();
  }
}

export async function testAgentLlmConnection(
  signal?: AbortSignal,
): Promise<AgentLlmConnectionResult> {
  const base = getAgentBaseUrl();
  const { controller, cleanup, timedOut } = createRequestController(signal, 50_000);

  try {
    const response = await fetch(`${base}/api/agent/test-llm`, {
      method: "POST",
      headers: await withTokenHeaders({
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: "{}",
      signal: controller.signal,
    });
    const raw = await parseJsonSafe(response);
    if (!response.ok) {
      const message = raw && typeof raw === "object" && "error" in raw
        ? String((raw as Record<string, unknown>).error)
        : `Model connection test failed (${response.status})`;
      throw new AgentServiceError(message, response.status);
    }
    if (!raw || typeof raw !== "object") {
      throw new AgentServiceError("Model connection test returned malformed data");
    }
    const data = raw as Record<string, unknown>;
    if (data.connected !== true) {
      throw new AgentServiceError(String(data.message || "Model connection test failed"));
    }
    return {
      connected: true,
      message: typeof data.message === "string" ? data.message : "Model connection succeeded",
    };
  } catch (err) {
    if (timedOut()) throw new AgentServiceError("Model connection test timed out");
    if (err instanceof AgentServiceError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new AgentServiceError("Model connection test failed");
  } finally {
    cleanup();
  }
}

/**
 * Switch the Agent's LLM model at runtime (no service restart needed).
 *
 * Only works when the local service is reachable; the browser app calls this
 * directly instead of the desktop-only Tauri keychain flow.
 */
export async function switchAgentModel(
  input: AgentModelSwitchInput,
  signal?: AbortSignal,
): Promise<AgentModelSwitchResult> {
  const base = getAgentBaseUrl();
  const { controller, cleanup, timedOut } = createRequestController(signal, 20_000);

  try {
    const response = await fetch(`${base}/api/agent/model`, {
      method: "POST",
      headers: await withTokenHeaders({
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const raw = await parseJsonSafe(response);
    if (!response.ok) {
      const message = raw && typeof raw === "object" && "error" in raw
        ? String((raw as Record<string, unknown>).error)
        : `Model switch failed (${response.status})`;
      throw new AgentServiceError(message, response.status);
    }
    if (!raw || typeof raw !== "object") {
      throw new AgentServiceError("Model switch returned malformed data");
    }
    const data = raw as Record<string, unknown>;
    const llm = data.llm && typeof data.llm === "object"
      ? (data.llm as Record<string, unknown>)
      : {};
    return {
      ok: data.ok === true,
      llm: {
        provider: typeof llm.provider === "string" ? llm.provider : undefined,
        model: typeof llm.model === "string" ? llm.model : undefined,
        mode: typeof llm.mode === "string" ? llm.mode : undefined,
        message: typeof llm.message === "string" ? llm.message : undefined,
      },
    };
  } catch (err) {
    if (timedOut()) throw new AgentServiceError("Model switch timed out");
    if (err instanceof AgentServiceError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new AgentServiceError("Model switch failed");
  } finally {
    cleanup();
  }
}

/**
 * Ask the backend to cancel an in-flight Agent run by its run_id.
 *
 * A-AGT-003: the client's AbortSignal only stops *reading* the SSE stream;
 * the server keeps running the model/tool task unless it is told to stop.
 * Fire-and-forget semantics: the caller should not block its own abort on
 * this call — the server cancels at the next step boundary either way.
 */
export async function cancelAgentTask(runId: string | null | undefined): Promise<void> {
  if (!runId) return;
  const base = getAgentBaseUrl();
  const { controller, cleanup } = createRequestController(undefined, 10_000);
  try {
    const response = await fetch(`${base}/api/agent/cancel`, {
      method: "POST",
      headers: await withTokenHeaders({
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ runId }),
      signal: controller.signal,
    });
    // Cancellation is best-effort; a failure here must never throw into the
    // caller's abort path (the fetch abort already stops client-side work).
    if (!response.ok) {
      await parseJsonSafe(response);
    }
  } catch {
    // swallow — client-side abort remains the source of truth for the UI
  } finally {
    cleanup();
  }
}

export async function planAgentTask(
  request: AgentChatRequest,
  signal?: AbortSignal,
): Promise<AgentResponse> {
  const base = getAgentBaseUrl();
  const { controller, cleanup, timedOut } = createRequestController(
    signal,
    AGENT_TASK_TIMEOUT_MS,
  );

  try {
    const response = await fetch(`${base}/api/agent/chat`, {
      method: "POST",
      headers: await withTokenHeaders({
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!response.ok) {
      const raw = await parseJsonSafe(response).catch(() => null);
      const errorMsg =
        raw && typeof raw === "object" && raw !== null && "error" in raw
          ? String((raw as Record<string, unknown>).error)
          : `Planning failed (${response.status})`;
      throw new AgentServiceError(errorMsg, response.status);
    }

    const raw = await parseJsonSafe(response);
    return normalizeAgentResponse(raw);
  } catch (err) {
    if (timedOut()) {
      throw new AgentServiceError("Planning request timed out");
    }
    if (err instanceof AgentServiceError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    throw new AgentServiceError("Planning request failed");
  } finally {
    cleanup();
  }
}

export async function executeAgentTask(
  request: AgentExecuteRequest,
  signal?: AbortSignal,
): Promise<AgentResponse> {
  const base = getAgentBaseUrl();
  const { controller, cleanup, timedOut } = createRequestController(
    signal,
    AGENT_TASK_TIMEOUT_MS,
  );

  try {
    const response = await fetch(`${base}/api/agent/execute`, {
      method: "POST",
      headers: await withTokenHeaders({
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!response.ok) {
      const raw = await parseJsonSafe(response).catch(() => null);
      const errorMsg =
        raw && typeof raw === "object" && raw !== null && "error" in raw
          ? String((raw as Record<string, unknown>).error)
          : `Execution failed (${response.status})`;
      throw new AgentServiceError(errorMsg, response.status);
    }

    const raw = await parseJsonSafe(response);
    return normalizeAgentResponse(raw);
  } catch (err) {
    if (timedOut()) {
      throw new AgentServiceError("Execution request timed out");
    }
    if (err instanceof AgentServiceError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    throw new AgentServiceError("Execution request failed");
  } finally {
    cleanup();
  }
}

function parseSseFrame(frame: string): AgentStreamEvent | null {
  let type = "message";
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("event:")) type = line.slice(6).trim() || "message";
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  try {
    const raw: unknown = JSON.parse(dataLines.join("\n"));
    return {
      type,
      data:
        typeof raw === "object" && raw !== null && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : { value: raw },
    };
  } catch {
    throw new AgentServiceError("Agent stream returned malformed JSON");
  }
}

export async function executeAgentTaskStream(
  request: AgentExecuteRequest,
  onEvent: (event: AgentStreamEvent) => void,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<AgentResponse> {
  const base = getAgentBaseUrl();
  const { controller, cleanup, timedOut } = createRequestController(signal, timeoutMs);

  try {
    const response = await fetch(`${base}/api/agent/execute/stream`, {
      method: "POST",
      headers: await withTokenHeaders({
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new AgentServiceError(`Streaming execution failed (${response.status})`, response.status);
    }
    if (!response.body) {
      throw new AgentServiceError("Agent stream is unavailable");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResponse: AgentResponse | null = null;

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const event = parseSseFrame(frame);
        if (!event) continue;
        if (event.type === "error") {
          throw new AgentServiceError(String(event.data.error ?? "Agent streaming execution failed"));
        }
        if (event.type === "complete") {
          finalResponse = normalizeAgentResponse(event.data);
        } else {
          onEvent(event);
        }
      }
      if (done) break;
    }

    if (buffer.trim()) {
      const event = parseSseFrame(buffer);
      if (event?.type === "error") {
        throw new AgentServiceError(String(event.data.error ?? "Agent streaming execution failed"));
      }
      if (event?.type === "complete") finalResponse = normalizeAgentResponse(event.data);
      else if (event) onEvent(event);
    }
    if (!finalResponse) throw new AgentServiceError("Agent stream ended without a final response");
    return finalResponse;
  } catch (err) {
    if (timedOut()) throw new AgentServiceError("Execution request timed out");
    if (err instanceof AgentServiceError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new AgentServiceError("Streaming execution request failed");
  } finally {
    cleanup();
  }
}
