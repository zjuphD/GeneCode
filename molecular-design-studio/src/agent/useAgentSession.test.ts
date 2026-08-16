import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAgentSession } from "./useAgentSession";
import type { SequenceDocument } from "../types";
import { AgentServiceError } from "./service";
import type { AgentConversationHistoryEntry } from "./conversationHistory";

// Mock the service module
vi.mock("./service", () => ({
  checkAgentHealth: vi.fn(),
  planAgentTask: vi.fn(),
  executeAgentTask: vi.fn(),
  executeAgentTaskStream: vi.fn(),
  cancelAgentTask: vi.fn(),
  buildDocumentSnapshot: vi.fn((doc: unknown, workspace = "cloning", selection: unknown = null) => ({
    lastWorkbenchPage: workspace,
    currentSequenceDocument: { name: (doc as SequenceDocument).name, sequence: "", circular: false, featureSummary: [] },
    currentSelection: selection,
    formState: { cloning: { vectorSequence: "", vectorTopology: "linear", vectorLabel: (doc as SequenceDocument).name } },
  })),
  AgentServiceError: class AgentServiceError extends Error {
    constructor(message: string, status?: number) {
      super(message);
      this.name = "AgentServiceError";
      this.status = status;
    }
    status?: number;
  },
}));

vi.mock("./launcher", () => ({
  ensureLocalAgentService: vi.fn(),
}));

vi.mock("./sessionPersistence", () => ({
  loadAgentSession: vi.fn(),
  saveAgentSession: vi.fn(),
  clearPersistedAgentSession: vi.fn(),
}));

import {
  checkAgentHealth,
  planAgentTask,
  executeAgentTaskStream as executeAgentTask,
  cancelAgentTask,
} from "./service";
import { ensureLocalAgentService } from "./launcher";
import { loadAgentSession } from "./sessionPersistence";

function makeDoc(overrides: Partial<SequenceDocument> = {}): SequenceDocument {
  return {
    name: "test_seq",
    sequence: "ATCGATCGATCGATCG",
    circular: false,
    features: [],
    ...overrides,
  };
}

const PLAN_RESPONSE_READY = {
  messages: [],
  plan: [{ label: "Step 1", tool: "analyze", status: "pending", summary: "" }],
  runLog: [],
  workspace: "cloning",
  readyToExecute: true,
  draft: { type: "cloning", data: {} },
  agentRun: { runId: "run-1", status: "planning" },
  llmStatus: null,
  recommendation: null,
  resultCount: null,
  candidates: [],
  sequencePatch: undefined,
};

const EXECUTE_RESPONSE = {
  messages: ["Done"],
  plan: [{ label: "Step 1", tool: "analyze", status: "completed", summary: "ok" }],
  runLog: [{ step: "1", tool: "t", status: "ok", message: "ok" }],
  workspace: "cloning",
  readyToExecute: false,
  draft: null,
  agentRun: { runId: "run-1", status: "completed" },
  llmStatus: null,
  recommendation: { title: "Rec", summary: "", risks: [], confidence: 80 },
  resultCount: 3,
  candidates: [
    {
      title: null,
      summary: null,
      forwardPrimer: "ATGCGATCG",
      reversePrimer: "GCTAGCTAG",
      tmForward: 62.5,
      tmReverse: 61.3,
      gcForward: 52.9,
      gcReverse: 47.1,
      fullLengthForward: 31,
      fullLengthReverse: 32,
      insertLength: 1500,
      tmDelta: 1.2,
      crossDimer: false,
      annealTemp: 58,
      extensionSec: 90,
    },
  ],
  sequencePatch: undefined,
};

describe("useAgentSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadAgentSession).mockReturnValue(null);
    vi.mocked(ensureLocalAgentService).mockResolvedValue({
      status: "skipped",
      owned: false,
      message: "Browser mode",
      baseUrl: "http://127.0.0.1:8000",
    });
    vi.mocked(checkAgentHealth).mockResolvedValue({ status: "online", label: "Online" });
  });

  /** Wait for the health check to settle so the hook is online. */
  async function waitForOnline(result: { current: { serviceStatus: string } }) {
    // The health check is started by an effect and resolves asynchronously.
    // Waiting on the observable state keeps the update inside Testing
    // Library's act boundary instead of relying on an empty act flush (which
    // left a late state update and noisy warnings in the test output).
    await waitFor(() => {
      expect(result.current.serviceStatus).toBe("online");
    });
  }

  it("starts with checking status and performs health check on mount", async () => {
    const { result } = renderHook(() => useAgentSession());
    expect(result.current.serviceStatus).toBe("starting");

    await waitForOnline(result);
    expect(ensureLocalAgentService).toHaveBeenCalledTimes(1);
    expect(checkAgentHealth).toHaveBeenCalledTimes(1);
  });

  it("sets offline status when local service launch fails", async () => {
    vi.mocked(ensureLocalAgentService).mockResolvedValue({
      status: "unavailable",
      owned: false,
      message: "Cannot find local Agent service script",
      baseUrl: "http://127.0.0.1:8000",
    });

    const { result } = renderHook(() => useAgentSession());

    await waitFor(() => {
      expect(result.current.serviceStatus).toBe("offline");
      expect(result.current.healthLabel).toBe("Cannot find local Agent service script");
    });
    expect(checkAgentHealth).not.toHaveBeenCalled();
  });

  it("runs health after the launcher starts the service", async () => {
    vi.mocked(ensureLocalAgentService).mockResolvedValue({
      status: "started",
      owned: true,
      message: "Started local Agent service",
      baseUrl: "http://127.0.0.1:8000",
    });

    const { result } = renderHook(() => useAgentSession());

    await waitForOnline(result);
    expect(ensureLocalAgentService).toHaveBeenCalledTimes(1);
    expect(checkAgentHealth).toHaveBeenCalledTimes(1);
  });

  it("sets offline status when health check fails", async () => {
    vi.mocked(checkAgentHealth).mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useAgentSession());

    await waitFor(() => {
      expect(result.current.serviceStatus).toBe("offline");
      expect(result.current.healthLabel).toBe("Unreachable");
    });
  });

  it("checkHealth retries the health check", async () => {
    const { result } = renderHook(() => useAgentSession());
    await waitForOnline(result);

    vi.mocked(checkAgentHealth).mockRejectedValueOnce(new Error("down"));

    await act(async () => {
      result.current.checkHealth();
    });

    await waitFor(() => {
      expect(result.current.serviceStatus).toBe("offline");
      expect(checkAgentHealth).toHaveBeenCalledTimes(2);
    });
  });

  describe("health polling backoff (A-OBS-001)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // Clear any once-queues so the rejection sequence below is deterministic
      // and does not leak into later describe blocks.
      vi.mocked(checkAgentHealth).mockReset();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("backs off 1s → 5s → 30s on repeated failures and resets on success", async () => {
      vi.mocked(checkAgentHealth)
        .mockRejectedValueOnce(new Error("down-1"))
        .mockRejectedValueOnce(new Error("down-2"))
        .mockRejectedValueOnce(new Error("down-3"))
        .mockResolvedValue({ status: "online", label: "Online" });

      renderHook(() => useAgentSession());
      // Flush the mount-time performHealthCheck promise chain.
      await act(async () => {});
      // Mount: only performHealthCheck fires (one synchronous call).
      expect(checkAgentHealth).toHaveBeenCalledTimes(1);

      // Healthy cadence is 30s: first poll at +30s fails → probe at 1s.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(checkAgentHealth).toHaveBeenCalledTimes(2);

      // Failure probe at +1s → next probe at 5s.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(checkAgentHealth).toHaveBeenCalledTimes(3);

      // Nothing fires at 1s while the 5s probe is pending.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(checkAgentHealth).toHaveBeenCalledTimes(3);

      // +4s more (5s total) → third failure → settles at 30s.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });
      expect(checkAgentHealth).toHaveBeenCalledTimes(4);

      // Success resets the cadence to 30s.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(checkAgentHealth).toHaveBeenCalledTimes(5);
    });
  });

  describe("sendMessage", () => {
    it("appends user message immediately and sets phase to planning", async () => {
      vi.mocked(planAgentTask).mockImplementation(() => new Promise(() => {})); // never resolves

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      act(() => {
        result.current.sendMessage("Design primers", makeDoc());
      });

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]!.role).toBe("user");
      expect(result.current.messages[0]!.content).toBe("Design primers");
      expect(result.current.phase).toBe("planning");
    });

    it("sends sequence attachments as hidden context while keeping chat compact", async () => {
      vi.mocked(planAgentTask).mockResolvedValue(PLAN_RESPONSE_READY);
      const attachment = {
        name: "EGFP.gb",
        sequence: "ATGC".repeat(180),
        circular: false,
        featureCount: 1,
      };
      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      await act(async () => {
        result.current.sendMessage(
          "Insert this after APOBEC3A",
          makeDoc(),
          undefined,
          null,
          attachment,
          "Insert this after APOBEC3A\n附件：EGFP.gb · 720 bp",
        );
      });

      expect(result.current.messages[0]!.content).toBe(
        "Insert this after APOBEC3A\n附件：EGFP.gb · 720 bp",
      );
      expect(result.current.messages[0]!.content).not.toContain(attachment.sequence);
      expect(result.current.messages[0]!.requestContent).toContain(attachment.sequence);
      const request = vi.mocked(planAgentTask).mock.calls[0]![0];
      expect(request.attachments).toEqual([attachment]);

      await act(async () => {
        result.current.sendMessage("Use P2A", makeDoc());
      });
      const followUp = vi.mocked(planAgentTask).mock.calls[1]![0];
      expect(followUp.history[0]!.content).toBe(
        "Insert this after APOBEC3A\n附件：EGFP.gb · 720 bp",
      );
      expect(followUp.history[0]!.contextContent).toContain(attachment.sequence);
    });

    it("cancels an in-flight planning request and returns to idle", async () => {
      let requestSignal: AbortSignal | undefined;
      vi.mocked(planAgentTask).mockImplementation((_request, signal) => {
        requestSignal = signal;
        return new Promise(() => {});
      });

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      act(() => {
        result.current.sendMessage("Design primers", makeDoc());
      });
      expect(result.current.phase).toBe("planning");

      act(() => {
        result.current.cancelRequest();
      });

      expect(requestSignal?.aborted).toBe(true);
      expect(result.current.phase).toBe("idle");
      expect(result.current.error).toBeNull();
      expect(result.current.messages[result.current.messages.length - 1]?.content).toBe("已停止当前操作。");
    });

    it("forwards the run id to the server cancel endpoint (A-AGT-003)", async () => {
      vi.mocked(planAgentTask).mockResolvedValue(PLAN_RESPONSE_READY);
      // Keep the execute stream pending so the run stays cancellable.
      vi.mocked(executeAgentTask).mockImplementation(
        () => new Promise<never>(() => {}),
      );

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      await act(async () => {
        result.current.sendMessage("Design primers", makeDoc());
      });
      expect(result.current.agentRun.runId).toBe("run-1");
      expect(result.current.readyToExecute).toBe(true);

      act(() => {
        result.current.executeDesign(makeDoc());
      });
      expect(result.current.phase).toBe("executing");

      act(() => {
        result.current.cancelRequest();
      });

      // Stop must reach the backend, not just abort the client fetch.
      expect(cancelAgentTask).toHaveBeenCalledWith("run-1");
      expect(result.current.phase).toBe("idle");
    });

    it("does not fire cancelAgentTask when there is no run id", async () => {
      let requestSignal: AbortSignal | undefined;
      vi.mocked(planAgentTask).mockImplementation((_request, signal) => {
        requestSignal = signal;
        return new Promise(() => {});
      });

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      act(() => {
        result.current.sendMessage("Design primers", makeDoc());
      });
      act(() => {
        result.current.cancelRequest();
      });

      expect(cancelAgentTask).not.toHaveBeenCalled();
      expect(requestSignal?.aborted).toBe(true);
    });

    it("does not send when phase is not idle", async () => {
      vi.mocked(planAgentTask).mockImplementation(() => new Promise(() => {}));

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      act(() => {
        result.current.sendMessage("first", makeDoc());
      });
      expect(result.current.phase).toBe("planning");

      act(() => {
        result.current.sendMessage("second", makeDoc());
      });
      expect(planAgentTask).toHaveBeenCalledTimes(1);
    });

    it("appends assistant messages on successful plan", async () => {
      vi.mocked(planAgentTask).mockResolvedValue({
        messages: ["I can help with that."],
        plan: [{ label: "Step 1", tool: "analyze", status: "pending", summary: "" }],
        runLog: [],
        workspace: "cloning",
        readyToExecute: false,
        draft: null,
        agentRun: { runId: null, status: null },
        llmStatus: null,
        recommendation: null,
        resultCount: null,
        candidates: [],
        sequencePatch: undefined,
      });

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      await act(async () => {
        result.current.sendMessage("Design primers", makeDoc());
      });

      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[0]!.role).toBe("user");
      expect(result.current.messages[1]!.role).toBe("assistant");
      expect(result.current.messages[1]!.content).toBe("I can help with that.");
      expect(result.current.plan).toHaveLength(1);
      expect(result.current.phase).toBe("idle");
    });

    it("refreshes the displayed model label from an Agent response", async () => {
      vi.mocked(planAgentTask).mockResolvedValue({
        ...PLAN_RESPONSE_READY,
        llmStatus: { label: "", message: "已配置 MiMo · mimo-v2.5-pro" },
      });

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      await act(async () => {
        result.current.sendMessage("Plan this task", makeDoc());
      });

      expect(result.current.healthLabel).toBe("已配置 MiMo · mimo-v2.5-pro");
    });

    it("stores draft and readyToExecute from plan response", async () => {
      vi.mocked(planAgentTask).mockResolvedValue(PLAN_RESPONSE_READY);

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      await act(async () => {
        result.current.sendMessage("test", makeDoc());
      });

      expect(result.current.draft).toEqual({ type: "cloning", data: {} });
      expect(result.current.readyToExecute).toBe(true);
      expect(result.current.agentRun.runId).toBe("run-1");
    });

    it("routes planning to the selected workspace", async () => {
      vi.mocked(planAgentTask).mockResolvedValue({
        ...PLAN_RESPONSE_READY,
        workspace: "sgrna",
        draft: { workspace: "sgrna", designPayload: {} },
      });

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      await act(async () => {
        result.current.sendMessage("design KO guides", makeDoc(), "sgrna");
      });

      expect(planAgentTask).toHaveBeenCalledTimes(1);
      expect(vi.mocked(planAgentTask).mock.calls[0]![0].workspace).toBe("sgrna");
      expect(vi.mocked(planAgentTask).mock.calls[0]![0].snapshot.lastWorkbenchPage).toBe("sgrna");
      expect(result.current.workspace).toBe("sgrna");
    });

    it("omits workspace when the unified Agent should route the task", async () => {
      vi.mocked(planAgentTask).mockResolvedValue({
        ...PLAN_RESPONSE_READY,
        workspace: "sirna",
        draft: { workspace: "sirna", designPayload: {} },
      });

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      await act(async () => {
        result.current.sendMessage("design siRNA duplexes", makeDoc());
      });

      const request = vi.mocked(planAgentTask).mock.calls[0]![0];
      expect(request.workspace).toBeUndefined();
      expect(request.snapshot.lastWorkbenchPage).toBe("cloning");
      expect(result.current.workspace).toBe("sirna");
    });

    it("does not merge draft parameters across automatically detected task types", async () => {
      vi.mocked(planAgentTask)
        .mockResolvedValueOnce({
          ...PLAN_RESPONSE_READY,
          workspace: "rtqpcr",
          draft: { workspace: "rtqpcr", designPayload: { gene: "TP53" } },
        })
        .mockResolvedValueOnce({
          ...PLAN_RESPONSE_READY,
          workspace: "sgrna",
          draft: { workspace: "sgrna", designPayload: { pam: "NGG" } },
        });

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      await act(async () => {
        result.current.sendMessage("design RT-qPCR primers", makeDoc());
      });
      expect(result.current.workspace).toBe("rtqpcr");

      await act(async () => {
        result.current.sendMessage("now design sgRNAs", makeDoc());
      });

      expect(result.current.draft).toEqual({
        workspace: "sgrna",
        designPayload: { pam: "NGG" },
      });
    });

    it("leaves user message visible on plan failure", async () => {
      vi.mocked(planAgentTask).mockRejectedValue(new Error("Planning failed"));

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      await act(async () => {
        result.current.sendMessage("Design primers", makeDoc());
      });

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]!.role).toBe("user");
      expect(result.current.error).toBe("Planning failed");
      expect(result.current.phase).toBe("idle");
    });

    it("stores sequencePatch from plan response", async () => {
      const patch = { schemaVersion: 1, id: "p1", operations: [] };
      vi.mocked(planAgentTask).mockResolvedValue({
        messages: [],
        plan: [],
        runLog: [],
        workspace: "cloning",
        readyToExecute: false,
        draft: null,
        agentRun: { runId: null, status: null },
        llmStatus: null,
        recommendation: null,
        resultCount: null,
        candidates: [],
        sequencePatch: patch,
      });

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      await act(async () => {
        result.current.sendMessage("test", makeDoc());
      });

      expect(result.current.sequencePatch).toBe(patch);
    });
  });

  describe("executeDesign", () => {
    it("does nothing without a draft", async () => {
      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      act(() => {
        result.current.executeDesign(makeDoc());
      });

      expect(executeAgentTask).not.toHaveBeenCalled();
    });

    it("does nothing when readyToExecute is false even with a draft", async () => {
      vi.mocked(planAgentTask).mockResolvedValue({
        messages: [],
        plan: [],
        runLog: [],
        workspace: "cloning",
        readyToExecute: false,
        draft: { type: "cloning" },
        agentRun: { runId: null, status: null },
        llmStatus: null,
        recommendation: null,
        resultCount: null,
        candidates: [],
        sequencePatch: undefined,
      });

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      await act(async () => {
        result.current.sendMessage("test", makeDoc());
      });

      expect(result.current.draft).not.toBeNull();
      expect(result.current.readyToExecute).toBe(false);

      vi.mocked(executeAgentTask).mockClear();

      act(() => {
        result.current.executeDesign(makeDoc());
      });

      expect(executeAgentTask).not.toHaveBeenCalled();
    });

    it("calls executeAgentTask when draft and readyToExecute are set", async () => {
      vi.mocked(planAgentTask).mockResolvedValue(PLAN_RESPONSE_READY);
      vi.mocked(executeAgentTask).mockResolvedValue(EXECUTE_RESPONSE);

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      await act(async () => {
        result.current.sendMessage("test", makeDoc());
      });

      expect(result.current.draft).not.toBeNull();
      expect(result.current.readyToExecute).toBe(true);

      await act(async () => {
        result.current.executeDesign(makeDoc());
      });

      expect(executeAgentTask).toHaveBeenCalledTimes(1);
      expect(result.current.runLog).toHaveLength(1);
      expect(result.current.recommendation?.title).toBe("Rec");
      expect(result.current.resultCount).toBe(3);
      expect(result.current.readyToExecute).toBe(false);
      expect(result.current.phase).toBe("idle");
    });

    it("executes the workspace stored in the draft instead of the selected fallback", async () => {
      vi.mocked(planAgentTask).mockResolvedValue({
        ...PLAN_RESPONSE_READY,
        workspace: "rtqpcr",
        draft: { workspace: "rtqpcr", designPayload: {} },
      });
      vi.mocked(executeAgentTask).mockResolvedValue({
        ...EXECUTE_RESPONSE,
        workspace: "rtqpcr",
      });

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      await act(async () => {
        result.current.sendMessage("design RT primers", makeDoc(), "rtqpcr");
      });

      await act(async () => {
        result.current.executeDesign(makeDoc(), "cloning");
      });

      expect(executeAgentTask).toHaveBeenCalledTimes(1);
      expect(vi.mocked(executeAgentTask).mock.calls[0]![0].workspace).toBe("rtqpcr");
      expect(vi.mocked(executeAgentTask).mock.calls[0]![0].snapshot.lastWorkbenchPage).toBe("rtqpcr");
      expect(result.current.workspace).toBe("rtqpcr");
    });

    it("stores completed plan rows from execute response", async () => {
      vi.mocked(planAgentTask).mockResolvedValue(PLAN_RESPONSE_READY);
      vi.mocked(executeAgentTask).mockResolvedValue(EXECUTE_RESPONSE);

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      await act(async () => {
        result.current.sendMessage("test", makeDoc());
      });

      expect(result.current.plan[0]!.status).toBe("pending");

      await act(async () => {
        result.current.executeDesign(makeDoc());
      });

      // Plan rows should now reflect the completed status from execute
      expect(result.current.plan[0]!.status).toBe("completed");
    });

    it("stores candidates from execute response", async () => {
      vi.mocked(planAgentTask).mockResolvedValue(PLAN_RESPONSE_READY);
      vi.mocked(executeAgentTask).mockResolvedValue(EXECUTE_RESPONSE);

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      await act(async () => {
        result.current.sendMessage("test", makeDoc());
      });

      expect(result.current.candidates).toEqual([]);

      await act(async () => {
        result.current.executeDesign(makeDoc());
      });

      expect(result.current.candidates).toHaveLength(1);
      expect(result.current.candidates[0]!.forwardPrimer).toBe("ATGCGATCG");
      expect(result.current.candidates[0]!.tmForward).toBe(62.5);
    });
  });

  describe("clearSession", () => {
    it("resets all state", async () => {
      vi.mocked(planAgentTask).mockResolvedValue(PLAN_RESPONSE_READY);

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      await act(async () => {
        result.current.sendMessage("test", makeDoc());
      });

      expect(result.current.messages.length).toBeGreaterThan(0);

      act(() => {
        result.current.clearSession();
      });

      expect(result.current.messages).toHaveLength(0);
      expect(result.current.plan).toHaveLength(0);
      expect(result.current.draft).toBeNull();
      expect(result.current.readyToExecute).toBe(false);
      expect(result.current.phase).toBe("idle");
      expect(result.current.error).toBeNull();
    });
  });

  describe("restoreConversation", () => {
    it("restores a saved transcript so the next turn continues that conversation", async () => {
      vi.mocked(planAgentTask).mockResolvedValue(PLAN_RESPONSE_READY);

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      await act(async () => {
        result.current.sendMessage("old task", makeDoc());
      });
      expect(result.current.plan).toHaveLength(1);

      const entry: AgentConversationHistoryEntry = {
        id: "conv-restore",
        title: "Design RT-qPCR primers",
        workspace: "rtqpcr",
        agentMode: "review",
        timestamp: Date.now(),
        messages: [
          { role: "user", content: "Design RT-qPCR primers" },
          { role: "assistant", content: "Please provide the target gene." },
        ],
        runId: null,
      };

      act(() => {
        result.current.restoreConversation(entry);
      });

      expect(result.current.messages).toEqual(entry.messages);
      expect(result.current.workspace).toBe("rtqpcr");
      expect(result.current.agentMode).toBe("review");
      expect(result.current.lastUserGoal).toBe("Design RT-qPCR primers");
      expect(result.current.plan).toHaveLength(0);
      expect(result.current.draft).toBeNull();
      expect(result.current.candidates).toHaveLength(0);

      await act(async () => {
        result.current.sendMessage("The target is GAPDH", makeDoc());
      });

      const calls = vi.mocked(planAgentTask).mock.calls;
      const request = calls[calls.length - 1]?.[0];
      expect(request?.history).toEqual([
        { role: "user", content: "Design RT-qPCR primers" },
        { role: "assistant", content: "Please provide the target gene." },
      ]);
    });
  });

  describe("onDocumentHashChange", () => {
    it("clears draft/plan/results when hash changes after initial load", async () => {
      vi.mocked(planAgentTask).mockResolvedValue(PLAN_RESPONSE_READY);

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      // First hash (initial load — should be skipped)
      act(() => {
        result.current.onDocumentHashChange("hash-1");
      });
      expect(result.current.plan).toHaveLength(0);

      // Send a message to get state
      await act(async () => {
        result.current.sendMessage("test", makeDoc());
      });
      expect(result.current.plan).toHaveLength(1);
      expect(result.current.draft).not.toBeNull();

      // Hash changes (file open / OVE commit)
      act(() => {
        result.current.onDocumentHashChange("hash-2");
      });

      expect(result.current.plan).toHaveLength(0);
      expect(result.current.draft).toBeNull();
      expect(result.current.readyToExecute).toBe(false);
      expect(result.current.messages.some((m) => m.content.includes("Context changed"))).toBe(true);
    });

    it("does nothing when hash stays the same", async () => {
      vi.mocked(planAgentTask).mockResolvedValue({
        messages: [],
        plan: [{ label: "s", tool: "t", status: "ok", summary: "" }],
        runLog: [],
        workspace: "cloning",
        readyToExecute: false,
        draft: null,
        agentRun: { runId: null, status: null },
        llmStatus: null,
        recommendation: null,
        resultCount: null,
        candidates: [],
        sequencePatch: undefined,
      });

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      // Initial load
      act(() => {
        result.current.onDocumentHashChange("hash-1");
      });

      await act(async () => {
        result.current.sendMessage("test", makeDoc());
      });

      const planLen = result.current.plan.length;

      // Same hash — no change
      act(() => {
        result.current.onDocumentHashChange("hash-1");
      });

      expect(result.current.plan).toHaveLength(planLen);
    });

    it("does not add internal notices before a user has started a task", async () => {
      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      act(() => {
        result.current.onDocumentHashChange("hash-1");
        result.current.onDocumentHashChange("hash-2");
      });

      expect(result.current.messages).toEqual([]);
    });

    it("deduplicates consecutive context-change notices", async () => {
      vi.mocked(planAgentTask).mockResolvedValue(PLAN_RESPONSE_READY);

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      act(() => {
        result.current.onDocumentHashChange("hash-1");
      });
      await act(async () => {
        result.current.sendMessage("test", makeDoc());
      });

      act(() => {
        result.current.onDocumentHashChange("hash-2");
        result.current.onDocumentHashChange("hash-3");
      });

      const notices = result.current.messages.filter((message) =>
        message.content.includes("Context changed"),
      );
      expect(notices).toHaveLength(1);
    });

    it("clears candidates on document hash change", async () => {
      vi.mocked(planAgentTask).mockResolvedValue(PLAN_RESPONSE_READY);
      vi.mocked(executeAgentTask).mockResolvedValue(EXECUTE_RESPONSE);

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      // Initial hash
      act(() => {
        result.current.onDocumentHashChange("hash-1");
      });

      await act(async () => {
        result.current.sendMessage("test", makeDoc());
      });

      await act(async () => {
        result.current.executeDesign(makeDoc());
      });

      expect(result.current.candidates).toHaveLength(1);

      // Hash change should clear candidates
      act(() => {
        result.current.onDocumentHashChange("hash-2");
      });

      expect(result.current.candidates).toEqual([]);
      expect(result.current.resultCount).toBeNull();
    });
  });

  describe("sequencePatch handoff", () => {
    it("calls onSequencePatchReceived callback when set and patch is received", async () => {
      const patch = { schemaVersion: 1, id: "p1", operations: [] };
      vi.mocked(planAgentTask).mockResolvedValue({
        messages: [],
        plan: [],
        runLog: [],
        workspace: "cloning",
        readyToExecute: false,
        draft: null,
        agentRun: { runId: null, status: null },
        llmStatus: null,
        recommendation: null,
        resultCount: null,
        candidates: [],
        sequencePatch: patch,
      });

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      const handoff = vi.fn();
      act(() => {
        result.current.setOnSequencePatchReceived(handoff);
      });

      await act(async () => {
        result.current.sendMessage("test", makeDoc());
      });

      expect(handoff).toHaveBeenCalledWith(patch);
    });

    it("does not call callback when no patch in response", async () => {
      vi.mocked(planAgentTask).mockResolvedValue({
        messages: [],
        plan: [],
        runLog: [],
        workspace: "cloning",
        readyToExecute: false,
        draft: null,
        agentRun: { runId: null, status: null },
        llmStatus: null,
        recommendation: null,
        resultCount: null,
        candidates: [],
        sequencePatch: undefined,
      });

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      const handoff = vi.fn();
      act(() => {
        result.current.setOnSequencePatchReceived(handoff);
      });

      await act(async () => {
        result.current.sendMessage("test", makeDoc());
      });

      expect(handoff).not.toHaveBeenCalled();
    });
  });

  // ── Review 2 regression tests ────────────────────────────────

  describe("P0: failed replanning clears stale draft", () => {
    it("clears draft/readiness when second plan request fails", async () => {
      // First plan succeeds with a ready draft
      vi.mocked(planAgentTask).mockResolvedValueOnce(PLAN_RESPONSE_READY);

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      // Set initial hash so sendMessage doesn't get skipped as initial load
      act(() => {
        result.current.onDocumentHashChange("hash-1");
      });

      await act(async () => {
        result.current.sendMessage("first goal", makeDoc());
      });

      expect(result.current.draft).not.toBeNull();
      expect(result.current.readyToExecute).toBe(true);

      // Second plan rejects with AgentServiceError (so handleRequestError extracts the message)
      vi.mocked(planAgentTask).mockRejectedValueOnce(
        new AgentServiceError("replan failed"),
      );

      await act(async () => {
        result.current.sendMessage("second goal", makeDoc());
      });

      // The second user message and error remain visible
      expect(result.current.messages.some((m) => m.content === "second goal")).toBe(true);
      expect(result.current.error).toBe("replan failed");

      // Draft is null and readyToExecute is false
      expect(result.current.draft).toBeNull();
      expect(result.current.readyToExecute).toBe(false);

      // executeDesign does nothing
      vi.mocked(executeAgentTask).mockClear();
      act(() => {
        result.current.executeDesign(makeDoc());
      });
      expect(executeAgentTask).not.toHaveBeenCalled();
    });
  });

  describe("P0: late responses after context invalidation are ignored", () => {
    it("discards a late plan response after document hash change", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let resolvePlan!: (v: any) => void;
      vi.mocked(planAgentTask).mockImplementation(
        () => new Promise((r) => { resolvePlan = r; }),
      );

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      // Set initial hash (skipped as initial load)
      act(() => {
        result.current.onDocumentHashChange("hash-1");
      });

      // Start a plan request (pending)
      act(() => {
        result.current.sendMessage("goal", makeDoc());
      });
      expect(result.current.phase).toBe("planning");

      // Document changes — should clear and invalidate
      act(() => {
        result.current.onDocumentHashChange("hash-2");
      });
      expect(result.current.draft).toBeNull();

      // Now the late plan response resolves
      await act(async () => {
        resolvePlan(PLAN_RESPONSE_READY);
      });

      // State should NOT be restored — the generation was invalidated
      expect(result.current.draft).toBeNull();
      expect(result.current.readyToExecute).toBe(false);
      expect(result.current.phase).toBe("idle");
    });

    it("discards a late execute response after document hash change", async () => {
      // Set initial hash
      vi.mocked(planAgentTask).mockResolvedValueOnce(PLAN_RESPONSE_READY);

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      act(() => {
        result.current.onDocumentHashChange("hash-1");
      });

      await act(async () => {
        result.current.sendMessage("goal", makeDoc());
      });
      expect(result.current.readyToExecute).toBe(true);

      // Start execution (pending)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let resolveExec!: (v: any) => void;
      vi.mocked(executeAgentTask).mockImplementation(
        () => new Promise((r) => { resolveExec = r; }),
      );

      act(() => {
        result.current.executeDesign(makeDoc());
      });
      expect(result.current.phase).toBe("executing");

      // Document changes
      act(() => {
        result.current.onDocumentHashChange("hash-2");
      });

      // Late execute response resolves
      await act(async () => {
        resolveExec(EXECUTE_RESPONSE);
      });

      // Results should not be applied
      expect(result.current.runLog).toHaveLength(0);
      expect(result.current.recommendation).toBeNull();
    });

    it("suppresses cancellation error from plan abort", async () => {
      // Use a deferred promise that we reject with AbortError
      let rejectPlan!: (err: unknown) => void;
      vi.mocked(planAgentTask).mockImplementation(
        () => new Promise((_r, rej) => { rejectPlan = rej; }),
      );

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      // Set initial hash
      act(() => {
        result.current.onDocumentHashChange("hash-1");
      });

      // Start a plan request
      act(() => {
        result.current.sendMessage("goal", makeDoc());
      });
      expect(result.current.phase).toBe("planning");

      // Context invalidation aborts and clears
      act(() => {
        result.current.onDocumentHashChange("hash-2");
      });

      // Late rejection arrives (from the abort)
      await act(async () => {
        rejectPlan(new DOMException("The operation was aborted", "AbortError"));
      });

      // No error should be shown — it was a cancellation
      expect(result.current.error).toBeNull();
      expect(result.current.phase).toBe("idle");
    });

    it("suppresses cancellation error from direct AbortError rejection", async () => {
      vi.mocked(planAgentTask).mockRejectedValue(
        new DOMException("The operation was aborted", "AbortError"),
      );

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      await act(async () => {
        result.current.sendMessage("goal", makeDoc());
      });

      // The cancellation error should not appear as a user-visible error
      expect(result.current.error).toBeNull();
      expect(result.current.phase).toBe("idle");
    });
  });

  // ── Selection passthrough tests ────────────────────────────────

  describe("selection passthrough", () => {
    it("planning request carries the latest selection", async () => {
      vi.mocked(planAgentTask).mockResolvedValue(PLAN_RESPONSE_READY);

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      const selection = {
        start: 10,
        end: 21,
        length: 11,
        wrapsOrigin: false,
        sequence: "ATCGATCGATC",
      };

      await act(async () => {
        result.current.sendMessage("test", makeDoc(), "cloning", selection);
      });

      expect(planAgentTask).toHaveBeenCalledTimes(1);
      const call = vi.mocked(planAgentTask).mock.calls[0]![0];
      expect(call.snapshot.currentSelection).toEqual({
        start: 10,
        end: 21,
        length: 11,
        wrapsOrigin: false,
        sequence: "ATCGATCGATC",
      });
    });

    it("planning request sends null selection when none provided", async () => {
      vi.mocked(planAgentTask).mockResolvedValue(PLAN_RESPONSE_READY);

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      await act(async () => {
        result.current.sendMessage("test", makeDoc());
      });

      expect(planAgentTask).toHaveBeenCalledTimes(1);
      const call = vi.mocked(planAgentTask).mock.calls[0]![0];
      expect(call.snapshot.currentSelection).toBeNull();
    });

    it("execution request carries the latest selection", async () => {
      vi.mocked(planAgentTask).mockResolvedValue(PLAN_RESPONSE_READY);
      vi.mocked(executeAgentTask).mockResolvedValue(EXECUTE_RESPONSE);

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      const selection = {
        start: 5,
        end: 10,
        length: 5,
        wrapsOrigin: false,
        sequence: "ATCGA",
      };

      await act(async () => {
        result.current.sendMessage("test", makeDoc(), "cloning", null);
      });

      await act(async () => {
        result.current.executeDesign(makeDoc(), "cloning", selection);
      });

      expect(executeAgentTask).toHaveBeenCalledTimes(1);
      const call = vi.mocked(executeAgentTask).mock.calls[0]![0];
      expect(call.snapshot.currentSelection).toEqual({
        start: 5,
        end: 10,
        length: 5,
        wrapsOrigin: false,
        sequence: "ATCGA",
      });
    });
  });

  // ── Planning-stage runLog preservation ─────────────────────────

  describe("planning-stage runLog preservation", () => {
    it("preserves runLog from planning response", async () => {
      vi.mocked(planAgentTask).mockResolvedValue({
        messages: [],
        plan: [{ label: "Step 1", tool: "analyze", status: "pending", summary: "" }],
        runLog: [{ step: "1", tool: "context_probe", status: "success", message: "read sequence" }],
        workspace: "cloning",
        readyToExecute: false,
        draft: null,
        agentRun: { runId: null, status: null },
        llmStatus: null,
        recommendation: null,
        resultCount: null,
        candidates: [],
        sequencePatch: undefined,
      });

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      expect(result.current.runLog).toHaveLength(0);

      await act(async () => {
        result.current.sendMessage("test", makeDoc());
      });

      expect(result.current.runLog).toHaveLength(1);
      expect(result.current.runLog[0]!.tool).toBe("context_probe");
      expect(result.current.runLog[0]!.status).toBe("success");
    });

    it("clears runLog at start of sendMessage to avoid stale data", async () => {
      // First call returns runLog
      vi.mocked(planAgentTask).mockResolvedValueOnce({
        messages: [],
        plan: [],
        runLog: [{ step: "1", tool: "probe", status: "success", message: "ok" }],
        workspace: "cloning",
        readyToExecute: false,
        draft: null,
        agentRun: { runId: null, status: null },
        llmStatus: null,
        recommendation: null,
        resultCount: null,
        candidates: [],
        sequencePatch: undefined,
      });

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      await act(async () => {
        result.current.sendMessage("first", makeDoc());
      });

      expect(result.current.runLog).toHaveLength(1);

      // Second call: sendMessage clears runLog, then new response sets it
      vi.mocked(planAgentTask).mockResolvedValueOnce({
        messages: [],
        plan: [],
        runLog: [],
        workspace: "cloning",
        readyToExecute: false,
        draft: null,
        agentRun: { runId: null, status: null },
        llmStatus: null,
        recommendation: null,
        resultCount: null,
        candidates: [],
        sequencePatch: undefined,
      });

      await act(async () => {
        result.current.sendMessage("second", makeDoc());
      });

      // runLog is cleared by sendMessage and the new response had empty runLog
      expect(result.current.runLog).toHaveLength(0);
    });
  });

  // ── Auto mode: skip the Confirm-and-run step ──────────────────

  describe("auto mode auto-execution", () => {
    it("auto-executes a ready plan in auto mode without a click", async () => {
      vi.mocked(planAgentTask).mockResolvedValue(PLAN_RESPONSE_READY);
      vi.mocked(executeAgentTask).mockResolvedValue(EXECUTE_RESPONSE);

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      act(() => {
        result.current.setAgentMode("auto");
      });

      await act(async () => {
        result.current.sendMessage("design primers", makeDoc());
      });

      // The ready plan executed automatically — no manual executeDesign call.
      expect(executeAgentTask).toHaveBeenCalledTimes(1);
      expect(result.current.phase).toBe("idle");
      expect(result.current.recommendation?.title).toBe("Rec");
      expect(result.current.readyToExecute).toBe(false);
    });

    it("does not auto-execute in plan mode", async () => {
      vi.mocked(planAgentTask).mockResolvedValue(PLAN_RESPONSE_READY);
      vi.mocked(executeAgentTask).mockResolvedValue(EXECUTE_RESPONSE);

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      await act(async () => {
        result.current.sendMessage("design primers", makeDoc());
      });

      expect(result.current.readyToExecute).toBe(true);
      expect(executeAgentTask).not.toHaveBeenCalled();
    });

    it("does not auto-execute a conversation-only plan", async () => {
      vi.mocked(planAgentTask).mockResolvedValue({
        ...PLAN_RESPONSE_READY,
        readyToExecute: false,
        conversationOnly: true,
      });
      vi.mocked(executeAgentTask).mockResolvedValue(EXECUTE_RESPONSE);

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      act(() => {
        result.current.setAgentMode("auto");
      });

      await act(async () => {
        result.current.sendMessage("tell me about primers", makeDoc());
      });

      expect(result.current.conversationOnly).toBe(true);
      expect(executeAgentTask).not.toHaveBeenCalled();
    });

    it("does not auto-execute when the plan needs blocking user input", async () => {
      vi.mocked(planAgentTask).mockResolvedValue({
        ...PLAN_RESPONSE_READY,
        taskConfirmation: {
          taskType: "cloning",
          canProceed: false,
          confidence: null,
          blockers: [{ key: "insertSequence", label: "Insert sequence is missing" }],
          missingParameters: [],
          assumptions: [],
          warnings: [],
          extractedParameters: {},
          requiresConfirmation: true,
        },
      });
      vi.mocked(executeAgentTask).mockResolvedValue(EXECUTE_RESPONSE);

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      act(() => {
        result.current.setAgentMode("auto");
      });

      await act(async () => {
        result.current.sendMessage("clone this", makeDoc());
      });

      expect(result.current.readyToExecute).toBe(true);
      expect(executeAgentTask).not.toHaveBeenCalled();
    });

    it("does not auto-execute a restored session even when readyToExecute is true", async () => {
      // A restored session may carry readyToExecute true, but no fresh
      // sendMessage armed auto-execution this session — it must not run.
      vi.mocked(loadAgentSession).mockReturnValue({
        version: 1,
        savedAt: 1,
        contextHash: "hash-1",
        messages: [],
        plan: [{ label: "Step 1", tool: "analyze", status: "pending", summary: "" }],
        draft: { type: "cloning", data: {} },
        readyToExecute: true,
        runLog: [],
        timeline: [],
        recommendation: null,
        artifactPackage: null,
        taskConfirmation: null,
        resultCount: null,
        candidates: [],
        agentRun: { runId: null, status: null },
        workspace: "cloning",
        lastUserGoal: "restored goal",
        planSnapshotHash: "hash-1",
        agentMode: "auto",
        planProvenance: null,
      });
      vi.mocked(executeAgentTask).mockResolvedValue(EXECUTE_RESPONSE);

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      expect(result.current.agentMode).toBe("auto");
      expect(result.current.readyToExecute).toBe(true);
      expect(executeAgentTask).not.toHaveBeenCalled();
    });

    it("does not re-auto-execute after an execution failure (armed guard consumed)", async () => {
      vi.mocked(planAgentTask).mockResolvedValue(PLAN_RESPONSE_READY);
      vi.mocked(executeAgentTask).mockRejectedValue(new Error("Execution failed"));

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      act(() => {
        result.current.setAgentMode("auto");
      });

      await act(async () => {
        result.current.sendMessage("design primers", makeDoc());
      });

      // One execution attempt; readyToExecute stays true (draft preserved for
      // manual retry) but the armed guard was consumed so no retry loop.
      expect(executeAgentTask).toHaveBeenCalledTimes(1);
      expect(result.current.error).toBe("Execution failed");
      expect(result.current.readyToExecute).toBe(true);

      // Flush any re-render cycles — still no second execution.
      await act(async () => {});
      expect(executeAgentTask).toHaveBeenCalledTimes(1);
    });

    it("auto-executes a second plan after a fresh sendMessage re-arms", async () => {
      vi.mocked(planAgentTask)
        .mockResolvedValueOnce(PLAN_RESPONSE_READY)
        .mockResolvedValueOnce(PLAN_RESPONSE_READY);
      vi.mocked(executeAgentTask).mockResolvedValue(EXECUTE_RESPONSE);

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      act(() => {
        result.current.setAgentMode("auto");
      });

      await act(async () => {
        result.current.sendMessage("first goal", makeDoc());
      });
      expect(executeAgentTask).toHaveBeenCalledTimes(1);

      await act(async () => {
        result.current.sendMessage("second goal", makeDoc());
      });
      expect(executeAgentTask).toHaveBeenCalledTimes(2);
    });

    it("auto-executes with the document and selection captured at send time", async () => {
      vi.mocked(planAgentTask).mockResolvedValue(PLAN_RESPONSE_READY);
      vi.mocked(executeAgentTask).mockResolvedValue(EXECUTE_RESPONSE);

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      act(() => {
        result.current.setAgentMode("auto");
      });

      const doc = makeDoc({ name: "captured_doc", sequence: "GGGGCCCC" });
      const selection = {
        start: 2,
        end: 6,
        length: 4,
        wrapsOrigin: false,
        sequence: "GGCC",
      };
      await act(async () => {
        result.current.sendMessage("design from selection", doc, "cloning", selection);
      });

      expect(executeAgentTask).toHaveBeenCalledTimes(1);
      const request = vi.mocked(executeAgentTask).mock.calls[0]![0];
      expect(request.snapshot.currentSequenceDocument.name).toBe("captured_doc");
      expect(request.snapshot.currentSelection).toEqual(selection);
    });

    it("auto-executes a ready plan when the user switches from plan to auto mode", async () => {
      // A plan arrives ready while in plan mode (armed by sendMessage but not
      // fired because agentMode was not auto); switching to Auto executes it.
      vi.mocked(planAgentTask).mockResolvedValue(PLAN_RESPONSE_READY);
      vi.mocked(executeAgentTask).mockResolvedValue(EXECUTE_RESPONSE);

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      await act(async () => {
        result.current.sendMessage("design primers", makeDoc());
      });
      expect(result.current.readyToExecute).toBe(true);
      expect(executeAgentTask).not.toHaveBeenCalled();

      act(() => {
        result.current.setAgentMode("auto");
      });

      // Setting Auto starts execution in an effect. Wait for the mocked
      // response to settle so its state updates remain inside an act boundary.
      await waitFor(() => {
        expect(executeAgentTask).toHaveBeenCalledTimes(1);
        expect(result.current.recommendation?.title).toBe("Rec");
      });
    });

    it("auto-executes when the plan has only notes (non-blocking taskConfirmation)", async () => {
      vi.mocked(planAgentTask).mockResolvedValue({
        ...PLAN_RESPONSE_READY,
        taskConfirmation: {
          taskType: "cloning",
          canProceed: true,
          confidence: 80,
          blockers: [],
          missingParameters: [],
          assumptions: [{ key: "keepFrame", label: "Assuming reading frame preserved" }],
          warnings: [{ key: "gibson", label: "Gibson arms > 20 nt recommended" }],
          extractedParameters: {},
          requiresConfirmation: false,
        },
      });
      vi.mocked(executeAgentTask).mockResolvedValue(EXECUTE_RESPONSE);

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      act(() => {
        result.current.setAgentMode("auto");
      });

      await act(async () => {
        result.current.sendMessage("clone this", makeDoc());
      });

      // Notes-only confirmation does not block the zero-interaction flow.
      expect(executeAgentTask).toHaveBeenCalledTimes(1);
    });

    it("keeps the Confirm button flow for plan mode unchanged", async () => {
      vi.mocked(planAgentTask).mockResolvedValue(PLAN_RESPONSE_READY);
      vi.mocked(executeAgentTask).mockResolvedValue(EXECUTE_RESPONSE);

      const { result } = renderHook(() => useAgentSession());
      await waitForOnline(result);

      await act(async () => {
        result.current.sendMessage("design primers", makeDoc());
      });

      // Still ready and NOT executed; a manual click runs it.
      expect(result.current.readyToExecute).toBe(true);
      expect(executeAgentTask).not.toHaveBeenCalled();

      await act(async () => {
        result.current.executeDesign(makeDoc());
      });
      expect(executeAgentTask).toHaveBeenCalledTimes(1);
    });
  });
});
