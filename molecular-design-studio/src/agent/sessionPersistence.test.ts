import { describe, expect, it } from "vitest";
import {
  AGENT_SESSION_STORAGE_KEY,
  clearPersistedAgentSession,
  loadAgentSession,
  saveAgentSession,
  type PersistedAgentSession,
} from "./sessionPersistence";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

function fixture(): PersistedAgentSession {
  return {
    version: 1,
    savedAt: 1,
    contextHash: "doc-hash",
    messages: [{ role: "user", content: "Design primers" }],
    plan: [],
    draft: { workspace: "cloning" },
    readyToExecute: true,
    runLog: [],
    timeline: [],
    recommendation: null,
    artifactPackage: null,
    taskConfirmation: null,
    resultCount: null,
    candidates: [],
    agentRun: { runId: "run_1", status: "ready" },
    workspace: "cloning",
    lastUserGoal: "Design primers",
    planSnapshotHash: "doc-hash",
    agentMode: "plan",
    planProvenance: null,
  };
}

describe("agent session persistence", () => {
  it("round-trips a valid session", () => {
    const storage = memoryStorage();
    const session = fixture();
    expect(saveAgentSession(session, storage)).toBe(true);
    expect(loadAgentSession(storage)).toEqual(session);
  });

  it("persists structured task confirmation controls", () => {
    const storage = memoryStorage();
    const session = fixture();
    session.taskConfirmation = {
      taskType: "cloning",
      canProceed: false,
      confidence: null,
      blockers: [],
      missingParameters: [{
        key: "expressionStrategy",
        label: "Choose an expression strategy",
        kind: "select",
        options: [{ value: "fusion", label: "Fusion protein" }],
      }],
      assumptions: [],
      warnings: [],
      extractedParameters: {},
      requiresConfirmation: true,
    };

    expect(saveAgentSession(session, storage)).toBe(true);
    expect(loadAgentSession(storage)?.taskConfirmation).toEqual(session.taskConfirmation);
  });

  it("rejects malformed or incompatible state", () => {
    const storage = memoryStorage();
    storage.setItem(AGENT_SESSION_STORAGE_KEY, "{bad json");
    expect(loadAgentSession(storage)).toBeNull();
    storage.setItem(AGENT_SESSION_STORAGE_KEY, JSON.stringify({ version: 2 }));
    expect(loadAgentSession(storage)).toBeNull();
  });

  it("clears the persisted session", () => {
    const storage = memoryStorage();
    saveAgentSession(fixture(), storage);
    clearPersistedAgentSession(storage);
    expect(loadAgentSession(storage)).toBeNull();
  });

  it("isolates sessions by sequence context", () => {
    const storage = memoryStorage();
    const first = fixture();
    const second = { ...fixture(), lastUserGoal: "Review insert", messages: [] };

    saveAgentSession(first, storage, "sequence-a");
    saveAgentSession(second, storage, "sequence-b");

    expect(loadAgentSession(storage, "sequence-a")?.lastUserGoal).toBe("Design primers");
    expect(loadAgentSession(storage, "sequence-b")?.lastUserGoal).toBe("Review insert");

    clearPersistedAgentSession(storage, "sequence-a");
    expect(loadAgentSession(storage, "sequence-a")).toBeNull();
    expect(loadAgentSession(storage, "sequence-b")?.lastUserGoal).toBe("Review insert");
  });
});
