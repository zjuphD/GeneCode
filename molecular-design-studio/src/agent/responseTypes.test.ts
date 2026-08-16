import { describe, it, expect } from "vitest";
import { normalizeAgentHealth, normalizeAgentResponse } from "./responseTypes";

describe("normalizeAgentHealth", () => {
  it("returns online for {ok: true, llm: {message}} shape", () => {
    const result = normalizeAgentHealth({
      ok: true,
      llm: { message: "已连接 MiniMax · MiniMax-M2.7" },
    });
    expect(result.status).toBe("online");
    expect(result.label).toBe("已连接 MiniMax · MiniMax-M2.7");
  });

  it("returns online with default label when llm has no message", () => {
    const result = normalizeAgentHealth({ ok: true });
    expect(result.status).toBe("online");
    expect(result.label).toBe("Online");
  });

  it("returns online for {status: 'ok'} fallback shape", () => {
    const result = normalizeAgentHealth({ status: "ok", label: "Healthy" });
    expect(result.status).toBe("online");
    expect(result.label).toBe("Healthy");
  });

  it("returns online for {status: 'online'} fallback shape", () => {
    const result = normalizeAgentHealth({ status: "online" });
    expect(result.status).toBe("online");
    expect(result.label).toBe("Online");
  });

  it("returns offline for non-ok status", () => {
    const result = normalizeAgentHealth({ status: "error", message: "DB down" });
    expect(result.status).toBe("offline");
    expect(result.label).toBe("DB down");
  });

  it("returns offline for non-object input", () => {
    expect(normalizeAgentHealth(null).status).toBe("offline");
    expect(normalizeAgentHealth("hello").status).toBe("offline");
    expect(normalizeAgentHealth(42).status).toBe("offline");
  });

  it("returns offline for empty object", () => {
    const result = normalizeAgentHealth({});
    expect(result.status).toBe("offline");
    expect(result.label).toBe("Offline");
  });
});

describe("normalizeAgentResponse", () => {
  it("throws for non-object input", () => {
    expect(() => normalizeAgentResponse(null)).toThrow("non-object");
    expect(() => normalizeAgentResponse("hello")).toThrow("non-object");
    expect(() => normalizeAgentResponse(42)).toThrow("non-object");
  });

  it("throws for empty object with no expected fields", () => {
    expect(() => normalizeAgentResponse({})).toThrow("empty response");
  });

  it("throws with service error string when present", () => {
    expect(() => normalizeAgentResponse({ error: "Bad request" })).toThrow("Bad request");
  });

  it("rejects ok:false envelope before checking expected fields", () => {
    expect(() =>
      normalizeAgentResponse({ ok: false, error: "bad", meta: {} }),
    ).toThrow("bad");
  });

  it("rejects ok:false envelope with default error when no error string", () => {
    expect(() =>
      normalizeAgentResponse({ ok: false, meta: {} }),
    ).toThrow("error response");
  });

  it("normalizes plan dependsOn and planProvenance from execute meta", () => {
    const raw = {
      messages: [],
      plan: [
        { step: "Resolve", tool: "resolve_rt_target", status: "completed", detail: "" },
        { step: "Design", tool: "design_rtqpcr", status: "completed", detail: "", dependsOn: ["resolve_rt_target"] },
        { step: "Check", tool: "check_rt_specificity", status: "completed", detail: "", dependsOn: ["design_rtqpcr"] },
      ],
      runLog: [],
      meta: {
        workspace: "rtqpcr",
        plannedBy: "llm",
        planValidated: true,
        planErrors: [],
      },
      design: {},
    };
    const result = normalizeAgentResponse(raw);
    expect(result.plan[1]!.dependsOn).toEqual(["resolve_rt_target"]);
    expect(result.plan[2]!.dependsOn).toEqual(["design_rtqpcr"]);
    expect(result.plan[0]!.dependsOn).toBeUndefined();
    expect(result.planProvenance).toEqual({ source: "llm", validated: true, errors: [] });
  });

  it("keeps planProvenance null when plannedBy is absent", () => {
    const raw = { messages: [], plan: [], runLog: [], meta: { workspace: "rtqpcr" }, design: {} };
    const result = normalizeAgentResponse(raw);
    expect(result.planProvenance).toBeNull();
  });

  it("carries planErrors on fallback provenance", () => {
    const raw = {
      messages: [],
      plan: [],
      runLog: [],
      meta: {
        workspace: "rtqpcr",
        plannedBy: "rules",
        planValidated: false,
        planErrors: ["计划包含执行器暂不支持的共享工具：parse_sequence"],
      },
      design: {},
    };
    const result = normalizeAgentResponse(raw);
    expect(result.planProvenance?.source).toBe("rules");
    expect(result.planProvenance?.validated).toBe(false);
    expect(result.planProvenance?.errors).toEqual([
      "计划包含执行器暂不支持的共享工具：parse_sequence",
    ]);
  });

  it("normalizes a realistic chat response", () => {
    const raw = {
      messages: ["I can help design primers for your gene."],
      plan: [
        { label: "Analyze sequence", tool: "analyze", status: "pending", summary: "Check GC content" },
      ],
      meta: {
        workspace: "cloning",
        readyToExecute: false,
        draft: { type: "cloning", steps: ["extract", "amplify"] },
        agentRun: { runId: "run-001", status: "planning" },
        llm: { message: "已连接 MiniMax · MiniMax-M2.7" },
      },
    };

    const result = normalizeAgentResponse(raw);
    expect(result.messages).toEqual(["I can help design primers for your gene."]);
    expect(result.plan).toHaveLength(1);
    expect(result.plan[0]!.label).toBe("Analyze sequence");
    expect(result.workspace).toBe("cloning");
    expect(result.readyToExecute).toBe(false);
    expect(result.draft).toEqual({ type: "cloning", steps: ["extract", "amplify"] });
    expect(result.agentRun.runId).toBe("run-001");
    expect(result.llmStatus?.message).toBe("已连接 MiniMax · MiniMax-M2.7");
  });

  it("normalizes a realistic execute response", () => {
    const raw = {
      messages: ["Design complete. 3 primers found."],
      plan: [],
      runLog: [
        { step: "1", tool: "primer3", status: "success", message: "Found 3 primers" },
      ],
      meta: {
        workspace: "cloning",
        readyToExecute: false,
        agentRun: {
          runId: "run-001",
          status: "completed",
          recommendationPackage: {
            recommendation: {
              title: "Gibson Assembly",
              summary: "Best for this construct",
            },
            risk: { items: ["High GC in region 200-300"] },
            confidence: { score: 85 },
          },
        },
      },
      design: {
        results: [{ name: "F1" }, { name: "R1" }, { name: "F2" }],
      },
    };

    const result = normalizeAgentResponse(raw);
    expect(result.messages).toEqual(["Design complete. 3 primers found."]);
    expect(result.runLog).toHaveLength(1);
    expect(result.runLog[0]!.tool).toBe("primer3");
    expect(result.recommendation?.title).toBe("Gibson Assembly");
    expect(result.recommendation?.risks).toEqual(["High GC in region 200-300"]);
    expect(result.recommendation?.confidence).toBe(85);
    expect(result.resultCount).toBe(3);
    expect(result.agentRun.status).toBe("completed");
  });

  it("carries per-step detail fields (args/result/durationMs) through runLog", () => {
    const raw = {
      messages: [],
      plan: [],
      runLog: [
        {
          step: "解析序列",
          tool: "parse_sequence",
          status: "completed",
          message: "已解析序列，长度 600 bp。",
          args: { sequence: "ATGC…（600 字符）", name: "GFP" },
          result: { message: "已解析序列", resultCount: 1, topResult: { length: 600 } },
          durationMs: 1234,
        },
      ],
      meta: { workspace: "cloning" },
      design: {},
    };
    const result = normalizeAgentResponse(raw);
    expect(result.runLog).toHaveLength(1);
    const row = result.runLog[0]!;
    expect(row.args).toEqual({ sequence: "ATGC…（600 字符）", name: "GFP" });
    expect(row.result).toEqual({ message: "已解析序列", resultCount: 1, topResult: { length: 600 } });
    expect(row.durationMs).toBe(1234);
  });

  it("drops malformed per-step detail fields from runLog", () => {
    const raw = {
      messages: [],
      plan: [],
      runLog: [
        {
          step: "1",
          tool: "t",
          status: "failed",
          message: "boom",
          args: "not-an-object",
          result: [1, 2],
          durationMs: "fast",
        },
      ],
      meta: { workspace: "rtqpcr" },
      design: {},
    };
    const result = normalizeAgentResponse(raw);
    const row = result.runLog[0]!;
    expect(row.args).toBeUndefined();
    expect(row.result).toBeUndefined();
    expect(row.durationMs).toBeUndefined();
    expect(row.step).toBe("1");
  });

  it("extracts sequencePatch from top-level", () => {
    const patch = { schemaVersion: 1, id: "p1", operations: [] };
    const raw = { messages: [], meta: {}, sequencePatch: patch };
    const result = normalizeAgentResponse(raw);
    expect(result.sequencePatch).toBe(patch);
  });

  it("extracts sequencePatch from meta", () => {
    const patch = { schemaVersion: 1, id: "p1", operations: [] };
    const raw = { messages: [], meta: { sequencePatch: patch } };
    const result = normalizeAgentResponse(raw);
    expect(result.sequencePatch).toBe(patch);
  });

  it("retains sequencePatch as unknown without casting", () => {
    const patch = { weird: "shape", not: "a real patch" };
    const raw = { messages: [], meta: {}, sequencePatch: patch };
    const result = normalizeAgentResponse(raw);
    expect(result.sequencePatch).toBe(patch);
    // It should be the exact same reference
    expect(result.sequencePatch).toBe(patch);
  });

  it("ignores malformed array items in messages", () => {
    const raw = { messages: ["hello", 42, null, "", "world"], meta: {} };
    const result = normalizeAgentResponse(raw);
    expect(result.messages).toEqual(["hello", "world"]);
  });

  it("ignores malformed plan rows", () => {
    const raw = {
      messages: [],
      plan: [null, 42, { label: "ok", tool: "t", status: "s", summary: "x" }],
      meta: {},
    };
    const result = normalizeAgentResponse(raw);
    expect(result.plan).toHaveLength(1);
    expect(result.plan[0]!.label).toBe("ok");
  });

  it("stores draft only when it is a plain object", () => {
    expect(normalizeAgentResponse({ messages: [], meta: { draft: {} } }).draft).toEqual({});
    expect(normalizeAgentResponse({ messages: [], meta: { draft: null } }).draft).toBeNull();
    expect(normalizeAgentResponse({ messages: [], meta: { draft: "str" } }).draft).toBeNull();
    expect(normalizeAgentResponse({ messages: [], meta: { draft: [1, 2] } }).draft).toBeNull();
  });

  it("confidence is not multiplied by 100 (already a percentage)", () => {
    const raw = {
      messages: [],
      meta: {
        agentRun: {
          recommendationPackage: {
            recommendation: { title: "Test", summary: "" },
            confidence: { score: 77 },
          },
        },
      },
    };
    const result = normalizeAgentResponse(raw);
    expect(result.recommendation?.confidence).toBe(77);
  });

  it("recommendation fallback to meta.recommendation", () => {
    const raw = {
      messages: [],
      meta: {
        recommendation: {
          title: "Fallback Rec",
          summary: "From meta path",
          risks: ["risk1"],
          confidence: 90,
        },
      },
    };
    const result = normalizeAgentResponse(raw);
    expect(result.recommendation?.title).toBe("Fallback Rec");
    expect(result.recommendation?.risks).toEqual(["risk1"]);
  });

  it("resultCount from design.results array length", () => {
    const raw = {
      messages: [],
      meta: {},
      design: { results: [{ a: 1 }, { b: 2 }, { c: 3 }] },
    };
    expect(normalizeAgentResponse(raw).resultCount).toBe(3);
  });

  // ── Candidate normalization ────────────────────────────────

  it("normalizes realistic cloning candidates from design.results", () => {
    const raw = {
      messages: [],
      meta: {},
      design: {
        results: [
          {
            f: "ATGCGATCGATCGATCG",
            r: "GCTAGCTAGCTAGCTAG",
            tm_f: 62.5,
            tm_r: 61.3,
            gc_f: 52.9,
            gc_r: 47.1,
            full_length_f: 31,
            full_length_r: 32,
            insert_length: 1500,
            forward_core: "ATGCGATCGATCGATCG",
            reverse_core: "GCTAGCTAGCTAGCTAG",
            binding_start_f: 0,
            binding_end_f: 17,
            binding_start_r: 1483,
            binding_end_r: 1500,
            binding_target: "insert",
            binding_target_length: 1500,
            coordinate_system: "zero_based_half_open",
            quality: { tm_delta: 1.2, cross_dimer: false },
            conditions: { anneal_c: 58, extension_sec: 90 },
          },
          {
            f: "TTTTAAAACCCCGGGG",
            r: "AAAACCCCGGGGTTTT",
            tm_f: 60.0,
            tm_r: 59.5,
            gc_f: 50.0,
            gc_r: 50.0,
          },
        ],
      },
    };

    const result = normalizeAgentResponse(raw);
    expect(result.candidates).toHaveLength(2);
    expect(result.resultCount).toBe(2);

    const c0 = result.candidates[0]!;
    expect(c0.forwardPrimer).toBe("ATGCGATCGATCGATCG");
    expect(c0.reversePrimer).toBe("GCTAGCTAGCTAGCTAG");
    expect(c0.tmForward).toBe(62.5);
    expect(c0.tmReverse).toBe(61.3);
    expect(c0.gcForward).toBe(52.9);
    expect(c0.gcReverse).toBe(47.1);
    expect(c0.fullLengthForward).toBe(31);
    expect(c0.fullLengthReverse).toBe(32);
    expect(c0.insertLength).toBe(1500);
    expect(c0.tmDelta).toBe(1.2);
    expect(c0.crossDimer).toBe(false);
    expect(c0.annealTemp).toBe(58);
    expect(c0.extensionSec).toBe(90);
    expect(c0.bindingStartForward).toBe(0);
    expect(c0.bindingEndReverse).toBe(1500);
    expect(c0.bindingTarget).toBe("insert");
    expect(c0.bindingTargetLength).toBe(1500);
    expect(c0.coordinateSystem).toBe("zero_based_half_open");
    expect(c0.forwardCore).toBe("ATGCGATCGATCGATCG");
    expect(c0.reverseCore).toBe("GCTAGCTAGCTAGCTAG");

    const c1 = result.candidates[1]!;
    expect(c1.forwardPrimer).toBe("TTTTAAAACCCCGGGG");
    expect(c1.tmForward).toBe(60.0);
    expect(c1.tmDelta).toBeNull();
  });

  it("limits candidates to at most 3", () => {
    const raw = {
      messages: [],
      meta: {},
      design: {
        results: [
          { f: "A", tm_f: 60 },
          { f: "B", tm_f: 61 },
          { f: "C", tm_f: 62 },
          { f: "D", tm_f: 63 },
          { f: "E", tm_f: 64 },
        ],
      },
    };
    const result = normalizeAgentResponse(raw);
    expect(result.candidates).toHaveLength(3);
    expect(result.resultCount).toBe(5);
  });

  it("skips malformed candidates without crashing", () => {
    const raw = {
      messages: [],
      meta: {},
      design: {
        results: [
          null,
          42,
          "string",
          { f: "VALID", tm_f: 60 },
          { totally: "unknown" },
        ],
      },
    };
    const result = normalizeAgentResponse(raw);
    // Only the valid candidate with f/tm_f should survive; {totally:"unknown"} has no meaningful values
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.forwardPrimer).toBe("VALID");
    expect(result.resultCount).toBe(5);
  });

  it("returns empty candidates for non-array design.results", () => {
    const raw = { messages: [], meta: {}, design: { results: "not-an-array" } };
    const result = normalizeAgentResponse(raw);
    expect(result.candidates).toEqual([]);
    expect(result.resultCount).toBeNull();
  });

  it("candidate with only title is kept", () => {
    const raw = {
      messages: [],
      meta: {},
      design: {
        results: [{ title: "Fallback candidate", description: "No primer data" }],
      },
    };
    const result = normalizeAgentResponse(raw);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.title).toBe("Fallback candidate");
    expect(result.candidates[0]!.forwardPrimer).toBeNull();
  });

  it("candidate with no meaningful values is skipped", () => {
    const raw = {
      messages: [],
      meta: {},
      design: {
        results: [{ random_field: 123, another: true }],
      },
    };
    const result = normalizeAgentResponse(raw);
    expect(result.candidates).toEqual([]);
  });

  // ── RT-qPCR candidate normalization ─────────────────────────

  it("extracts RT-qPCR candidate rows and metrics", () => {
    const raw = {
      messages: [],
      meta: { workspace: "rtqpcr" },
      design: {
        results: [
          {
            f: "ATGCGATCGATCG",
            r: "GCTAGCTAGCTAG",
            tm_f: 62.5,
            tm_r: 61.3,
            gc_f: 52.9,
            gc_r: 47.1,
            size: 150,
            amplicon_gc: 48.5,
            gdna: "no amplicon",
            quality: { tm_delta: 1.2 },
            conditions: { anneal_c: 58 },
          },
        ],
      },
    };

    const result = normalizeAgentResponse(raw);
    expect(result.candidates).toHaveLength(1);
    const c0 = result.candidates[0]!;
    expect(c0.workspace).toBe("rtqpcr");
    expect(c0.title).toBe("RT-qPCR candidate");
    expect(c0.sequenceRows).toEqual([
      { label: "Forward", value: "ATGCGATCGATCG" },
      { label: "Reverse", value: "GCTAGCTAGCTAG" },
    ]);
    expect(c0.metrics).toContain("Amplicon 150 bp");
    expect(c0.metrics).toContain("Tm delta 1.2°C");
    expect(c0.metrics).toContain("Amplicon GC 48.5%");
    expect(c0.metrics).toContain("gDNA no amplicon");
    expect(c0.metrics).toContain("Anneal 58°C");
    // Legacy fields still populated
    expect(c0.forwardPrimer).toBe("ATGCGATCGATCG");
    expect(c0.reversePrimer).toBe("GCTAGCTAGCTAG");
  });

  it("extracts RT-qPCR probe row when probe.seq exists", () => {
    const raw = {
      messages: [],
      meta: { workspace: "rtqpcr" },
      design: {
        results: [
          {
            f: "AAA",
            r: "CCC",
            probe: { seq: "TTTTTTTTTT", tm: 68, gc: 50 },
          },
        ],
      },
    };

    const result = normalizeAgentResponse(raw);
    const c0 = result.candidates[0]!;
    expect(c0.sequenceRows).toEqual([
      { label: "Forward", value: "AAA" },
      { label: "Reverse", value: "CCC" },
      { label: "Probe", value: "TTTTTTTTTT" },
    ]);
  });

  // ── sgRNA candidate normalization ───────────────────────────

  it("extracts sgRNA guide rows and metrics", () => {
    const raw = {
      messages: [],
      meta: { workspace: "sgrna" },
      design: {
        results: [
          {
            seq: "ATGCGATCGATCGATCG",
            pam: "NGG",
            score: 85,
            gc: 58.8,
            cut: 150,
            direction: "sense",
            off: "none",
            repeat_risk: "low",
          },
        ],
      },
    };

    const result = normalizeAgentResponse(raw);
    expect(result.candidates).toHaveLength(1);
    const c0 = result.candidates[0]!;
    expect(c0.workspace).toBe("sgrna");
    expect(c0.title).toBe("sgRNA candidate");
    expect(c0.sequenceRows).toEqual([
      { label: "Guide", value: "ATGCGATCGATCGATCG" },
      { label: "PAM", value: "NGG" },
    ]);
    expect(c0.metrics).toContain("Score 85");
    expect(c0.metrics).toContain("GC 58.8%");
    expect(c0.metrics).toContain("Cut 150");
    expect(c0.metrics).toContain("Dir sense");
    expect(c0.metrics).toContain("Off-target none");
    expect(c0.metrics).toContain("Repeat low");
    // sgRNA has no primer pair
    expect(c0.forwardPrimer).toBeNull();
    expect(c0.reversePrimer).toBeNull();
  });

  // ── siRNA candidate normalization ───────────────────────────

  it("extracts siRNA duplex rows and metrics", () => {
    const raw = {
      messages: [],
      meta: { workspace: "sirna" },
      design: {
        results: [
          {
            sense: "AUGCGAUCGAUCG",
            antisense: "CGAUCGAUCGCAU",
            sense_duplex: "AUGCGAUCGAUCGdTdT",
            antisense_duplex: "CGAUCGAUCGCAUdTdT",
            score: 92,
            gc: 46.2,
            target_start: 100,
            target_end: 121,
            seed_risk: "low",
            repeat_risk: "none",
            functional_region: "CDS",
            shared_label: "all isoforms",
            recommended_format: "21-nt dTdT",
          },
        ],
      },
    };

    const result = normalizeAgentResponse(raw);
    expect(result.candidates).toHaveLength(1);
    const c0 = result.candidates[0]!;
    expect(c0.workspace).toBe("sirna");
    expect(c0.title).toBe("siRNA candidate");
    expect(c0.sequenceRows).toEqual([
      { label: "Sense duplex", value: "AUGCGAUCGAUCGdTdT" },
      { label: "Antisense duplex", value: "CGAUCGAUCGCAUdTdT" },
    ]);
    expect(c0.metrics).toContain("Score 92");
    expect(c0.metrics).toContain("GC 46.2%");
    expect(c0.metrics).toContain("Target 100–121");
    expect(c0.metrics).toContain("Seed low");
    expect(c0.metrics).toContain("Repeat none");
    expect(c0.metrics).toContain("Region CDS");
    expect(c0.metrics).toContain("Shared all isoforms");
    expect(c0.metrics).toContain("Format 21-nt dTdT");
  });

  it("falls back to sense/antisense when duplex fields missing", () => {
    const raw = {
      messages: [],
      meta: { workspace: "sirna" },
      design: {
        results: [
          {
            sense: "AUGCGAUCGAUCG",
            antisense: "CGAUCGAUCGCAU",
            score: 80,
            gc: 50,
          },
        ],
      },
    };

    const result = normalizeAgentResponse(raw);
    const c0 = result.candidates[0]!;
    expect(c0.sequenceRows).toEqual([
      { label: "Sense", value: "AUGCGAUCGAUCG" },
      { label: "Antisense", value: "CGAUCGAUCGCAU" },
    ]);
  });

  // ── Point mutation candidate normalization ──────────────────

  it("extracts point mutation primer rows and metrics", () => {
    const raw = {
      messages: [],
      meta: { workspace: "mutagenesis" },
      design: {
        results: [
          {
            mutation: "A123T",
            f: "ATGCGATCGATCG",
            r: "GCTAGCTAGCTAG",
            tm_f: 62.5,
            tm_r: 61.3,
            gc_f: 52.9,
            gc_r: 47.1,
            length: 31,
            binding_start: 100,
            binding_end: 130,
            quality: {
              tm_delta: 1.2,
              center_offset: 0,
              self_dimer: -3.5,
            },
            conditions: { anneal_c: 58 },
          },
        ],
      },
    };

    const result = normalizeAgentResponse(raw);
    expect(result.candidates).toHaveLength(1);
    const c0 = result.candidates[0]!;
    expect(c0.workspace).toBe("mutagenesis");
    expect(c0.title).toBe("Mutation: A123T");
    expect(c0.sequenceRows).toEqual([
      { label: "Forward", value: "ATGCGATCGATCG" },
      { label: "Reverse", value: "GCTAGCTAGCTAG" },
    ]);
    expect(c0.metrics).toContain("A123T");
    expect(c0.metrics).toContain("Length 31 nt");
    expect(c0.metrics).toContain("Tm delta 1.2°C");
    expect(c0.metrics).toContain("Tm 62.5/61.3°C");
    expect(c0.metrics).toContain("GC 52.9/47.1%");
    expect(c0.metrics).toContain("Bind 100–130");
    expect(c0.metrics).toContain("Center offset 0");
    expect(c0.metrics).toContain("Self dimer -3.5");
    expect(c0.metrics).toContain("Anneal 58°C");
  });

  it("uses design.designType as fallback workspace hint", () => {
    const raw = {
      messages: [],
      meta: {},
      design: {
        designType: "sgrna",
        results: [
          { seq: "ATGCGATCGATCGATCG", pam: "NGG", score: 80 },
        ],
      },
    };

    const result = normalizeAgentResponse(raw);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.workspace).toBe("sgrna");
    expect(result.candidates[0]!.title).toBe("sgRNA candidate");
    expect(result.candidates[0]!.sequenceRows?.[0]?.label).toBe("Guide");
  });

  it("unknown workspace falls back to cloning-style display", () => {
    const raw = {
      messages: [],
      meta: {},
      design: {
        results: [
          { f: "AAA", r: "CCC", tm_f: 60, tm_r: 59 },
        ],
      },
    };

    const result = normalizeAgentResponse(raw);
    const c0 = result.candidates[0]!;
    expect(c0.workspace).toBeNull();
    expect(c0.sequenceRows).toEqual([
      { label: "Forward", value: "AAA" },
      { label: "Reverse", value: "CCC" },
    ]);
  });

  // ── Existing cloning tests still pass ───────────────────────

  it("cloning candidates keep all legacy fields", () => {
    const raw = {
      messages: [],
      meta: { workspace: "cloning" },
      design: {
        results: [
          {
            f: "ATGCGATCGATCGATCG",
            r: "GCTAGCTAGCTAGCTAG",
            tm_f: 62.5,
            tm_r: 61.3,
            gc_f: 52.9,
            gc_r: 47.1,
            full_length_f: 31,
            full_length_r: 32,
            insert_length: 1500,
            quality: { tm_delta: 1.2, cross_dimer: false },
            conditions: { anneal_c: 58, extension_sec: 90 },
          },
        ],
      },
    };

    const result = normalizeAgentResponse(raw);
    const c0 = result.candidates[0]!;
    expect(c0.forwardPrimer).toBe("ATGCGATCGATCGATCG");
    expect(c0.reversePrimer).toBe("GCTAGCTAGCTAGCTAG");
    expect(c0.tmForward).toBe(62.5);
    expect(c0.tmReverse).toBe(61.3);
    expect(c0.insertLength).toBe(1500);
    expect(c0.tmDelta).toBe(1.2);
    expect(c0.crossDimer).toBe(false);
    expect(c0.annealTemp).toBe(58);
    expect(c0.extensionSec).toBe(90);
    // New fields also populated
    expect(c0.workspace).toBe("cloning");
    expect(c0.sequenceRows).toHaveLength(2);
    expect(c0.metrics?.length).toBeGreaterThan(0);
  });
});
