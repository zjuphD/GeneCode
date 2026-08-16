import type {
  AgentArtifactPackage,
  AgentRecommendation,
  AgentRunMeta,
  PlanProvenance,
  PlanRow,
  ResultCandidate,
  RunLogRow,
  TaskConfirmation,
  TimelineEvent,
} from "./responseTypes";
import type { AgentMode, AgentWorkspace } from "./service";

export const AGENT_SESSION_STORAGE_KEY =
  "molecular-design-studio.agent-session.v1";

function storageKey(sessionKey?: string): string {
  if (!sessionKey) return AGENT_SESSION_STORAGE_KEY;
  return `${AGENT_SESSION_STORAGE_KEY}.${encodeURIComponent(sessionKey)}`;
}

export interface PersistedConversationMessage {
  role: "user" | "assistant";
  content: string;
  requestContent?: string;
}

export interface PersistedAgentSession {
  version: 1;
  savedAt: number;
  /** Stable id for the visible conversation-history entry. */
  conversationId?: string;
  contextHash: string | null;
  messages: PersistedConversationMessage[];
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
  lastUserGoal: string;
  planSnapshotHash: string | null;
  agentMode: AgentMode;
  /** Plan provenance (llm / rules) — restored so the badge survives reloads. */
  planProvenance: PlanProvenance | null;
}

function defaultStorage(): Storage | null {
  try {
    if (import.meta.env.MODE === "test") return null;
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWorkspace(value: unknown): value is AgentWorkspace {
  return (
    value === "cloning" ||
    value === "rtqpcr" ||
    value === "sgrna" ||
    value === "sirna" ||
    value === "mutagenesis"
  );
}

function isAgentMode(value: unknown): value is AgentMode {
  return value === "review" || value === "plan" || value === "auto";
}

export function loadAgentSession(
  storage: Storage | null = defaultStorage(),
  sessionKey?: string,
): PersistedAgentSession | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey(sessionKey));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed) || parsed.version !== 1) return null;
    if (!Array.isArray(parsed.messages) || !Array.isArray(parsed.plan)) return null;
    if (!Array.isArray(parsed.runLog) || !Array.isArray(parsed.timeline)) return null;
    if (!Array.isArray(parsed.candidates)) return null;
    if (!isWorkspace(parsed.workspace) || !isAgentMode(parsed.agentMode)) return null;

    const planProvenance = isObject(parsed.planProvenance)
      ? (() => {
          const rawSource = parsed.planProvenance?.source;
          const source: PlanProvenance["source"] =
            rawSource === "llm" || rawSource === "rules" ? rawSource : null;
          return {
            source,
            validated: parsed.planProvenance?.validated === true,
            errors: Array.isArray(parsed.planProvenance?.errors)
              ? parsed.planProvenance.errors.filter((item): item is string => typeof item === "string")
              : [],
          };
        })()
      : null;

    return {
      ...(parsed as unknown as PersistedAgentSession),
      planProvenance,
      taskConfirmation: isObject(parsed.taskConfirmation)
        ? parsed.taskConfirmation as unknown as TaskConfirmation
        : null,
    };
  } catch {
    return null;
  }
}

export function saveAgentSession(
  session: PersistedAgentSession,
  storage: Storage | null = defaultStorage(),
  sessionKey?: string,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(storageKey(sessionKey), JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

export function clearPersistedAgentSession(
  storage: Storage | null = defaultStorage(),
  sessionKey?: string,
): void {
  try {
    storage?.removeItem(storageKey(sessionKey));
  } catch {
    // Storage may be unavailable in private or restricted contexts.
  }
}
