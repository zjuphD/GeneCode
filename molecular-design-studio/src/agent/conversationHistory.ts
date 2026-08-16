/**
 * User-visible Agent conversation history.
 *
 * Run history is intentionally result-oriented (plans, candidates, and
 * recommendations). This store keeps the visible chat transcript separately
 * so a conversation remains discoverable even when it ended during planning
 * or when no design candidate was produced.
 */

import type { AgentMode, AgentWorkspace } from "./service";

export interface AgentConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentConversationHistoryEntry {
  id: string;
  title: string;
  workspace: AgentWorkspace;
  agentMode: AgentMode;
  timestamp: number;
  messages: AgentConversationMessage[];
  runId: string | null;
}

interface PersistedConversationHistory {
  version: 1;
  entries: AgentConversationHistoryEntry[];
}

const CONVERSATION_HISTORY_KEY = "molecular-design-studio.agent-conversations.v1";
const MAX_HISTORY = 50;
const MAX_MESSAGES = 80;
export const CONVERSATION_HISTORY_UPDATED_EVENT =
  "molecular-design-studio:agent-conversation-history-updated";

function canPersist(): boolean {
  return typeof window !== "undefined" && import.meta.env.MODE !== "test";
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

function isMessage(value: unknown): value is AgentConversationMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.role === "user" || record.role === "assistant") &&
    typeof record.content === "string" &&
    record.content.trim().length > 0
  );
}

function normalizeEntry(value: unknown): AgentConversationHistoryEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.title !== "string" ||
    !isWorkspace(record.workspace) ||
    !isAgentMode(record.agentMode) ||
    typeof record.timestamp !== "number" ||
    !Number.isFinite(record.timestamp) ||
    !Array.isArray(record.messages)
  ) {
    return null;
  }
  const messages = record.messages.filter(isMessage).slice(-MAX_MESSAGES);
  if (messages.length === 0) return null;
  return {
    id: record.id,
    title: record.title.trim() || "未命名对话",
    workspace: record.workspace,
    agentMode: record.agentMode,
    timestamp: record.timestamp,
    messages,
    runId: typeof record.runId === "string" ? record.runId : null,
  };
}
export function loadConversationHistory(): AgentConversationHistoryEntry[] {
  if (!canPersist()) return [];
  try {
    const raw: unknown = JSON.parse(
      window.localStorage.getItem(CONVERSATION_HISTORY_KEY) ?? "null",
    );
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const value = raw as Partial<PersistedConversationHistory>;
    if (value.version !== 1 || !Array.isArray(value.entries)) return [];
    return value.entries
      .map(normalizeEntry)
      .filter((entry): entry is AgentConversationHistoryEntry => entry !== null)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

export function saveConversationHistoryEntry(
  entry: AgentConversationHistoryEntry,
): void {
  if (!canPersist() || entry.messages.length === 0) return;
  try {
    const existing = loadConversationHistory();
    const next = {
      ...entry,
      title: entry.title.trim() || "未命名对话",
      messages: entry.messages.slice(-MAX_MESSAGES),
    };
    const updated = [next, ...existing.filter((item) => item.id !== entry.id)]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_HISTORY);
    window.localStorage.setItem(
      CONVERSATION_HISTORY_KEY,
      JSON.stringify({ version: 1, entries: updated } satisfies PersistedConversationHistory),
    );
    window.dispatchEvent(new Event(CONVERSATION_HISTORY_UPDATED_EVENT));
  } catch {
    // Storage can be disabled or full; the live conversation remains usable.
  }
}

export function clearConversationHistory(): void {
  if (!canPersist()) return;
  try {
    window.localStorage.removeItem(CONVERSATION_HISTORY_KEY);
    window.dispatchEvent(new Event(CONVERSATION_HISTORY_UPDATED_EVENT));
  } catch {
    // Storage may be unavailable in private or restricted contexts.
  }
}

export function conversationTitle(
  goal: string,
  messages: AgentConversationMessage[],
): string {
  const source = goal.trim() || messages.find((message) => message.role === "user")?.content.trim() || "未命名对话";
  const normalized = source.replace(/\s+/g, " ");
  return normalized.length > 96 ? `${normalized.slice(0, 93)}…` : normalized;
}

export function buildConversationHistoryEntry(params: {
  id: string;
  goal: string;
  workspace: AgentWorkspace;
  agentMode: AgentMode;
  messages: AgentConversationMessage[];
  runId?: string | null;
}): AgentConversationHistoryEntry {
  const messages = params.messages
    .filter((message) => (message.role === "user" || message.role === "assistant") && message.content.trim())
    .map(({ role, content }) => ({ role, content: content.trim() } satisfies AgentConversationMessage))
    .slice(-MAX_MESSAGES);
  return {
    id: params.id,
    title: conversationTitle(params.goal, messages),
    workspace: params.workspace,
    agentMode: params.agentMode,
    timestamp: Date.now(),
    messages,
    runId: params.runId ?? null,
  };
}
