import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getAgentBaseUrl,
  buildDocumentSnapshot,
  WORKSPACE_FORM_STATE_KEY,
  checkAgentHealth,
  testAgentLlmConnection,
  switchAgentModel,
  planAgentTask,
  executeAgentTask,
  executeAgentTaskStream,
  cancelAgentTask,
  getAgentApiToken,
  resetAgentApiTokenCache,
  AgentServiceError,
} from "./service";
import type { SequenceDocument } from "../types";

function makeDoc(overrides: Partial<SequenceDocument> = {}): SequenceDocument {
  return {
    name: "test_seq",
    sequence: "ATCGATCGATCGATCG",
    circular: false,
    features: [
      {
        id: "f1",
        name: "ampR",
        type: "gene",
        start: 0,
        end: 10,
        strand: 1,
        qualifiers: {},
      },
    ],
    accession: "ACC001",
    version: "1.0",
    ...overrides,
  };
}

describe("getAgentBaseUrl", () => {
  const originalEnv = import.meta.env.VITE_AGENT_API_BASE;

  afterEach(() => {
    import.meta.env.VITE_AGENT_API_BASE = originalEnv;
  });

  it("returns default localhost URL when env is empty", () => {
    import.meta.env.VITE_AGENT_API_BASE = "";
    expect(getAgentBaseUrl()).toBe("http://127.0.0.1:8000");
  });

  it("returns trimmed env URL without trailing slashes", () => {
    import.meta.env.VITE_AGENT_API_BASE = "  http://custom:9000/  ";
    expect(getAgentBaseUrl()).toBe("http://custom:9000");
  });

  it("strips multiple trailing slashes", () => {
    import.meta.env.VITE_AGENT_API_BASE = "http://custom:9000///";
    expect(getAgentBaseUrl()).toBe("http://custom:9000");
  });

  it("falls back to default when env is empty string", () => {
    import.meta.env.VITE_AGENT_API_BASE = "   ";
    expect(getAgentBaseUrl()).toBe("http://127.0.0.1:8000");
  });
});

describe("buildDocumentSnapshot", () => {
  it("produces the correct snapshot shape", () => {
    const doc = makeDoc();
    const snap = buildDocumentSnapshot(doc);

    expect(snap.lastWorkbenchPage).toBe("cloning");
    expect(snap.currentSequenceDocument.name).toBe("test_seq");
    expect(snap.currentSequenceDocument.sequence).toBe("ATCGATCGATCGATCG");
    expect(snap.currentSequenceDocument.circular).toBe(false);
    expect(snap.currentSequenceDocument.accession).toBe("ACC001");
    expect(snap.currentSequenceDocument.version).toBe("1.0");
    expect(snap.currentSequenceDocument.featureSummary).toHaveLength(1);
    expect(snap.currentSequenceDocument.featureSummary[0]!.name).toBe("ampR");

    expect(snap.formState.cloning.vectorSequence).toBe("ATCGATCGATCGATCG");
    expect(snap.formState.cloning.vectorTopology).toBe("linear");
    expect(snap.formState.cloning.vectorLabel).toBe("test_seq");
  });

  it("sets vectorTopology to circular when doc is circular", () => {
    const snap = buildDocumentSnapshot(makeDoc({ circular: true }));
    expect(snap.formState.cloning.vectorTopology).toBe("circular");
  });

  it("does not silently use the vector as the insert", () => {
    const snap = buildDocumentSnapshot(makeDoc());
    // The snapshot has vectorSequence but no insertSequence
    expect(snap.formState.cloning.vectorSequence).toBeTruthy();
    expect(snap).not.toHaveProperty("formState.cloning.insertSequence");
  });

  it("includes currentSelection as null when no selection is provided", () => {
    const snap = buildDocumentSnapshot(makeDoc());
    expect(snap.currentSelection).toBeNull();
  });

  it("includes currentSelection when selection is provided", () => {
    const doc = makeDoc();
    const selection = {
      start: 10,
      end: 21,
      length: 11,
      wrapsOrigin: false,
      sequence: "ATCGATCGATC",
    };
    const snap = buildDocumentSnapshot(doc, "cloning", selection);
    expect(snap.currentSelection).toEqual({
      start: 10,
      end: 21,
      length: 11,
      wrapsOrigin: false,
      sequence: "ATCGATCGATC",
    });
  });

  it("marks a zero-width insertion cursor without changing ordinary selections", () => {
    const snap = buildDocumentSnapshot(makeDoc(), "cloning", {
      start: 4,
      end: 4,
      length: 0,
      wrapsOrigin: false,
      sequence: "",
      cursor: true,
    });
    expect(snap.currentSelection).toEqual({
      start: 4,
      end: 4,
      length: 0,
      wrapsOrigin: false,
      sequence: "",
      cursor: true,
    });
  });

  it("builds sgRNA workspace context from the open sequence", () => {
    const snap = buildDocumentSnapshot(makeDoc(), "sgrna");
    expect(snap.lastWorkbenchPage).toBe("sgrna");
    expect(snap.formState.sg.sequence).toBe("ATCGATCGATCGATCG");
    expect(snap.formState.sg.label).toBe("test_seq");
    expect(snap.formState.sg.mode).toBe("ko");
    expect(snap.formState.sg.pamSet).toBe("spcas9_ngg");
  });

  it("builds RT-qPCR custom sequence context and defaults", () => {
    const snap = buildDocumentSnapshot(makeDoc(), "rtqpcr");
    expect(snap.lastWorkbenchPage).toBe("rtqpcr");
    expect(snap.formState.custom.sequence).toBe("ATCGATCGATCGATCG");
    expect(snap.formState.rt.query).toBe("");
    expect(snap.formState.rt.gdnaCheck).toBe(true);
    expect(snap.formState.rt.includeProbe).toBe(false);
  });

  it("builds mutagenesis workspace context from the open sequence", () => {
    const snap = buildDocumentSnapshot(makeDoc(), "mutagenesis");
    expect(snap.lastWorkbenchPage).toBe("mutagenesis");
    expect(snap.formState.mutation.sequence).toBe("ATCGATCGATCGATCG");
    expect(snap.formState.mutation.label).toBe("test_seq");
    expect(snap.formState.mutation.mode).toBe("dna");
    expect(snap.formState.mutation.cdsStart).toBe("1");
    expect(snap.formState.mutation.position).toBe("");
    expect(snap.formState.mutation.reference).toBe("");
    expect(snap.formState.mutation.alternate).toBe("");
  });

  it("deduplicates the open sequence across non-matching formState slots", () => {
    // The canonical copy lives in currentSequenceDocument.sequence and the
    // workspace-matching slot; all other slots must stay empty so a >100 kb
    // open document is not copied up to six times into the request body.
    const snap = buildDocumentSnapshot(makeDoc(), "cloning");
    expect(snap.currentSequenceDocument.sequence).toBe("ATCGATCGATCGATCG");
    expect(snap.formState.cloning.vectorSequence).toBe("ATCGATCGATCGATCG");
    expect(snap.formState.custom.sequence).toBe("");
    expect(snap.formState.sg.sequence).toBe("");
    expect(snap.formState.sirna.sequence).toBe("");
    expect(snap.formState.mutation.sequence).toBe("");
  });

  it("keeps the open sequence only in the workspace-matching slot per workspace", () => {
    const sgrnaSnap = buildDocumentSnapshot(makeDoc(), "sgrna");
    expect(sgrnaSnap.formState.sg.sequence).toBe("ATCGATCGATCGATCG");
    expect(sgrnaSnap.formState.cloning.vectorSequence).toBe("");
    expect(sgrnaSnap.formState.custom.sequence).toBe("");

    const rtqpcrSnap = buildDocumentSnapshot(makeDoc(), "rtqpcr");
    expect(rtqpcrSnap.formState.custom.sequence).toBe("ATCGATCGATCGATCG");
    expect(rtqpcrSnap.formState.sg.sequence).toBe("");
    expect(rtqpcrSnap.formState.cloning.vectorSequence).toBe("");

    const sirnaSnap = buildDocumentSnapshot(makeDoc(), "sirna");
    expect(sirnaSnap.formState.sirna.sequence).toBe("ATCGATCGATCGATCG");
    expect(sirnaSnap.formState.custom.sequence).toBe("");
    expect(sirnaSnap.formState.mutation.sequence).toBe("");
  });

  it("exposes the workspace-to-formState-key mapping for mutagenesis", () => {
    // P1-9: the mutagenesis workspace uses formState key "mutation" by design;
    // the mapping must stay explicit so the asymmetry is documented.
    expect(WORKSPACE_FORM_STATE_KEY.mutagenesis).toBe("mutation");
    expect(WORKSPACE_FORM_STATE_KEY.rtqpcr).toBe("custom");
    expect(WORKSPACE_FORM_STATE_KEY.sgrna).toBe("sg");
  });
});

describe("checkAgentHealth", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns online for {ok: true, llm: {message}} response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, llm: { message: "已连接 MiniMax · MiniMax-M2.7" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const health = await checkAgentHealth();
    expect(health.status).toBe("online");
    expect(health.label).toBe("已连接 MiniMax · MiniMax-M2.7");
  });

  it("returns online for {status: 'ok'} fallback", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "ok", label: "Healthy" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const health = await checkAgentHealth();
    expect(health.status).toBe("online");
    expect(health.label).toBe("Healthy");
  });

  it("throws on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 500, headers: { "content-type": "application/json" } }),
    );

    await expect(checkAgentHealth()).rejects.toThrow(AgentServiceError);
    await expect(checkAgentHealth()).rejects.toThrow("Health check failed (500)");
  });

  it("throws on non-JSON response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not json", { status: 200, headers: { "content-type": "text/plain" } }),
    );

    await expect(checkAgentHealth()).rejects.toThrow("non-JSON");
  });

  it("throws on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(checkAgentHealth()).rejects.toThrow("Cannot reach Agent service");
  });

  it("surfaces nonce and apiVersion from the health payload (A-API-001)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          nonce: "58e3275aecf024f222263769e9bed540",
          apiVersion: "1.0.0",
          llm: { message: "Online" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const health = await checkAgentHealth();
    expect(health.nonce).toBe("58e3275aecf024f222263769e9bed540");
    expect(health.apiVersion).toBe("1.0.0");
  });
});

describe("getAgentApiToken (A-API-001)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetAgentApiTokenCache();
  });

  it("provisions the token via the Tauri bridge and caches it", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {
      invoke: vi.fn(async (cmd: string) => {
        if (cmd === "get_agent_api_token") return "a".repeat(64);
        return null;
      }),
    });
    const token = await getAgentApiToken();
    expect(token).toBe("a".repeat(64));
    vi.unstubAllGlobals();
  });

  it("falls back to VITE_AGENT_API_TOKEN without the Tauri bridge", async () => {
    // No __TAURI_INTERNALS__: browser dev mode reads the env-provided token.
    const token = await getAgentApiToken();
    expect(token).toBeNull(); // no env configured in the test runner
    vi.unstubAllGlobals();
  });

  it("sends the bearer token header on API requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, llm: { message: "Online" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("__TAURI_INTERNALS__", {
      invoke: vi.fn(async (cmd: string) => (cmd === "get_agent_api_token" ? "tok123" : null)),
    });

    await checkAgentHealth();
    const init = fetchSpy.mock.calls[0]![1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["X-GeneCode-Token"]).toBe("tok123");
    vi.unstubAllGlobals();
  });

  it("sends the bearer token header on POST routes too", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ connected: true, message: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("__TAURI_INTERNALS__", {
      invoke: vi.fn(async (cmd: string) => (cmd === "get_agent_api_token" ? "tok123" : null)),
    });

    await testAgentLlmConnection();
    const init = fetchSpy.mock.calls[0]![1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["X-GeneCode-Token"]).toBe("tok123");
    vi.unstubAllGlobals();
  });
});

describe("testAgentLlmConnection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a verified model connection", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        connected: true,
        message: "连接成功：MiniMax · MiniMax-M2.7",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(testAgentLlmConnection()).resolves.toEqual({
      connected: true,
      message: "连接成功：MiniMax · MiniMax-M2.7",
    });
  });

  it("surfaces provider errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "大模型 API 返回 429：额度不足" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(testAgentLlmConnection()).rejects.toThrow("429");
  });
});

describe("switchAgentModel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    import.meta.env.VITE_AGENT_API_BASE = "";
  });

  it("posts the model to the runtime switch endpoint", async () => {
    let capturedUrl = "";
    let capturedBody: unknown = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          ok: true,
          llm: { provider: "opencode-go", model: "deepseek-v4-pro", mode: "llm" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await switchAgentModel({
      model: "deepseek-v4-pro",
      baseUrl: "https://opencode.ai/zen/go/v1",
      provider: "opencode-go",
    });

    expect(capturedUrl).toBe("http://127.0.0.1:8000/api/agent/model");
    expect(capturedBody).toEqual({
      model: "deepseek-v4-pro",
      baseUrl: "https://opencode.ai/zen/go/v1",
      provider: "opencode-go",
    });
    expect(result.ok).toBe(true);
    expect(result.llm.model).toBe("deepseek-v4-pro");
  });

  it("surfaces service-side validation errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "模型端点必须使用 HTTPS" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(switchAgentModel({ model: "x" })).rejects.toThrow("HTTPS");
  });
});

describe("cancelAgentTask", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the run id to /api/agent/cancel", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, run_id: "run-1", status: "cancelled" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await cancelAgentTask("run-1");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:8000/api/agent/cancel");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ runId: "run-1" });
  });

  it("does nothing without a run id", async () => {
    await cancelAgentTask(null);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never throws on network failure", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    await expect(cancelAgentTask("run-1")).resolves.toBeUndefined();
  });
});

describe("planAgentTask request body", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends snapshot with formState.cloning vector context", async () => {
    let capturedBody: unknown;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({ messages: ["ok"], meta: {} }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const doc = makeDoc();
    const snap = buildDocumentSnapshot(doc);
    await planAgentTask({
      message: "Design primers",
      workspace: "cloning",
      runMode: "precise",
      snapshot: snap,
      history: [],
    });

    const body = capturedBody as Record<string, unknown>;
    expect(body).toHaveProperty("snapshot");
    const snapshot = body.snapshot as Record<string, unknown>;
    expect(snapshot).toHaveProperty("lastWorkbenchPage", "cloning");
    expect(snapshot).toHaveProperty("formState");
    const formState = snapshot.formState as Record<string, unknown>;
    const cloning = formState.cloning as Record<string, unknown>;
    expect(cloning).toHaveProperty("vectorSequence", "ATCGATCGATCGATCG");
    expect(cloning).toHaveProperty("vectorTopology", "linear");
    expect(cloning).toHaveProperty("vectorLabel", "test_seq");
  });

  it("sends runMode: precise so planning never requests auto-execution", async () => {
    let capturedBody: unknown;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({ messages: [], meta: {} }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const snap = buildDocumentSnapshot(makeDoc());
    await planAgentTask({
      message: "test",
      workspace: "cloning",
      runMode: "precise",
      snapshot: snap,
      history: [],
    });

    expect((capturedBody as Record<string, unknown>).runMode).toBe("precise");
  });

  it("can send siRNA workspace requests", async () => {
    let capturedBody: unknown;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({ messages: [], meta: {} }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const snap = buildDocumentSnapshot(makeDoc(), "sirna");
    await planAgentTask({
      message: "design siRNA",
      workspace: "sirna",
      runMode: "precise",
      snapshot: snap,
      history: [],
    });

    expect((capturedBody as Record<string, unknown>).workspace).toBe("sirna");
    const snapshot = (capturedBody as Record<string, unknown>).snapshot as Record<string, unknown>;
    expect(snapshot).toHaveProperty("lastWorkbenchPage", "sirna");
  });
});

describe("executeAgentTask", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends draft, runId, and snapshot in the request body", async () => {
    let capturedBody: unknown;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({ messages: ["done"], meta: {} }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const snap = buildDocumentSnapshot(makeDoc());
    await executeAgentTask({
      draft: { type: "cloning", data: {} },
      snapshot: snap,
      history: [],
      workspace: "cloning",
      runMode: "precise",
      message: "run it",
      runId: "run-42",
    });

    const body = capturedBody as Record<string, unknown>;
    expect(body).toHaveProperty("draft");
    expect(body).toHaveProperty("runId", "run-42");
    expect(body).toHaveProperty("snapshot");
    expect(body).toHaveProperty("workspace", "cloning");
    expect(body).toHaveProperty("runMode", "precise");
  });

  it("can execute mutagenesis workspace requests", async () => {
    let capturedBody: unknown;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({ messages: ["done"], meta: {} }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    await executeAgentTask({
      draft: { workspace: "mutagenesis", designPayload: {} },
      snapshot: buildDocumentSnapshot(makeDoc(), "mutagenesis"),
      history: [],
      workspace: "mutagenesis",
      runMode: "precise",
      message: "run point mutation",
    });

    const body = capturedBody as Record<string, unknown>;
    expect(body).toHaveProperty("workspace", "mutagenesis");
    const snapshot = body.snapshot as Record<string, unknown>;
    expect(snapshot).toHaveProperty("lastWorkbenchPage", "mutagenesis");
  });
});

describe("executeAgentTaskStream", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    import.meta.env.VITE_AGENT_API_BASE = "";
  });

  it("emits intermediate tool events and returns the complete response", async () => {
    const streamBody = [
      'event: step_start\ndata: {"ok":true,"tool":"design_cloning","label":"Design","summary":"Running"}\n\n',
      'event: step_done\ndata: {"ok":true,"tool":"design_cloning","summary":"Done"}\n\n',
      'event: complete\ndata: {"ok":true,"messages":["Finished"],"meta":{"workspace":"cloning"}}\n\n',
    ].join("");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(streamBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const onEvent = vi.fn();

    const result = await executeAgentTaskStream(
      {
        draft: { type: "cloning" },
        snapshot: buildDocumentSnapshot(makeDoc()),
        history: [],
        workspace: "cloning",
        runMode: "precise",
        message: "run it",
      },
      onEvent,
    );

    expect(fetchSpy.mock.calls[0]![0]).toBe(
      "http://127.0.0.1:8000/api/agent/execute/stream",
    );
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent.mock.calls[0]![0]).toMatchObject({
      type: "step_start",
      data: { tool: "design_cloning" },
    });
    expect(result.messages).toEqual(["Finished"]);
    expect(result.workspace).toBe("cloning");
  });
});

describe("executeAgentTaskStream checkResults", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    import.meta.env.VITE_AGENT_API_BASE = "";
  });

  it("passes raw candidates under checkResults so the backend routes to a check tool", async () => {
    let capturedBody: Record<string, unknown> = {};
    const streamBody = 'event: complete\ndata: {"ok":true,"messages":["checked"],"check":{"messages":["checked"],"results":[{"specificityCheck":{"status":"Pass"}}],"meta":{"checked":1}},"meta":{"workspace":"rtqpcr","agentRun":{"runId":"run_1"}}}\n\n';
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(streamBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const result = await executeAgentTaskStream(
      {
        draft: { designPayload: { species: "Sus scrofa", selectedAccession: "NM_001" } },
        snapshot: buildDocumentSnapshot(makeDoc()),
        history: [],
        workspace: "rtqpcr",
        runMode: "precise",
        message: "check",
        requestId: "req-1",
        checkResults: [{ f: "AAAA", r: "TTTT" }],
      },
      vi.fn(),
    );

    expect(fetchSpy.mock.calls[0]![0]).toBe("http://127.0.0.1:8000/api/agent/execute/stream");
    expect(capturedBody).toMatchObject({ workspace: "rtqpcr", checkResults: [{ f: "AAAA", r: "TTTT" }] });
    expect(result.check).toMatchObject({ results: [{ specificityCheck: { status: "Pass" } }] });
  });
});

describe("timeout behavior", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Mock fetch that rejects when its signal is aborted. */
  function mockFetchWithSignal(): void {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        // The caller may abort before the fetch is invoked (service.ts now
        // awaits the API token header first), so honor an already-aborted
        // signal instead of waiting for a listener that never attaches.
        throw signal.reason;
      }
      return new Promise((_resolve, reject) => {
        if (signal) {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }
      });
    });
  }

  it("timeout aborts a pending fetch with AgentServiceError", async () => {
    mockFetchWithSignal();

    const promise = checkAgentHealth();
    const observed = promise.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(31_000);

    const error = await observed;
    expect(error).toBeInstanceOf(AgentServiceError);
    expect((error as Error).message).toContain("Health check timed out");
  });

  it("cleanup prevents a later timeout after success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const health = await checkAgentHealth();
    expect(health.status).toBe("online");

    await vi.advanceTimersByTimeAsync(60_000);
  });

  it("planAgentTask timeout throws correct message", async () => {
    mockFetchWithSignal();

    const snap = buildDocumentSnapshot(makeDoc());
    const promise = planAgentTask({
      message: "test",
      workspace: "cloning",
      runMode: "precise",
      snapshot: snap,
      history: [],
    });
    const observed = promise.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(121_000);

    const error = await observed;
    expect(error).toBeInstanceOf(AgentServiceError);
    expect((error as Error).message).toContain("Planning request timed out");
  });

  it("executeAgentTask timeout throws correct message", async () => {
    mockFetchWithSignal();

    const snap = buildDocumentSnapshot(makeDoc());
    const promise = executeAgentTask({
      draft: { type: "cloning" },
      snapshot: snap,
      history: [],
      workspace: "cloning",
      runMode: "precise",
      message: "run it",
    });
    const observed = promise.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(121_000);

    const error = await observed;
    expect(error).toBeInstanceOf(AgentServiceError);
    expect((error as Error).message).toContain("Execution request timed out");
  });

  it("executeAgentTaskStream honors a custom timeout (120s for remote BLAST checks)", async () => {
    mockFetchWithSignal();

    const snap = buildDocumentSnapshot(makeDoc());
    const promise = executeAgentTaskStream(
      {
        draft: { type: "rtqpcr" },
        snapshot: snap,
        history: [],
        workspace: "rtqpcr",
        runMode: "precise",
        message: "validate",
        checkResults: [{ f: "AAAA", r: "TTTT" }],
      },
      vi.fn(),
      undefined,
      120_000,
    );
    const observed = promise.catch((error: unknown) => error);

    // The default 30s budget must NOT fire for the validation path.
    await vi.advanceTimersByTimeAsync(31_000);

    await vi.advanceTimersByTimeAsync(90_000);

    const error = await observed;
    expect(error).toBeInstanceOf(AgentServiceError);
    expect((error as Error).message).toContain("Execution request timed out");
  });
});

describe("caller abort behavior", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /** Mock fetch that rejects when its signal is aborted. */
  function mockFetchWithSignal(): void {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        // The caller may abort before the fetch is invoked (service.ts now
        // awaits the API token header first), so honor an already-aborted
        // signal instead of waiting for a listener that never attaches.
        throw signal.reason;
      }
      return new Promise((_resolve, reject) => {
        if (signal) {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }
      });
    });
  }

  it("caller signal aborts a pending fetch before timeout", async () => {
    mockFetchWithSignal();

    const controller = new AbortController();
    const promise = checkAgentHealth(controller.signal);

    controller.abort();

    await expect(promise).rejects.toThrow();
    await expect(promise).rejects.not.toThrow("timed out");
  });

  it("caller abort on planAgentTask does not report timeout", async () => {
    mockFetchWithSignal();

    const controller = new AbortController();
    const snap = buildDocumentSnapshot(makeDoc());
    const promise = planAgentTask(
      { message: "test", workspace: "cloning", runMode: "precise", snapshot: snap, history: [] },
      controller.signal,
    );

    controller.abort();

    await expect(promise).rejects.not.toThrow("timed out");
  });

  it("caller abort on executeAgentTask does not report timeout", async () => {
    mockFetchWithSignal();

    const controller = new AbortController();
    const snap = buildDocumentSnapshot(makeDoc());
    const promise = executeAgentTask(
      { draft: { type: "cloning" }, snapshot: snap, history: [], workspace: "cloning", runMode: "precise", message: "run it" },
      controller.signal,
    );

    controller.abort();

    await expect(promise).rejects.not.toThrow("timed out");
  });
});
