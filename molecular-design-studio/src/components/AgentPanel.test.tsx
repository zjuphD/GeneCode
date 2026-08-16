import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import AgentPanel from "./AgentPanel";
import type { SequenceDocument } from "../types";
import type { PatchPreview } from "../agent/patchTypes";
import type { ServiceStatus, RequestPhase, ConversationMessage } from "../agent/useAgentSession";
import type { PlanRow, RunLogRow, AgentRecommendation, AgentRunMeta, ResultCandidate, PlanProvenance } from "../agent/responseTypes";
import type { AgentConversationHistoryEntry } from "../agent/conversationHistory";
import { parseSequenceFile } from "../editor/fileFormats";
import { chooseSequenceFile, readSequenceFile } from "../services/sequenceFiles";

vi.mock("../agent/conversationHistory", () => ({
  loadConversationHistory: vi.fn(() => []),
  CONVERSATION_HISTORY_UPDATED_EVENT: "molecular-design-studio:agent-conversation-history-updated",
}));

import { loadConversationHistory } from "../agent/conversationHistory";

vi.mock("../editor/fileFormats", () => ({
  parseSequenceFile: vi.fn(),
}));

vi.mock("../services/sequenceFiles", () => ({
  chooseSequenceFile: vi.fn(),
  readSequenceFile: vi.fn(),
}));

// Mock the useAgentSession hook
interface MockSession {
  serviceStatus: ServiceStatus;
  healthLabel: string;
  messages: ConversationMessage[];
  plan: PlanRow[];
  draft: Record<string, unknown> | null;
  readyToExecute: boolean;
  runLog: RunLogRow[];
  timeline: unknown[];
  recommendation: AgentRecommendation | null;
  artifactPackage: unknown;
  taskConfirmation: unknown;
  resultCount: number | null;
  candidates: ResultCandidate[];
  agentRun: AgentRunMeta;
  workspace: "cloning" | "rtqpcr" | "sgrna" | "sirna" | "mutagenesis";
  phase: RequestPhase;
  error: string | null;
  lastUserGoal: string;
  sequencePatch: unknown;
  planSnapshotHash: string | null;
  agentMode: string;
  validationStatus: "idle" | "running" | "completed" | "error";
  validationMessages: string[];
  validationResults: Array<Record<string, unknown>>;
  planProvenance: PlanProvenance | null;
  checkHealth: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  cancelRequest: ReturnType<typeof vi.fn>;
  executeDesign: ReturnType<typeof vi.fn>;
  validateResults: ReturnType<typeof vi.fn>;
  clearSession: ReturnType<typeof vi.fn>;
  clearError: ReturnType<typeof vi.fn>;
  restoreConversation: ReturnType<typeof vi.fn>;
  onDocumentHashChange: ReturnType<typeof vi.fn>;
  onSequencePatchReceived: ((patch: unknown) => void) | null;
  setOnSequencePatchReceived: ReturnType<typeof vi.fn>;
  setAgentMode: ReturnType<typeof vi.fn>;
}

const mockSession: MockSession = {
  serviceStatus: "online",
  healthLabel: "Online",
  messages: [],
  plan: [],
  draft: null,
  readyToExecute: false,
  runLog: [],
  timeline: [],
  recommendation: null,
  artifactPackage: null,
  taskConfirmation: null,
  resultCount: null,
  candidates: [],
  agentRun: { runId: null, status: null },
  workspace: "cloning",
  phase: "idle",
  error: null,
  lastUserGoal: "",
  sequencePatch: undefined,
  planSnapshotHash: null,
  agentMode: "plan",
  validationStatus: "idle",
  validationMessages: [],
  validationResults: [],
  planProvenance: null,
  checkHealth: vi.fn(),
  sendMessage: vi.fn(),
  cancelRequest: vi.fn(),
  executeDesign: vi.fn(),
  validateResults: vi.fn(),
  clearSession: vi.fn(),
  clearError: vi.fn(),
  restoreConversation: vi.fn(),
  onDocumentHashChange: vi.fn(),
  onSequencePatchReceived: null,
  setOnSequencePatchReceived: vi.fn(),
  setAgentMode: vi.fn(),
};

vi.mock("../agent/useAgentSession", () => ({
  useAgentSession: () => mockSession,
}));

function makeDoc(overrides: Partial<SequenceDocument> = {}): SequenceDocument {
  return {
    name: "test_seq",
    sequence: "ATCGATCGATCGATCG",
    circular: false,
    features: [],
    ...overrides,
  };
}

function makePreview(overrides: Partial<PatchPreview> = {}): PatchPreview {
  return {
    patchId: "p1",
    title: "Test Patch",
    summary: "A test",
    baseHash: "fnv1a64-v1:abc",
    proposedHash: "fnv1a64-v1:def",
    beforeLength: 16,
    afterLength: 16,
    operations: [],
    affectedFeatures: [],
    warnings: [],
    errors: [],
    proposedDocument: null,
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<ResultCandidate> = {}): ResultCandidate {
  return {
    title: null,
    summary: null,
    forwardPrimer: "ATGCGATCGATCG",
    reversePrimer: "GCTAGCTAGCTAG",
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
    workspace: "cloning",
    sequenceRows: [],
    metrics: [],
    ...overrides,
  };
}

function setClipboard(writeText?: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

describe("AgentPanel", () => {
  let onLoadPreview: ReturnType<typeof vi.fn>;
  let onApply: ReturnType<typeof vi.fn>;
  let onReject: ReturnType<typeof vi.fn>;
  let onRevert: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onLoadPreview = vi.fn().mockReturnValue(true);
    onApply = vi.fn();
    onReject = vi.fn();
    onRevert = vi.fn();

    // Reset mock session
    mockSession.serviceStatus = "online";
    mockSession.healthLabel = "Online";
    mockSession.messages = [];
    mockSession.plan = [];
    mockSession.draft = null;
    mockSession.readyToExecute = false;
    mockSession.runLog = [];
    mockSession.recommendation = null;
    mockSession.taskConfirmation = null;
    mockSession.resultCount = null;
    mockSession.candidates = [];
    mockSession.agentRun = { runId: null, status: null };
    mockSession.workspace = "cloning";
    mockSession.phase = "idle";
    mockSession.error = null;
    mockSession.lastUserGoal = "";
    mockSession.sequencePatch = undefined;
    mockSession.agentMode = "plan";
    mockSession.validationStatus = "idle";
    mockSession.validationMessages = [];
    mockSession.validationResults = [];
    mockSession.planProvenance = null;
    mockSession.checkHealth.mockClear();
    mockSession.sendMessage.mockClear();
    mockSession.cancelRequest.mockClear();
    mockSession.executeDesign.mockClear();
    mockSession.clearSession.mockClear();
    mockSession.clearError.mockClear();
    mockSession.restoreConversation.mockClear();
    vi.mocked(loadConversationHistory).mockReturnValue([]);
    mockSession.onDocumentHashChange.mockClear();
    mockSession.setOnSequencePatchReceived.mockClear();
    vi.mocked(chooseSequenceFile).mockReset();
    vi.mocked(readSequenceFile).mockReset();
    vi.mocked(parseSequenceFile).mockReset();
    window.localStorage.removeItem("genecode-agent-panel-width");
    setClipboard(vi.fn().mockResolvedValue(undefined));
  });

  const defaultProps = () => ({
    doc: makeDoc(),
    selection: null as import("../types").SequenceSelection | null,
    pendingPreview: null as PatchPreview | null,
    revertDocument: null as SequenceDocument | null,
    onLoadPreview,
    onApply,
    onReject,
    onRevert,
  });

  it("shows GeneCode Agent identity and document context in task stream", () => {
    render(<AgentPanel {...defaultProps()} />);
    expect(screen.getByText("GeneCode Agent")).toBeDefined();
    expect(screen.getByText("序列信息")).toBeDefined();
    expect(screen.getByText(/test_seq/)).toBeDefined();
    expect(screen.getByText(/16 bp/)).toBeDefined();
    expect(screen.getByText(/Linear/)).toBeDefined();
  });

  it("offers to continue a saved conversation instead of only showing its transcript", () => {
    const entry: AgentConversationHistoryEntry = {
      id: "conv-1",
      title: "Design RT-qPCR primers",
      workspace: "rtqpcr",
      agentMode: "plan",
      timestamp: Date.now(),
      messages: [
        { role: "user", content: "Design RT-qPCR primers" },
        { role: "assistant", content: "Please provide the target gene." },
      ],
      runId: null,
    };
    vi.mocked(loadConversationHistory).mockReturnValue([entry]);

    render(<AgentPanel {...defaultProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "历史对话" }));
    expect(screen.getByRole("button", { name: "继续对话：Design RT-qPCR primers" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "继续对话：Design RT-qPCR primers" }));

    expect(mockSession.restoreConversation).toHaveBeenCalledWith(entry);
    expect(screen.queryByRole("region", { name: "Agent 历史对话" })).toBeNull();
  });

  it("shows an LLM-planning badge when the execute was LLM-planned", () => {
    mockSession.planProvenance = { source: "llm", validated: true, errors: [] };
    render(<AgentPanel {...defaultProps()} />);
    const badge = screen.getByText("LLM 规划");
    expect(badge).toBeDefined();
    expect(badge.className).toContain("agent-planned-by--llm");
  });

  it("shows a rules-planning badge by default", () => {
    mockSession.planProvenance = { source: "rules", validated: false, errors: [] };
    render(<AgentPanel {...defaultProps()} />);
    const badge = screen.getByText("规则规划");
    expect(badge).toBeDefined();
    expect(badge.className).toContain("agent-planned-by--rules");
  });

  it("shows a fallback badge when the LLM plan was rejected", () => {
    mockSession.planProvenance = {
      source: "rules",
      validated: false,
      errors: ["计划包含执行器暂不支持的共享工具：parse_sequence"],
    };
    render(<AgentPanel {...defaultProps()} />);
    const badge = screen.getByText("已回退规则规划");
    expect(badge).toBeDefined();
    expect(badge.className).toContain("agent-planned-by--fallback");
    expect(badge.getAttribute("title")).toContain("parse_sequence");
  });

  it("submits structured cloning parameters from the confirmation panel", () => {
    mockSession.messages = [
      { role: "user", content: "把 GFP 插入 CDS1 后面并保持阅读框" },
      { role: "assistant", content: "还需要确认表达策略。" },
    ];
    mockSession.lastUserGoal = "把 GFP 插入 CDS1 后面并保持阅读框";
    mockSession.taskConfirmation = {
      taskType: "cloning",
      canProceed: false,
      confidence: null,
      blockers: [],
      missingParameters: [{
        key: "expressionStrategy",
        label: "请选择融合蛋白、P2A 或 IRES。",
        kind: "select",
        options: [
          { value: "fusion", label: "融合蛋白" },
          { value: "p2a", label: "P2A 共表达" },
          { value: "ires", label: "IRES 共表达" },
        ],
      }],
      assumptions: [],
      warnings: [],
      extractedParameters: {},
      requiresConfirmation: true,
    };

    render(<AgentPanel {...defaultProps()} />);

    fireEvent.change(screen.getByLabelText("表达策略"), {
      target: { value: "fusion" },
    });
    fireEvent.click(screen.getByRole("button", { name: "已填 1 项" }));

    expect(mockSession.sendMessage).toHaveBeenCalledWith(
      "Continue the current molecular design task with these structured inputs.",
      expect.objectContaining({ name: "test_seq" }),
      "cloning",
      null,
      undefined,
      "Expression strategy: fusion",
      { expressionStrategy: "fusion" },
    );
  });

  it("shows ordinary selection metadata in the sequence info node", () => {
    const selection = {
      start: 10,
      end: 21,
      length: 11,
      wrapsOrigin: false,
      sequence: "ATCGATCGATC",
    };
    render(<AgentPanel {...defaultProps()} selection={selection} />);
    // One-based display: 11–21
    expect(screen.getByText(/Selection 11–21/)).toBeDefined();
    expect(screen.getByText(/11 bp/)).toBeDefined();
    // Should NOT show wraps origin
    expect(screen.queryByText(/wraps origin/)).toBeNull();
    // Should NOT render raw sequence
    expect(screen.queryByText("ATCGATCGATC")).toBeNull();
  });

  it("shows wrapped selection metadata in the sequence info node with honest range", () => {
    const selection = {
      start: 12,
      end: 4,
      length: 8,
      wrapsOrigin: true,
      sequence: "ATCGATCG",
    };
    render(<AgentPanel {...defaultProps()} selection={selection} />);
    // Wrapped: show 13–16 / 1–4 (one-based)
    expect(screen.getByText(/Selection 13–16 \/ 1–4/)).toBeDefined();
    expect(screen.getByText(/8 bp/)).toBeDefined();
    expect(screen.getByText(/wraps origin/)).toBeDefined();
    // Should NOT render raw sequence
    expect(screen.queryByText("ATCGATCG")).toBeNull();
  });

  it("shows one unified Agent entry with example tasks", () => {
    render(<AgentPanel {...defaultProps()} />);
    expect(screen.getByRole("heading", { name: "你好，chen" })).toBeDefined();
    expect(screen.getByText(/虚拟分子生物学协作者/)).toBeDefined();
    expect(screen.getByText("新建分子设计")).toBeDefined();
    expect(screen.getByText("示例任务")).toBeDefined();
    expect(screen.getByText("将插入片段克隆到载体")).toBeDefined();
    expect(screen.getByText("设计 RT-qPCR 引物")).toBeDefined();
    expect(screen.getByText("设计 KO sgRNA")).toBeDefined();
    expect(screen.getByText("设计 siRNA 双链体")).toBeDefined();
    expect(screen.getByText("DNA 点突变引物")).toBeDefined();
    expect(screen.queryByLabelText("Agent workspace")).toBeNull();
  });

  it("does not add a separate multi-fragment cloning card to the default stream", () => {
    render(<AgentPanel {...defaultProps()} />);
    expect(screen.queryByText("多片段克隆")).toBeNull();
  });

  it("does not treat internal context-change notices as a conversation", () => {
    mockSession.messages = [
      { role: "assistant", content: "[Context changed — prior plan and draft cleared]" },
      { role: "assistant", content: "[Context changed — prior plan and draft cleared]" },
    ];
    render(<AgentPanel {...defaultProps()} />);

    expect(screen.getByText("新建分子设计")).toBeDefined();
    expect(screen.queryByText("Planning")).toBeNull();
    expect(screen.queryByText("[Context changed — prior plan and draft cleared]")).toBeNull();
  });

  it("shows a compact context update after real task activity", () => {
    mockSession.lastUserGoal = "Design primers";
    mockSession.messages = [
      { role: "user", content: "Design primers" },
      { role: "assistant", content: "[Context changed — prior plan and draft cleared]" },
    ];
    render(<AgentPanel {...defaultProps()} />);

    expect(screen.getByText("Sequence changed; the previous draft was cleared.")).toBeDefined();
    expect(screen.queryByText("[Context changed — prior plan and draft cleared]")).toBeNull();
  });

  it("shows No document state when doc is null", () => {
    render(<AgentPanel {...defaultProps()} doc={null} />);
    expect(screen.getByText("无文档")).toBeDefined();
    expect(screen.getByText("打开序列文件以开始")).toBeDefined();
    expect(screen.queryByText("Clone insert into vector")).toBeNull();
    expect(screen.queryByText("New molecular design")).toBeNull();
  });

  it("pins the starter workspace so snapshot slots match the task", () => {
    render(<AgentPanel {...defaultProps()} />);
    fireEvent.click(screen.getByText("将插入片段克隆到载体"));
    expect(mockSession.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockSession.sendMessage.mock.calls[0]![0]).toContain("clone an insert");
    expect(mockSession.sendMessage.mock.calls[0]![1]).toEqual(makeDoc());
    expect(mockSession.sendMessage.mock.calls[0]![2]).toBe("cloning");
  });

  it("uses the live OVE document and selection when starting an Agent action", () => {
    const liveDocument = makeDoc({ name: "live_editor", sequence: "AACCGGTT" });
    const liveSelection = {
      start: 2,
      end: 6,
      length: 4,
      wrapsOrigin: false,
      sequence: "CCGG",
    };
    render(
      <AgentPanel
        {...defaultProps()}
        getLiveEditorContext={() => ({
          document: liveDocument,
          selection: liveSelection,
          caretPosition: null,
        })}
      />,
    );

    fireEvent.click(screen.getByText("将插入片段克隆到载体"));

    expect(mockSession.sendMessage.mock.calls[0]?.[1]).toEqual(liveDocument);
    expect(mockSession.sendMessage.mock.calls[0]?.[3]).toEqual(liveSelection);
  });

  it("preserves a live OVE caret as an insertion cursor for the Agent", () => {
    const liveDocument = makeDoc({ name: "live_editor", sequence: "AACCGGTT" });
    render(
      <AgentPanel
        {...defaultProps()}
        getLiveEditorContext={() => ({
          document: liveDocument,
          selection: null,
          caretPosition: 3,
        })}
      />,
    );

    fireEvent.click(screen.getByText("将插入片段克隆到载体"));

    expect(mockSession.sendMessage.mock.calls[0]?.[3]).toEqual({
      start: 3,
      end: 3,
      length: 0,
      wrapsOrigin: false,
      sequence: "",
      cursor: true,
    });
  });

  it("locks an RT-qPCR starter to the rtqpcr workspace", () => {
    render(<AgentPanel {...defaultProps()} />);
    fireEvent.click(screen.getByText("设计 RT-qPCR 引物"));
    expect(mockSession.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockSession.sendMessage.mock.calls[0]![2]).toBe("rtqpcr");
  });

  it("shows the detected task type as read-only metadata", () => {
    mockSession.workspace = "rtqpcr";
    mockSession.lastUserGoal = "Review this assay";
    render(<AgentPanel {...defaultProps()} />);
    const taskType = screen.getByLabelText("检测到的任务类型");
    expect(taskType.textContent).toContain("RT-qPCR");
    expect(taskType.textContent).toContain("自动检测");
  });

  it("uses the current goal to avoid showing a stale task type", () => {
    mockSession.workspace = "cloning";
    mockSession.lastUserGoal = "Design knockout sgRNAs using SpCas9 NGG";
    render(<AgentPanel {...defaultProps()} />);
    expect(screen.getByLabelText("检测到的任务类型").textContent).toContain("sgRNA");
    expect(screen.queryByText("Multi-fragment cloning")).toBeNull();
  });

  it("sends free-form messages without forcing the previous task type", () => {
    mockSession.workspace = "rtqpcr";
    render(<AgentPanel {...defaultProps()} />);
    const input = screen.getByLabelText("Agent message input");
    fireEvent.change(input, { target: { value: "Design sgRNAs for this target" } });
    fireEvent.click(screen.getByText("发送"));
    expect(mockSession.sendMessage).toHaveBeenCalledWith(
      "Design sgRNAs for this target",
      makeDoc(),
      undefined,
      null,
    );
  });

  it("attaches a sequence file without dumping bases into the visible message", async () => {
    const attached = makeDoc({
      name: "EGFP",
      sequence: "ATGC".repeat(180),
      features: [{
        id: "egfp-cds",
        name: "EGFP",
        type: "CDS",
        start: 0,
        end: 720,
        strand: 1,
        qualifiers: {},
      }],
    });
    vi.mocked(chooseSequenceFile).mockResolvedValue("/tmp/EGFP.gb");
    vi.mocked(readSequenceFile).mockResolvedValue("LOCUS EGFP");
    vi.mocked(parseSequenceFile).mockResolvedValue(attached);

    render(<AgentPanel {...defaultProps()} />);
    fireEvent.click(screen.getByLabelText("Attach sequence file"));

    await waitFor(() => expect(screen.getByText("EGFP")).toBeDefined());
    expect(screen.getByText(/720 bp · 线性 · 1 个特征/)).toBeDefined();
    expect(screen.queryByText(attached.sequence)).toBeNull();

    fireEvent.change(screen.getByLabelText("Agent message input"), {
      target: { value: "Insert this after APOBEC3A" },
    });
    fireEvent.click(screen.getByText("发送"));

    expect(mockSession.sendMessage).toHaveBeenCalledWith(
      "Insert this after APOBEC3A",
      makeDoc(),
      undefined,
      null,
      {
        name: "EGFP",
        sequence: attached.sequence,
        circular: false,
        featureCount: 1,
      },
      "Insert this after APOBEC3A\n附件：EGFP · 720 bp",
    );
  });

  it("forwards a pending attached sequence when starting from a starter chip", async () => {
    const attached = makeDoc({
      name: "EGFP",
      sequence: "ATGC".repeat(180),
      features: [{
        id: "egfp-cds",
        name: "EGFP",
        type: "CDS",
        start: 0,
        end: 720,
        strand: 1,
        qualifiers: {},
      }],
    });
    vi.mocked(chooseSequenceFile).mockResolvedValue("/tmp/EGFP.gb");
    vi.mocked(readSequenceFile).mockResolvedValue("LOCUS EGFP");
    vi.mocked(parseSequenceFile).mockResolvedValue(attached);

    render(<AgentPanel {...defaultProps()} />);
    fireEvent.click(screen.getByLabelText("Attach sequence file"));
    await waitFor(() => expect(screen.getByText("EGFP")).toBeDefined());

    fireEvent.click(screen.getByText("将插入片段克隆到载体"));

    expect(mockSession.sendMessage).toHaveBeenCalledTimes(1);
    const call = mockSession.sendMessage.mock.calls[0]!;
    // Workspace is pinned to the starter and the attachment is forwarded.
    expect(call[2]).toBe("cloning");
    expect(call[4]).toEqual({
      name: "EGFP",
      sequence: attached.sequence,
      circular: false,
      featureCount: 1,
    });
  });

  it("shows preview when pendingPreview is set", () => {
    render(<AgentPanel {...defaultProps()} pendingPreview={makePreview()} />);
    expect(screen.getByText("Test Patch")).toBeDefined();
    expect(screen.getByText("应用到载体")).toBeDefined();
    expect(screen.getByText("拒绝")).toBeDefined();
  });

  it("calls onApply when Apply is clicked", () => {
    render(<AgentPanel {...defaultProps()} pendingPreview={makePreview()} />);
    fireEvent.click(screen.getByText("应用到载体"));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("calls onReject when Reject is clicked", () => {
    render(<AgentPanel {...defaultProps()} pendingPreview={makePreview()} />);
    fireEvent.click(screen.getByText("拒绝"));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("shows the copy-to-new-file action and calls onApplyAsNewFile when clicked", () => {
    const onApplyAsNewFile = vi.fn();
    render(
      <AgentPanel
        {...defaultProps()}
        pendingPreview={makePreview()}
        onApplyAsNewFile={onApplyAsNewFile}
      />,
    );
    expect(screen.getByText("复制为新文件并应用")).toBeDefined();
    expect(screen.getByText(/原文件保持不变/)).toBeDefined();
    fireEvent.click(screen.getByText("复制为新文件并应用"));
    expect(onApplyAsNewFile).toHaveBeenCalledTimes(1);
  });

  it("hides the copy-to-new-file action when no handler is provided", () => {
    render(<AgentPanel {...defaultProps()} pendingPreview={makePreview()} />);
    expect(screen.queryByText("复制为新文件并应用")).toBeNull();
  });

  // ── Auto mode: apply to a copy without confirmation ─────────

  it("auto-applies a valid preview to a copy in auto mode without confirmation", () => {
    const onApplyAsNewFile = vi.fn();
    mockSession.agentMode = "auto";
    render(
      <AgentPanel
        {...defaultProps()}
        pendingPreview={makePreview()}
        onApplyAsNewFile={onApplyAsNewFile}
      />,
    );
    expect(onApplyAsNewFile).toHaveBeenCalledTimes(1);
  });

  it("does not auto-apply in guided/plan mode", () => {
    const onApplyAsNewFile = vi.fn();
    mockSession.agentMode = "plan";
    render(
      <AgentPanel
        {...defaultProps()}
        pendingPreview={makePreview()}
        onApplyAsNewFile={onApplyAsNewFile}
      />,
    );
    expect(onApplyAsNewFile).not.toHaveBeenCalled();
  });

  it("does not auto-apply a planning-stage patch that is awaiting execution confirmation", () => {
    // A plan response may attach a draft sequencePatch while the plan is
    // still awaiting the user's "Confirm and run" (readyToExecute is true).
    // Auto-applying that sketch would open a copy before the real design ran.
    const onApplyAsNewFile = vi.fn();
    mockSession.agentMode = "auto";
    mockSession.readyToExecute = true;
    render(
      <AgentPanel
        {...defaultProps()}
        pendingPreview={makePreview()}
        onApplyAsNewFile={onApplyAsNewFile}
      />,
    );
    expect(onApplyAsNewFile).not.toHaveBeenCalled();
  });

  it("never auto-applies a plan sketch even after readyToExecute flips to false", () => {
    // Regression: a plan-stage sketch is blocked while readyToExecute is true;
    // if execution then completes WITHOUT producing a fresh patch, the stale
    // sketch must still not be auto-applied when readyToExecute flips false.
    const onApplyAsNewFile = vi.fn();
    mockSession.agentMode = "auto";
    mockSession.readyToExecute = true;
    const { rerender } = render(
      <AgentPanel
        {...defaultProps()}
        pendingPreview={makePreview({ patchId: "plan-sketch" })}
        onApplyAsNewFile={onApplyAsNewFile}
      />,
    );
    expect(onApplyAsNewFile).not.toHaveBeenCalled();

    // User clicks "Confirm and run"; execution finishes but returns no fresh
    // patch, so the sketch preview stays pending while readyToExecute flips.
    rerender(
      <AgentPanel
        {...defaultProps()}
        pendingPreview={makePreview({ patchId: "plan-sketch" })}
        onApplyAsNewFile={onApplyAsNewFile}
      />,
    );
    mockSession.readyToExecute = false;
    rerender(
      <AgentPanel
        {...defaultProps()}
        pendingPreview={makePreview({ patchId: "plan-sketch" })}
        onApplyAsNewFile={onApplyAsNewFile}
      />,
    );
    expect(onApplyAsNewFile).not.toHaveBeenCalled();

    // A fresh execution-stage patch with a different patchId is applied once.
    mockSession.readyToExecute = false;
    rerender(
      <AgentPanel
        {...defaultProps()}
        pendingPreview={makePreview({ patchId: "execution-final" })}
        onApplyAsNewFile={onApplyAsNewFile}
      />,
    );
    expect(onApplyAsNewFile).toHaveBeenCalledTimes(1);
  });

  it("does not auto-apply a preview with errors in auto mode", () => {
    const onApplyAsNewFile = vi.fn();
    mockSession.agentMode = "auto";
    render(
      <AgentPanel
        {...defaultProps()}
        pendingPreview={makePreview({
          errors: ["Invalid patch schema"],
          proposedDocument: null,
        })}
        onApplyAsNewFile={onApplyAsNewFile}
      />,
    );
    expect(onApplyAsNewFile).not.toHaveBeenCalled();
  });

  // ── Auto mode: pure design results archived to CSV (no patch) ──

  function stubCsvDownload() {
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    const anchorClick = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const originalClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    HTMLAnchorElement.prototype.click = anchorClick;
    return {
      createObjectURL,
      revokeObjectURL,
      anchorClick,
      restore() {
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
        HTMLAnchorElement.prototype.click = originalClick;
      },
    };
  }

  it("auto-archives pure design results to a CSV download in auto mode when there is no patch", () => {
    const download = stubCsvDownload();
    try {
      mockSession.agentMode = "auto";
      mockSession.phase = "idle";
      mockSession.agentRun = { runId: "run-pure", status: "completed" };
      mockSession.candidates = [makeCandidate({
        title: "Primer pair",
        summary: "Designed",
        forwardPrimer: "ATGCGATCG",
        reversePrimer: "GCTAGCTAG",
        tmForward: 62.5,
        tmReverse: 61.3,
        gcForward: 52.9,
        gcReverse: 47.1,
        fullLengthForward: 31,
        fullLengthReverse: 32,
        metrics: ["Tm delta 1.2°C", "GC 52.9%/47.1%"],
        sequenceRows: [
          { label: "Forward", value: "ATGCGATCG" },
          { label: "Reverse", value: "GCTAGCTAG" },
        ],
      })];
      mockSession.resultCount = 1;

      render(<AgentPanel {...defaultProps()} />);

      // The run was archived to a file and the notice explains where it went.
      expect(screen.getByText("已自动归档")).toBeDefined();
      expect(screen.getByText(/genecode-cloning-run-pure\.csv/)).toBeDefined();
      expect(screen.getByText(/纯设计结果（无序列改动）/)).toBeDefined();
      expect(download.createObjectURL).toHaveBeenCalledTimes(1);
      expect(download.anchorClick).toHaveBeenCalledTimes(1);
      // The exported blob is a real CSV with the candidate columns.
      const calls = download.createObjectURL.mock.calls as unknown as Array<[Blob]>;
      expect(calls[0]![0].type).toBe("text/csv;charset=utf-8");
    } finally {
      download.restore();
    }
  });

  it("does not re-download the same archived run on re-renders", () => {
    const download = stubCsvDownload();
    try {
      mockSession.agentMode = "auto";
      mockSession.phase = "idle";
      mockSession.agentRun = { runId: "run-pure", status: "completed" };
      mockSession.candidates = [makeCandidate()];
      mockSession.resultCount = 1;

      const { rerender } = render(<AgentPanel {...defaultProps()} />);
      expect(download.anchorClick).toHaveBeenCalledTimes(1);

      // Candidate/marker refresh re-renders must not re-export the same run.
      rerender(<AgentPanel {...defaultProps()} />);
      expect(download.anchorClick).toHaveBeenCalledTimes(1);
      expect(screen.getByText("已自动归档")).toBeDefined();
    } finally {
      download.restore();
    }
  });

  it("does not auto-archive in plan mode or while a patch preview is pending", () => {
    const download = stubCsvDownload();
    try {
      // Plan mode: no auto-archive.
      mockSession.agentMode = "plan";
      mockSession.phase = "idle";
      mockSession.agentRun = { runId: "run-plan", status: "completed" };
      mockSession.candidates = [makeCandidate()];
      mockSession.resultCount = 1;
      render(<AgentPanel {...defaultProps()} />);
      expect(screen.queryByText("已自动归档")).toBeNull();
      expect(download.anchorClick).not.toHaveBeenCalled();

      // Auto mode but a patch preview is pending → the copy/diff flow owns the
      // landing point; no CSV archive.
      mockSession.agentMode = "auto";
      mockSession.agentRun = { runId: "run-patch", status: "completed" };
      render(
        <AgentPanel
          {...defaultProps()}
          pendingPreview={makePreview()}
        />,
      );
      expect(screen.queryByText("已自动归档")).toBeNull();
      expect(download.anchorClick).not.toHaveBeenCalled();
    } finally {
      download.restore();
    }
  });

  it("re-exports the CSV when the user clicks the re-download action", () => {
    const download = stubCsvDownload();
    try {
      mockSession.agentMode = "auto";
      mockSession.phase = "idle";
      mockSession.agentRun = { runId: "run-pure", status: "completed" };
      mockSession.candidates = [makeCandidate()];
      mockSession.resultCount = 1;

      render(<AgentPanel {...defaultProps()} />);
      expect(download.anchorClick).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByText("重新导出 CSV"));
      expect(download.anchorClick).toHaveBeenCalledTimes(2);
    } finally {
      download.restore();
    }
  });

  it("does not auto-apply twice for the same preview in auto mode", () => {
    const onApplyAsNewFile = vi.fn();
    mockSession.agentMode = "auto";
    const { rerender } = render(
      <AgentPanel
        {...defaultProps()}
        pendingPreview={makePreview()}
        onApplyAsNewFile={onApplyAsNewFile}
      />,
    );
    expect(onApplyAsNewFile).toHaveBeenCalledTimes(1);
    // Same patchId re-render (e.g. marker refresh) must not re-apply.
    rerender(
      <AgentPanel
        {...defaultProps()}
        pendingPreview={makePreview()}
        onApplyAsNewFile={onApplyAsNewFile}
      />,
    );
    expect(onApplyAsNewFile).toHaveBeenCalledTimes(1);
  });

  it("reports patch diff markers from the pending preview", () => {
    const onPatchDiffMarkersChange = vi.fn();
    render(
      <AgentPanel
        {...defaultProps()}
        onPatchDiffMarkersChange={onPatchDiffMarkersChange}
        pendingPreview={makePreview({
          beforeLength: 100,
          operations: [{
            operationId: "op1",
            kind: "insert",
            coordinates: "@50",
            reason: "add MCS",
            lengthDelta: 4,
            position: 50,
          }],
        })}
      />,
    );
    expect(onPatchDiffMarkersChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "op1",
        kind: "insert",
        start: 50,
        end: 50,
        label: "插入 +4 bp",
      }),
    ]);
  });

  it("clears patch diff markers when no preview is pending", () => {
    const onPatchDiffMarkersChange = vi.fn();
    render(
      <AgentPanel
        {...defaultProps()}
        onPatchDiffMarkersChange={onPatchDiffMarkersChange}
      />,
    );
    expect(onPatchDiffMarkersChange).toHaveBeenCalledWith([]);
  });

  it("plays the diff timeline: starts unrevealed, then lights markers one by one", () => {
    vi.useFakeTimers();
    try {
      const onDiffRevealChange = vi.fn();
      render(
        <AgentPanel
          {...defaultProps()}
          onDiffRevealChange={onDiffRevealChange}
          pendingPreview={makePreview({
            beforeLength: 100,
            operations: [
              {
                operationId: "op1",
                kind: "insert",
                coordinates: "@50",
                reason: "add MCS",
                lengthDelta: 4,
                position: 50,
              },
              {
                operationId: "op2",
                kind: "delete",
                coordinates: "[10, 20)",
                reason: "remove linker",
                lengthDelta: -10,
                start: 10,
                end: 20,
              },
            ],
          })}
        />,
      );
      // Nothing lit until the first tick fires.
      expect(onDiffRevealChange).toHaveBeenLastCalledWith(0);
      // One tick lights the first marker only (still a ghost for the second).
      act(() => {
        vi.advanceTimersByTime(340);
      });
      expect(onDiffRevealChange).toHaveBeenLastCalledWith(1);
      // After the second tick the whole set is lit.
      act(() => {
        vi.advanceTimersByTime(340);
      });
      expect(onDiffRevealChange).toHaveBeenLastCalledWith(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports zero reveal when no preview is pending", () => {
    const onDiffRevealChange = vi.fn();
    render(
      <AgentPanel
        {...defaultProps()}
        onDiffRevealChange={onDiffRevealChange}
      />,
    );
    expect(onDiffRevealChange).toHaveBeenCalledWith(0);
  });

  it("auto-locates the last lit diff region and focuses its operation row when playback finishes", () => {
    vi.useFakeTimers();
    try {
      const onLocateRegion = vi.fn();
      const { container } = render(
        <AgentPanel
          {...defaultProps()}
          doc={makeDoc({ sequence: "A".repeat(100) })}
          onLocateRegion={onLocateRegion}
          pendingPreview={makePreview({
            beforeLength: 100,
            operations: [
              {
                operationId: "op1",
                kind: "insert",
                coordinates: "@50",
                reason: "add MCS",
                lengthDelta: 4,
                position: 50,
              },
              {
                operationId: "op2",
                kind: "delete",
                coordinates: "[10, 20)",
                reason: "remove linker",
                lengthDelta: -10,
                start: 10,
                end: 20,
              },
            ],
          })}
        />,
      );
      // Before playback completes nothing is located or focused.
      expect(onLocateRegion).not.toHaveBeenCalled();
      expect(container.querySelector(".patch-preview__ops-row--focused")).toBeNull();

      // Play the whole timeline: two markers → two ticks → finished.
      act(() => {
        vi.advanceTimersByTime(340);
      });
      expect(onLocateRegion).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(340);
      });

      // The editor is located on the LAST lit region (the delete, in the
      // before-sequence coordinates) and its operation row is focused.
      expect(onLocateRegion).toHaveBeenCalledTimes(1);
      const region = onLocateRegion.mock.calls[0]![0] as { start: number; end: number; label: string };
      expect(region.start).toBe(10);
      expect(region.end).toBe(20);
      expect(region.label).toBe("删除 10 bp");
      const focused = container.querySelector(".patch-preview__ops-row--focused");
      expect(focused).not.toBeNull();
      expect(focused!.getAttribute("data-focused")).toBe("true");
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-locates a zero-width insert by widening it to one base", () => {
    vi.useFakeTimers();
    try {
      const onLocateRegion = vi.fn();
      render(
        <AgentPanel
          {...defaultProps()}
          doc={makeDoc({ sequence: "A".repeat(100) })}
          onLocateRegion={onLocateRegion}
          pendingPreview={makePreview({
            beforeLength: 100,
            operations: [{
              operationId: "op1",
              kind: "insert",
              coordinates: "@50",
              reason: "add MCS",
              lengthDelta: 4,
              position: 50,
            }],
          })}
        />,
      );
      act(() => {
        vi.advanceTimersByTime(340);
      });
      expect(onLocateRegion).toHaveBeenCalledTimes(1);
      const region = onLocateRegion.mock.calls[0]![0] as { start: number; end: number };
      expect(region.start).toBe(50);
      expect(region.end).toBe(51);
    } finally {
      vi.useRealTimers();
    }
  });

  it("restarts the reveal at zero when the preview is swapped", () => {
    vi.useFakeTimers();
    try {
      const onDiffRevealChange = vi.fn();
      const preview = (patchId: string) =>
        makePreview({
          patchId,
          beforeLength: 100,
          operations: [
            {
              operationId: "op1",
              kind: "insert",
              coordinates: "@50",
              reason: "add MCS",
              lengthDelta: 4,
              position: 50,
            },
          ],
        });
      const { rerender } = render(
        <AgentPanel
          {...defaultProps()}
          onDiffRevealChange={onDiffRevealChange}
          pendingPreview={preview("A")}
        />,
      );
      // Preview A plays one marker.
      act(() => {
        vi.advanceTimersByTime(340);
      });
      expect(onDiffRevealChange).toHaveBeenLastCalledWith(1);

      // Preview B arrives: the reveal restarts at zero in the same commit,
      // so the editor never flashes preview A's reveal level against B.
      rerender(
        <AgentPanel
          {...defaultProps()}
          onDiffRevealChange={onDiffRevealChange}
          pendingPreview={preview("B")}
        />,
      );
      expect(onDiffRevealChange).toHaveBeenLastCalledWith(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows revert state after apply", () => {
    render(<AgentPanel {...defaultProps()} revertDocument={makeDoc()} />);
    expect(screen.getByText("补丁已应用")).toBeDefined();
    expect(screen.getByText("撤销上一次 Agent 更改")).toBeDefined();
  });

  it("calls onRevert when revert button is clicked", () => {
    render(<AgentPanel {...defaultProps()} revertDocument={makeDoc()} />);
    fireEvent.click(screen.getByText("撤销上一次 Agent 更改"));
    expect(onRevert).toHaveBeenCalledTimes(1);
  });

  it("can collapse and expand", () => {
    render(<AgentPanel {...defaultProps()} />);
    expect(screen.getByText("新建分子设计")).toBeDefined();

    fireEvent.click(screen.getByTitle("Collapse"));
    expect(screen.queryByText("New molecular design")).toBeNull();

    fireEvent.click(screen.getByTitle("Expand"));
    expect(screen.getByText("新建分子设计")).toBeDefined();
  });

  // ── Service status ─────────────────────────────────────────

  it("shows offline state when service is offline", () => {
    mockSession.serviceStatus = "offline";
    mockSession.healthLabel = "Cannot reach Agent service";
    render(<AgentPanel {...defaultProps()} />);
    expect(screen.getByText("本地 Agent 服务不可用。")).toBeDefined();
    expect(screen.getByText("预期地址：http://127.0.0.1:8000")).toBeDefined();
    expect(screen.getByText("重试")).toBeDefined();
  });

  it("shows starting state while the service launcher runs", () => {
    mockSession.serviceStatus = "starting";
    mockSession.healthLabel = "Starting\u2026";
    render(<AgentPanel {...defaultProps()} />);
    expect(screen.getAllByText("Starting\u2026").length).toBeGreaterThan(0);
    expect(screen.queryByText("Clone insert into vector")).toBeNull();
  });

  it("calls checkHealth when Retry is clicked", () => {
    mockSession.serviceStatus = "offline";
    mockSession.healthLabel = "Unreachable";
    render(<AgentPanel {...defaultProps()} />);
    fireEvent.click(screen.getByText("重试"));
    expect(mockSession.checkHealth).toHaveBeenCalledTimes(1);
  });

  it("shows status dot in header", () => {
    render(<AgentPanel {...defaultProps()} />);
    expect(screen.getByTitle("online")).toBeDefined();
  });

  it("switches permission mode via the dropdown menu", () => {
    render(<AgentPanel {...defaultProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /Agent 权限模式：引导/ }));
    expect(screen.getByRole("menu", { name: "选择 Agent 模式" })).toBeDefined();
    const autoOption = screen.getByRole("menuitemradio", { name: /自动/ });
    fireEvent.click(autoOption);
    expect(mockSession.setAgentMode).toHaveBeenCalledWith("auto");
  });

  it("disables the mode dropdown while the service is offline", () => {
    mockSession.serviceStatus = "offline";
    mockSession.healthLabel = "Offline";
    render(<AgentPanel {...defaultProps()} />);
    const trigger = screen.getByRole("button", { name: /Agent 权限模式：引导/ });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
  });

  // ── Conversation ───────────────────────────────────────────

  it("renders conversation messages in planning node", () => {
    mockSession.messages = [
      { role: "user", content: "Design primers for my gene" },
      { role: "assistant", content: "I can help with that. What gene?" },
    ];
    render(<AgentPanel {...defaultProps()} />);
    expect(screen.getByText("Design primers for my gene")).toBeDefined();
    expect(screen.getByText("I can help with that. What gene?")).toBeDefined();
  });

  it("reveals a newly-arrived Agent reply progressively", async () => {
    mockSession.messages = [{ role: "user", content: "Design primers" }];
    const view = render(<AgentPanel {...defaultProps()} />);

    mockSession.messages = [
      ...mockSession.messages,
      { role: "assistant", content: "I found a suitable design and will explain the checks." },
    ];
    view.rerender(<AgentPanel {...defaultProps()} />);

    await waitFor(() => expect(document.querySelector(".agent-streaming-caret")).not.toBeNull());
    await waitFor(() => expect(screen.getByText("I found a suitable design and will explain the checks.")).toBeDefined());
  });

  it("keeps the current conversation visible while older messages stay hidden", () => {
    mockSession.messages = [
      { role: "user", content: "old message one" },
      { role: "assistant", content: "old message two" },
      { role: "user", content: "recent message one" },
      { role: "assistant", content: "recent message two" },
      { role: "user", content: "recent message three" },
      { role: "assistant", content: "recent message four" },
    ];
    render(<AgentPanel {...defaultProps()} />);

    expect(screen.queryByText("old message one")).toBeNull();
    expect(screen.getByText("recent message four")).toBeDefined();
    expect(screen.getByText("显示 2 条较早消息")).toBeDefined();
    const conversation = screen.getByText("对话").closest("details") as HTMLDetailsElement;
    expect(conversation.open).toBe(true);
    fireEvent.click(screen.getByText("显示 2 条较早消息"));
    expect(screen.getByText("old message one")).toBeDefined();
    expect(screen.getByText("隐藏较早消息")).toBeDefined();
  });

  it("does not pull the user away from earlier messages and offers a Latest action", () => {
    mockSession.messages = [
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
    ];
    const { container } = render(<AgentPanel {...defaultProps()} />);
    const stream = container.querySelector(".task-stream") as HTMLDivElement;
    Object.defineProperties(stream, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, writable: true, value: 100 },
    });

    fireEvent.scroll(stream);

    const latest = screen.getByText("最新");
    expect(latest).toBeDefined();
    fireEvent.click(latest);
    expect(stream.scrollTop).toBe(1000);
    expect(screen.queryByText("Latest")).toBeNull();
  });

  // ── Plan display ───────────────────────────────────────────

  it("renders plan rows in planning task node", () => {
    mockSession.plan = [
      { label: "Analyze sequence", tool: "analyze", status: "pending", summary: "" },
      { label: "Design primers", tool: "primer3", status: "pending", summary: "" },
    ];
    render(<AgentPanel {...defaultProps()} />);
    expect(screen.getByText("规划")).toBeDefined();
    // Labels also appear in the visual step DAG, so scope to the planning node
    const planningNode = screen.getByText("规划").closest(".task-node");
    expect(within(planningNode as HTMLElement).getByText("Analyze sequence")).toBeDefined();
    expect(within(planningNode as HTMLElement).getByText("Design primers")).toBeDefined();
  });

  it("shows Run design button when readyToExecute and draft exist", () => {
    mockSession.plan = [
      { label: "Step 1", tool: "tool", status: "done", summary: "" },
    ];
    mockSession.draft = { type: "cloning", data: {} };
    mockSession.readyToExecute = true;
    render(<AgentPanel {...defaultProps()} />);
    expect(screen.getByText("Confirm plan and generate preview")).toBeDefined();
  });

  it("does not show Run design button when no draft", () => {
    mockSession.plan = [
      { label: "Step 1", tool: "tool", status: "done", summary: "" },
    ];
    mockSession.draft = null;
    render(<AgentPanel {...defaultProps()} />);
    expect(screen.queryByText("Confirm plan and generate preview")).toBeNull();
  });

  it("does not show Run design when readyToExecute is false even with draft", () => {
    mockSession.plan = [
      { label: "Step 1", tool: "tool", status: "done", summary: "" },
    ];
    mockSession.draft = { type: "cloning" };
    mockSession.readyToExecute = false;
    render(<AgentPanel {...defaultProps()} />);
    expect(screen.queryByText("Confirm plan and generate preview")).toBeNull();
  });

  it("calls executeDesign when Run design is clicked", () => {
    mockSession.plan = [
      { label: "Step 1", tool: "tool", status: "done", summary: "" },
    ];
    mockSession.draft = { type: "cloning" };
    mockSession.readyToExecute = true;
    render(<AgentPanel {...defaultProps()} />);
    fireEvent.click(screen.getByText("Confirm plan and generate preview"));
    expect(mockSession.executeDesign).toHaveBeenCalledTimes(1);
    expect(mockSession.executeDesign.mock.calls[0]![1]).toBe("cloning");
  });

  it("disables Run design when phase is not idle", () => {
    mockSession.plan = [
      { label: "Step 1", tool: "tool", status: "done", summary: "" },
    ];
    mockSession.draft = { type: "cloning" };
    mockSession.readyToExecute = true;
    mockSession.phase = "executing";
    render(<AgentPanel {...defaultProps()} />);
    const btn = screen.getByText("Confirm plan and generate preview") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  // ── Auto mode: plan executes without the Confirm-and-run click ──

  it("replaces the Confirm-and-run button with an auto-run note in auto mode", () => {
    mockSession.agentMode = "auto";
    mockSession.plan = [
      { label: "Step 1", tool: "tool", status: "done", summary: "" },
    ];
    mockSession.draft = { type: "cloning" };
    mockSession.readyToExecute = true;
    render(<AgentPanel {...defaultProps()} />);
    // No confirmation button — the plan auto-executes.
    expect(screen.queryByText("Confirm plan and generate preview")).toBeNull();
    expect(screen.queryByText("Confirm and run")).toBeNull();
    expect(screen.getByText(/Auto 模式：计划已就绪，正在自动执行/)).toBeDefined();
    expect(mockSession.executeDesign).not.toHaveBeenCalled(); // hook owns execution
  });

  it("shows a manual Retry run button when auto-execution failed", () => {
    mockSession.agentMode = "auto";
    mockSession.plan = [
      { label: "Step 1", tool: "tool", status: "done", summary: "" },
    ];
    mockSession.draft = { type: "cloning" };
    mockSession.readyToExecute = true;
    mockSession.error = "Execution failed";
    render(<AgentPanel {...defaultProps()} />);
    // Auto-execution failed; the user can retry manually.
    expect(screen.queryByText(/Auto 模式：计划已就绪，正在自动执行/)).toBeNull();
    fireEvent.click(screen.getByText("Retry run"));
    expect(mockSession.executeDesign).toHaveBeenCalledTimes(1);
    expect(mockSession.executeDesign.mock.calls[0]![1]).toBe("cloning");
  });

  // ── Run log ────────────────────────────────────────────────

  it("renders run log rows in tool run task node", () => {
    mockSession.runLog = [
      { step: "1", tool: "primer3", status: "success", message: "Found 3 primers" },
    ];
    render(<AgentPanel {...defaultProps()} />);
    expect(screen.getByText("Tool run")).toBeDefined();
    // Tool labels and messages also appear in the step DAG
    expect(screen.getAllByText("primer3").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Found 3 primers").length).toBeGreaterThan(0);
  });

  it("renders an LLM re-plan badge in the tool worklog with the failure reason", () => {
    mockSession.runLog = [
      { step: "解析序列", tool: "resolve_rt_target", status: "failed", message: "序列中未找到目标基因，请检查基因名。" },
      { step: "LLM 重新规划", tool: "llm_planner", status: "completed", message: "失败后重规划完成，共 2 个新步骤。" },
      { step: "设计引物", tool: "design_rtqpcr", status: "completed", message: "引物设计完成。" },
    ];
    render(<AgentPanel {...defaultProps()} />);
    const replanBadge = screen.getByText("LLM 重新规划");
    expect(replanBadge).toBeDefined();
    expect(replanBadge.className).toContain("agent-replan__badge");
    // The message also flows into the step DAG node detail, so use getAllByText
    expect(screen.getAllByText("失败后重规划完成，共 2 个新步骤。").length).toBeGreaterThanOrEqual(1);
    // Failure reason from the preceding failed row is surfaced (Chinese step label)
    expect(screen.getByText(/失败步骤「解析序列」/)).toBeDefined();
    // The failed message also appears in the DAG detail and the failed row's
    // own detail, so assert it appears at least once anywhere in the panel.
    expect(screen.getAllByText(/序列中未找到目标基因/).length).toBeGreaterThanOrEqual(1);
  });

  it("renders a re-plan timeline entry even when backend timeline is empty", () => {
    mockSession.runLog = [
      { step: "解析序列", tool: "parse_sequence", status: "failed", message: "长度不足 30 bp。" },
      { step: "LLM 重新规划", tool: "llm_planner", status: "completed", message: "失败后重规划完成，共 1 个新步骤。" },
    ];
    mockSession.timeline = [];
    render(<AgentPanel {...defaultProps()} />);
    // The badge renders in the worklog row; the derived timeline entry carries
    // the combined summary text (badge + failed step), so assert on the summary.
    expect(screen.getByText("LLM 重新规划")).toBeDefined();
    expect(screen.getByText(/步骤「解析序列」失败后已自动调整剩余计划/)).toBeDefined();
  });

  it("does not render a re-plan badge without an llm_planner row", () => {
    mockSession.runLog = [
      { step: "1", tool: "parse_sequence", status: "completed", message: "解析完成。" },
    ];
    render(<AgentPanel {...defaultProps()} />);
    expect(screen.queryByText("LLM 重新规划")).toBeNull();
  });

  it("expands a step detail panel with inputs, result, and duration", () => {
    mockSession.runLog = [
      {
        step: "解析序列",
        tool: "parse_sequence",
        status: "completed",
        message: "已解析序列。",
        args: { sequence: "ATGC…（600 字符）", name: "GFP" },
        result: { message: "已解析序列", resultCount: 1, topResult: { length: 600 } },
        durationMs: 1234,
      },
    ];
    render(<AgentPanel {...defaultProps()} />);
    const summary = screen.getByText("步骤详情");
    expect(summary).toBeDefined();
    // Duration is rendered inside the summary line
    expect(screen.getByText("1.2 s")).toBeDefined();
    fireEvent.click(summary);
    expect(screen.getByText("输入参数")).toBeDefined();
    expect(screen.getByText("结果摘要")).toBeDefined();
    expect(screen.getByText(/"GFP"/)).toBeDefined();
    expect(screen.getByText(/"resultCount": 1/)).toBeDefined();
  });

  it("renders step duration in milliseconds when under one second", () => {
    mockSession.runLog = [
      { step: "1", tool: "t", status: "completed", message: "ok", durationMs: 400 },
    ];
    render(<AgentPanel {...defaultProps()} />);
    expect(screen.getByText("400 ms")).toBeDefined();
  });

  it("does not render a detail toggle when a runLog row has no detail fields", () => {
    mockSession.runLog = [
      { step: "1", tool: "t", status: "completed", message: "ok" },
    ];
    render(<AgentPanel {...defaultProps()} />);
    expect(screen.queryByText("步骤详情")).toBeNull();
  });

  it("auto-locates the active step's region in the editor during execution", () => {
    const onLocateRegion = vi.fn();
    // A completed tool row with binding coordinates resolves to a locatable
    // region; a running row on the same tool maps to the same target.
    mockSession.phase = "executing";
    mockSession.workspace = "mutagenesis";
    mockSession.resultCount = 1;
    mockSession.candidates = [makeCandidate({
      workspace: "mutagenesis",
      forwardPrimer: "ATGCGATCG",
      reversePrimer: "GCTAGCTAG",
      bindingStartForward: 4,
      bindingEndForward: 12,
      metrics: ["Bind 5–12"],
    })];
    mockSession.runLog = [
      { step: "设计突变", tool: "design_mutagenesis", status: "running", message: "设计引物。" },
    ];
    render(<AgentPanel {...defaultProps()} onLocateRegion={onLocateRegion} />);
    expect(onLocateRegion).toHaveBeenCalled();
    const region = onLocateRegion.mock.calls[0]![0] as { start: number; end: number };
    expect(region.start).toBe(4);
    expect(region.end).toBe(12);
  });

  // ── Recommendation / results ───────────────────────────────

  it("renders recommendation in results task node", () => {
    mockSession.recommendation = {
      title: "Gibson Assembly",
      summary: "Recommended for this construct",
      risks: ["High GC content in region"],
      confidence: 85,
    };
    render(<AgentPanel {...defaultProps()} />);
    // "Results" also appears as a step in the DAG, so scope to the task node
    const resultsNode = document.querySelector(".agent-results-node");
    expect(resultsNode).not.toBeNull();
    expect(within(resultsNode as HTMLElement).getByText("Gibson Assembly")).toBeDefined();
    expect(within(resultsNode as HTMLElement).getByText("Recommended for this construct")).toBeDefined();
    expect(within(resultsNode as HTMLElement).getByText("High GC content in region")).toBeDefined();
    expect(within(resultsNode as HTMLElement).getByText("Confidence: 85%")).toBeDefined();
  });

  it("renders result count when present", () => {
    mockSession.resultCount = 5;
    render(<AgentPanel {...defaultProps()} />);
    expect(screen.getByText("5 tool-generated candidate(s)")).toBeDefined();
  });

  it("renders primer table and candidate metrics when present", () => {
    mockSession.resultCount = 3;
    mockSession.candidates = [makeCandidate()];

    render(<AgentPanel {...defaultProps()} />);

    expect(screen.getByText("首选候选")).toBeDefined();
    expect(screen.getByText("插入片段 1,500 bp")).toBeDefined();
    expect(screen.getByText("ATGCGATCGATCG")).toBeDefined();
    expect(screen.getByText("GCTAGCTAGCTAG")).toBeDefined();
    expect(screen.getByText("62.5\u00B0C")).toBeDefined();
    expect(screen.getByText("52.9%")).toBeDefined();
    expect(screen.getByText("Tm 差异 1.2\u00B0C")).toBeDefined();
    expect(screen.getByText("交叉二聚体 无")).toBeDefined();
    expect(screen.getByText("退火 58\u00B0C")).toBeDefined();
    expect(screen.getByText("复制引物订购表")).toBeDefined();
    expect(screen.getByText("设计讲解与复核")).toBeDefined();
    expect(screen.getByText("初步通过，待验证")).toBeDefined();
    expect(screen.getByText("Tm 匹配")).toBeDefined();
    expect(screen.getByText("GC 范围")).toBeDefined();
    expect(screen.getByText("交叉二聚体")).toBeDefined();
    expect(screen.getByText("特异性")).toBeDefined();
    expect(screen.getByText("学习提示")).toBeDefined();
  });

  it("flags primer metrics that need review", () => {
    mockSession.candidates = [makeCandidate({
      tmForward: 66,
      tmReverse: 59,
      tmDelta: 7,
      gcForward: 72,
      crossDimer: true,
    })];

    render(<AgentPanel {...defaultProps()} />);

    expect(screen.getByText("建议复核")).toBeDefined();
    expect(screen.getByText("差值偏大，建议重新平衡结合区。", { exact: false })).toBeDefined();
    expect(screen.getByText("至少一条超出常用区间", { exact: false })).toBeDefined();
    expect(screen.getByText("检测到潜在互补", { exact: false })).toBeDefined();
  });

  it("does not render primer explanation for non-primer results", () => {
    mockSession.candidates = [makeCandidate({
      forwardPrimer: null,
      reversePrimer: null,
      workspace: "sgrna",
      sequenceRows: [{ label: "Guide", value: "GACTGACTGACTGACTGACT" }],
    })];

    render(<AgentPanel {...defaultProps()} />);

    expect(screen.queryByText("设计讲解与复核")).toBeNull();
  });

  it("copies primer order table TSV when requested", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    mockSession.candidates = [makeCandidate()];

    render(<AgentPanel {...defaultProps()} />);
    fireEvent.click(screen.getByText("复制引物订购表"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0]![0] as string;
    expect(copied).toContain("Name\tSequence\tTm\tGC\tLength\tNotes");
    expect(copied).toContain("Forward primer\tATGCGATCGATCG\t62.5\u00B0C\t52.9%\t31 nt");
    expect(copied).toContain("Reverse primer\tGCTAGCTAGCTAG\t61.3\u00B0C\t47.1%\t32 nt");
    expect(copied).toContain("1500 bp insert; anneal 58\u00B0C; extension 90s");
    expect(await screen.findByText("已复制")).toBeDefined();
  });

  it("shows copy failure feedback when clipboard rejects", async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    mockSession.candidates = [makeCandidate()];

    render(<AgentPanel {...defaultProps()} />);
    fireEvent.click(screen.getByText("复制引物订购表"));

    expect(await screen.findByText("复制失败")).toBeDefined();
  });

  it("shows copy failure feedback when clipboard is unavailable", async () => {
    setClipboard();
    mockSession.candidates = [makeCandidate()];

    render(<AgentPanel {...defaultProps()} />);
    fireEvent.click(screen.getByText("复制引物订购表"));

    expect(await screen.findByText("复制失败")).toBeDefined();
  });

  it("hides primer order copy action when candidates have no primer sequences", () => {
    mockSession.candidates = [
      makeCandidate({
        forwardPrimer: null,
        reversePrimer: null,
      }),
    ];

    render(<AgentPanel {...defaultProps()} />);

    expect(screen.queryByText("Copy primer order table")).toBeNull();
  });

  // ── Non-cloning result cards ─────────────────────────────────

  it("renders sgRNA guide sequence rows and metrics", () => {
    mockSession.candidates = [
      {
        title: "sgRNA candidate",
        summary: null,
        forwardPrimer: null,
        reversePrimer: null,
        tmForward: null,
        tmReverse: null,
        gcForward: null,
        gcReverse: null,
        fullLengthForward: null,
        fullLengthReverse: null,
        insertLength: null,
        tmDelta: null,
        crossDimer: null,
        annealTemp: null,
        extensionSec: null,
        workspace: "sgrna",
        sequenceRows: [
          { label: "Guide", value: "ATGCGATCGATCGATCG" },
          { label: "PAM", value: "NGG" },
        ],
        metrics: ["Score 85", "GC 58.8%", "Cut 150"],
      },
    ];
    mockSession.resultCount = 1;

    render(<AgentPanel {...defaultProps()} />);

    expect(screen.getByText("sgRNA candidate")).toBeDefined();
    expect(screen.getByText("Guide")).toBeDefined();
    expect(screen.getByText("ATGCGATCGATCGATCG")).toBeDefined();
    expect(screen.getByText("PAM")).toBeDefined();
    expect(screen.getByText("NGG")).toBeDefined();
    expect(screen.getByText("Score 85")).toBeDefined();
    expect(screen.getByText("GC 58.8%")).toBeDefined();
    expect(screen.getByText("Cut 150")).toBeDefined();
    expect(screen.queryByText("Copy primer order table")).toBeNull();
  });

  it("renders siRNA duplex sequence rows and metrics", () => {
    mockSession.candidates = [
      {
        title: "siRNA candidate",
        summary: null,
        forwardPrimer: null,
        reversePrimer: null,
        tmForward: null,
        tmReverse: null,
        gcForward: null,
        gcReverse: null,
        fullLengthForward: null,
        fullLengthReverse: null,
        insertLength: null,
        tmDelta: null,
        crossDimer: null,
        annealTemp: null,
        extensionSec: null,
        workspace: "sirna",
        sequenceRows: [
          { label: "Sense duplex", value: "AUGCGAUCGAUCGdTdT" },
          { label: "Antisense duplex", value: "CGAUCGAUCGCAUdTdT" },
        ],
        metrics: ["Score 92", "GC 46.2%", "Seed low"],
      },
    ];
    mockSession.resultCount = 1;

    render(<AgentPanel {...defaultProps()} />);

    expect(screen.getByText("siRNA candidate")).toBeDefined();
    expect(screen.getByText("Sense duplex")).toBeDefined();
    expect(screen.getByText("AUGCGAUCGAUCGdTdT")).toBeDefined();
    expect(screen.getByText("Antisense duplex")).toBeDefined();
    expect(screen.getByText("CGAUCGAUCGCAUdTdT")).toBeDefined();
    expect(screen.getByText("Score 92")).toBeDefined();
    expect(screen.queryByText("Copy primer order table")).toBeNull();
  });

  it("renders RT-qPCR primer table and non-duplicate probe row", () => {
    mockSession.candidates = [
      {
        title: "RT-qPCR candidate",
        summary: "Primer pair for target gene",
        forwardPrimer: "ATGCGATCG",
        reversePrimer: "GCTAGCTAG",
        tmForward: 62.5,
        tmReverse: 61.3,
        gcForward: 55,
        gcReverse: 50,
        fullLengthForward: 20,
        fullLengthReverse: 20,
        insertLength: null,
        tmDelta: 1.2,
        crossDimer: null,
        annealTemp: 58,
        extensionSec: null,
        workspace: "rtqpcr",
        sequenceRows: [
          { label: "Forward", value: "ATGCGATCG" },
          { label: "Reverse", value: "GCTAGCTAG" },
          { label: "Probe", value: "TTCGATCGAA" },
        ],
        metrics: ["Amplicon 150 bp", "Tm delta 1.2\u00B0C", "Anneal 58\u00B0C"],
      },
    ];
    mockSession.resultCount = 1;

    render(<AgentPanel {...defaultProps()} />);

    expect(screen.getByText("RT-qPCR candidate")).toBeDefined();
    expect(screen.getByText("Primer pair for target gene")).toBeDefined();
    expect(screen.getByText("正向")).toBeDefined();
    expect(screen.getByText("ATGCGATCG")).toBeDefined();
    expect(screen.getByText("反向")).toBeDefined();
    expect(screen.getByText("GCTAGCTAG")).toBeDefined();
    expect(screen.getByText("Probe")).toBeDefined();
    expect(screen.getByText("TTCGATCGAA")).toBeDefined();
    expect(screen.getAllByText("正向")).toHaveLength(1);
    expect(screen.getAllByText("反向")).toHaveLength(1);
    expect(screen.getByText("Amplicon 150 bp")).toBeDefined();
    // RT-qPCR with primer pair should show copy button
    expect(screen.getByText("复制引物订购表")).toBeDefined();
  });

  it("renders point mutation primer rows and metrics", () => {
    mockSession.candidates = [
      {
        title: "Mutation: A123T",
        summary: null,
        forwardPrimer: "ATGCGATCG",
        reversePrimer: "GCTAGCTAG",
        tmForward: 62.5,
        tmReverse: 61.3,
        gcForward: 55,
        gcReverse: 50,
        fullLengthForward: 31,
        fullLengthReverse: 31,
        insertLength: null,
        tmDelta: 1.2,
        crossDimer: null,
        annealTemp: 58,
        extensionSec: null,
        workspace: "mutagenesis",
        sequenceRows: [
          { label: "Forward", value: "ATGCGATCG" },
          { label: "Reverse", value: "GCTAGCTAG" },
        ],
        metrics: ["A123T", "Length 31 nt", "Tm delta 1.2\u00B0C", "Anneal 58\u00B0C"],
      },
    ];
    mockSession.resultCount = 1;

    render(<AgentPanel {...defaultProps()} />);

    expect(screen.getByText("Mutation: A123T")).toBeDefined();
    expect(screen.getByText("A123T")).toBeDefined();
    expect(screen.getByText("Length 31 nt")).toBeDefined();
    // Point mutation with primer pair should show copy button
    expect(screen.getByText("复制引物订购表")).toBeDefined();
  });

  it("renders run ID when present", () => {
    mockSession.agentRun = { runId: "run-123", status: "completed" };
    mockSession.resultCount = 1;
    render(<AgentPanel {...defaultProps()} />);
    // Run ID appears in both header subtitle and run meta area
    const runMatches = screen.getAllByText(/run-123/);
    expect(runMatches.length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/completed/).length).toBeGreaterThanOrEqual(1);
  });

  it("renders run ID without fabricated result count", () => {
    mockSession.agentRun = { runId: "run-solo", status: "success" };
    render(<AgentPanel {...defaultProps()} />);
    const runMatches = screen.getAllByText(/run-solo/);
    expect(runMatches.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/success/)).toBeDefined();
  });

  // ── Non-cloning copy result table ────────────────────────────

  it("shows Copy result table for sgRNA candidate and hides Copy primer order table", () => {
    mockSession.candidates = [
      {
        title: "sgRNA candidate",
        summary: null,
        forwardPrimer: null,
        reversePrimer: null,
        tmForward: null,
        tmReverse: null,
        gcForward: null,
        gcReverse: null,
        fullLengthForward: null,
        fullLengthReverse: null,
        insertLength: null,
        tmDelta: null,
        crossDimer: null,
        annealTemp: null,
        extensionSec: null,
        workspace: "sgrna",
        sequenceRows: [
          { label: "Guide", value: "ATGCGATCGATCGATCG" },
          { label: "PAM", value: "NGG" },
        ],
        metrics: ["Score 85", "GC 58.8%", "Cut 150"],
      },
    ];
    mockSession.resultCount = 1;

    render(<AgentPanel {...defaultProps()} />);

    expect(screen.getByText("复制结果表")).toBeDefined();
    expect(screen.queryByText("Copy primer order table")).toBeNull();
  });

  it("copies siRNA result table with duplex rows and metrics", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    mockSession.candidates = [
      {
        title: "siRNA candidate",
        summary: null,
        forwardPrimer: null,
        reversePrimer: null,
        tmForward: null,
        tmReverse: null,
        gcForward: null,
        gcReverse: null,
        fullLengthForward: null,
        fullLengthReverse: null,
        insertLength: null,
        tmDelta: null,
        crossDimer: null,
        annealTemp: null,
        extensionSec: null,
        workspace: "sirna",
        sequenceRows: [
          { label: "Sense duplex", value: "AUGCGAUCGAUCGdTdT" },
          { label: "Antisense duplex", value: "CGAUCGAUCGCAUdTdT" },
        ],
        metrics: ["Score 92", "GC 46.2%", "Seed low"],
      },
    ];
    mockSession.resultCount = 1;

    render(<AgentPanel {...defaultProps()} />);
    fireEvent.click(screen.getByText("复制结果表"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0]![0] as string;
    expect(copied).toContain("siRNA candidate");
    expect(copied).toContain("Sense duplex\tAUGCGAUCGAUCGdTdT");
    expect(copied).toContain("Antisense duplex\tCGAUCGAUCGCAUdTdT");
    expect(copied).toContain("Score 92\tGC 46.2%\tSeed low");
    expect(await screen.findByText("已复制")).toBeDefined();
  });

  it("does not show Copy result table for primer-pair candidate", () => {
    mockSession.candidates = [makeCandidate()];

    render(<AgentPanel {...defaultProps()} />);

    expect(screen.getByText("复制引物订购表")).toBeDefined();
    expect(screen.queryByText("Copy result table")).toBeNull();
  });

  // ── Copy run note ────────────────────────────────────────────

  it("copies run note with recommendation, top candidate, metrics, and run metadata", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    mockSession.recommendation = {
      title: "Gibson Assembly",
      summary: "Recommended for this construct",
      risks: ["High GC content in region"],
      confidence: 85,
    };
    mockSession.candidates = [
      {
        title: "sgRNA candidate",
        summary: null,
        forwardPrimer: null,
        reversePrimer: null,
        tmForward: null,
        tmReverse: null,
        gcForward: null,
        gcReverse: null,
        fullLengthForward: null,
        fullLengthReverse: null,
        insertLength: null,
        tmDelta: null,
        crossDimer: null,
        annealTemp: null,
        extensionSec: null,
        workspace: "sgrna",
        sequenceRows: [
          { label: "Guide", value: "ATGCGATCGATCGATCG" },
        ],
        metrics: ["Score 85", "GC 58.8%"],
      },
    ];
    mockSession.agentRun = { runId: "run-456", status: "completed" };

    render(<AgentPanel {...defaultProps()} />);
    fireEvent.click(screen.getByText("Copy run note"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0]![0] as string;
    expect(copied).toContain("Recommendation: Gibson Assembly");
    expect(copied).toContain("Recommended for this construct");
    expect(copied).toContain("Risks: High GC content in region");
    expect(copied).toContain("Confidence: 85%");
    expect(copied).toContain("Top candidate: sgRNA candidate");
    expect(copied).toContain("Metrics: Score 85; GC 58.8%");
    expect(copied).toContain("Run: run-456 — completed");
    expect(await screen.findByText("已复制")).toBeDefined();
  });

  it("shows Copy run note with only run metadata when no recommendation or candidates", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    mockSession.agentRun = { runId: "run-789", status: "success" };
    mockSession.resultCount = 1;

    render(<AgentPanel {...defaultProps()} />);
    fireEvent.click(screen.getByText("Copy run note"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0]![0] as string;
    expect(copied).toContain("Run: run-789 — success");
    expect(copied).not.toContain("Recommendation:");
    expect(copied).not.toContain("Top candidate:");
  });

  it("shows Copy run note when only recommendation is present", () => {
    mockSession.recommendation = {
      title: "Test Rec",
      summary: "A test recommendation",
      risks: [],
      confidence: null,
    };

    render(<AgentPanel {...defaultProps()} />);

    expect(screen.getByText("Copy run note")).toBeDefined();
  });

  it("does not show Copy run note when result area is empty", () => {
    render(<AgentPanel {...defaultProps()} />);

    expect(screen.queryByText("Copy run note")).toBeNull();
  });

  // ── Copy action failure feedback ─────────────────────────────

  it("shows copy failure feedback for Copy result table when clipboard rejects", async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    mockSession.candidates = [
      {
        title: "sgRNA candidate",
        summary: null,
        forwardPrimer: null,
        reversePrimer: null,
        tmForward: null,
        tmReverse: null,
        gcForward: null,
        gcReverse: null,
        fullLengthForward: null,
        fullLengthReverse: null,
        insertLength: null,
        tmDelta: null,
        crossDimer: null,
        annealTemp: null,
        extensionSec: null,
        workspace: "sgrna",
        sequenceRows: [{ label: "Guide", value: "ATGCGATCG" }],
        metrics: ["Score 85"],
      },
    ];
    mockSession.resultCount = 1;

    render(<AgentPanel {...defaultProps()} />);
    fireEvent.click(screen.getByText("复制结果表"));

    expect(await screen.findByText("复制失败")).toBeDefined();
  });

  it("shows copy failure feedback for Copy run note when clipboard is unavailable", async () => {
    setClipboard();
    mockSession.agentRun = { runId: "run-123", status: "completed" };
    mockSession.resultCount = 1;


    render(<AgentPanel {...defaultProps()} />);
    fireEvent.click(screen.getByText("Copy run note"));

    expect(await screen.findByText("复制失败")).toBeDefined();
  });

  // ── Error display ──────────────────────────────────────────

  it("renders error message when present", () => {
    mockSession.error = "Planning failed: timeout";
    render(<AgentPanel {...defaultProps()} />);
    expect(screen.getByText("Planning failed: timeout")).toBeDefined();
  });

  it("calls clearError when dismiss is clicked", () => {
    mockSession.error = "Some error";
    render(<AgentPanel {...defaultProps()} />);
    const dismissBtns = screen.getAllByTitle("忽略");
    fireEvent.click(dismissBtns[0]!);
    expect(mockSession.clearError).toHaveBeenCalledTimes(1);
  });

  // ── Input composer ─────────────────────────────────────────

  it("renders input composer when online", () => {
    render(<AgentPanel {...defaultProps()} />);
    expect(
      screen.getByPlaceholderText(
        "告诉我你想设计什么，我会先创建计划…",
      ),
    ).toBeDefined();
    expect(screen.getByText("发送")).toBeDefined();
  });

  it("keeps composer actions inside the input field so the shortcut hint stays below", () => {
    render(<AgentPanel {...defaultProps()} />);
    const field = document.querySelector(".agent-composer__field");
    const input = screen.getByLabelText("Agent message input");
    const send = screen.getByRole("button", { name: "发送消息" });
    const hint = screen.getByText("Enter 发送 · Shift+Enter 换行");

    expect(field).not.toBeNull();
    expect(field?.contains(input)).toBe(true);
    expect(field?.contains(send)).toBe(true);
    expect(field?.contains(hint)).toBe(false);
    expect(field?.nextElementSibling).toBe(hint);
  });

  it("keeps the input composer visible while offline", () => {
    mockSession.serviceStatus = "offline";
    mockSession.healthLabel = "Offline";
    render(<AgentPanel {...defaultProps()} />);
    const input = screen.getByLabelText("Agent message input") as HTMLTextAreaElement;
    const send = screen.getByRole("button", { name: "发送消息" }) as HTMLButtonElement;

    expect(input.placeholder).toBe(
      "Agent 服务离线。请先写消息，再重试连接…",
    );
    fireEvent.change(input, { target: { value: "Draft a cloning plan" } });
    expect(input.value).toBe("Draft a cloning plan");
    expect(send.disabled).toBe(true);
  });

  it("shows a visible thinking state and Stop action while planning", () => {
    mockSession.phase = "planning";
    mockSession.lastUserGoal = "Design primers";
    render(<AgentPanel {...defaultProps()} />);
    const input = screen.getByPlaceholderText(
      "告诉我你想设计什么，我会先创建计划…",
    ) as HTMLTextAreaElement;
    const stopBtn = screen.getByText("停止") as HTMLButtonElement;
    expect(input.disabled).toBe(false);
    expect(stopBtn.disabled).toBe(false);
    expect(screen.getByText("思考中…")).toBeDefined();
    expect(screen.getByText("正在理解任务、读取序列并准备计划")).toBeDefined();
    expect(screen.getByText("检测中…")).toBeDefined();
    expect(screen.getByText("正在路由任务")).toBeDefined();
    fireEvent.click(stopBtn);
    expect(mockSession.cancelRequest).toHaveBeenCalledTimes(1);
  });

  it("shows tool execution progress while executing", () => {
    mockSession.phase = "executing";
    mockSession.runLog = [
      { step: "Design primers", tool: "primer3", status: "running", message: "" },
    ];
    render(<AgentPanel {...defaultProps()} />);
    expect(screen.getByText("运行工具…")).toBeDefined();
    expect(screen.getByText("正在运行 primer3")).toBeDefined();
    expect(screen.getByText("停止")).toBeDefined();
  });

  it("treats remote validation as busy and makes it cancellable", () => {
    mockSession.validationStatus = "running";
    render(<AgentPanel {...defaultProps()} />);
    expect(screen.getByText("验证中…")).toBeDefined();
    expect(screen.getByText("正在检查外部数据库并复核候选结果")).toBeDefined();
    fireEvent.click(screen.getByText("停止"));
    expect(mockSession.cancelRequest).toHaveBeenCalledTimes(1);
  });

  it("sends message on Enter key", () => {
    render(<AgentPanel {...defaultProps()} />);
    const input = screen.getByPlaceholderText(
      "告诉我你想设计什么，我会先创建计划…",
    );
    fireEvent.change(input, { target: { value: "Design primers" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mockSession.sendMessage).toHaveBeenCalledWith("Design primers", makeDoc(), undefined, null);
  });

  it("does not send on Shift+Enter", () => {
    render(<AgentPanel {...defaultProps()} />);
    const input = screen.getByPlaceholderText(
      "告诉我你想设计什么，我会先创建计划…",
    );
    fireEvent.change(input, { target: { value: "Design primers" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(mockSession.sendMessage).not.toHaveBeenCalled();
  });

  it("sends message on Send button click", () => {
    render(<AgentPanel {...defaultProps()} />);
    const input = screen.getByPlaceholderText(
      "告诉我你想设计什么，我会先创建计划…",
    );
    fireEvent.change(input, { target: { value: "Clone my gene" } });
    fireEvent.click(screen.getByText("发送"));
    expect(mockSession.sendMessage).toHaveBeenCalledWith("Clone my gene", makeDoc(), undefined, null);
  });

  it("does not send empty message", () => {
    render(<AgentPanel {...defaultProps()} />);
    fireEvent.click(screen.getByText("发送"));
    expect(mockSession.sendMessage).not.toHaveBeenCalled();
  });

  it("disables Send when input is empty", () => {
    render(<AgentPanel {...defaultProps()} />);
    const sendBtn = screen.getByText("发送") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it("renders textarea with three-row default size", () => {
    render(<AgentPanel {...defaultProps()} />);
    const input = screen.getByPlaceholderText(
      "告诉我你想设计什么，我会先创建计划…",
    ) as HTMLTextAreaElement;
    expect(input.rows).toBe(3);
  });

  it("resets textarea to default three-row height after sending", () => {
    render(<AgentPanel {...defaultProps()} />);
    const input = screen.getByPlaceholderText(
      "告诉我你想设计什么，我会先创建计划…",
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Design primers" } });
    fireEvent.click(screen.getByText("发送"));
    expect(input.value).toBe("");
    expect(input.style.height).toBe("96px");
  });

  it("resets textarea to default height after Enter send", () => {
    render(<AgentPanel {...defaultProps()} />);
    const input = screen.getByPlaceholderText(
      "告诉我你想设计什么，我会先创建计划…",
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Design primers" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("");
    expect(input.style.height).toBe("96px");
  });

  // ── Clear session ──────────────────────────────────────────

  it("calls clearSession when New task is clicked", () => {
    render(<AgentPanel {...defaultProps()} />);
    fireEvent.click(screen.getByTitle("新任务"));
    expect(mockSession.clearSession).toHaveBeenCalledTimes(1);
  });

  it("clears and focuses the composer with visible feedback for a new task", () => {
    render(<AgentPanel {...defaultProps()} />);
    const input = screen.getByPlaceholderText(
      "告诉我你想设计什么，我会先创建计划…",
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "stale draft" } });

    fireEvent.click(screen.getByTitle("新任务"));

    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(screen.getByText("已创建新任务")).toBeDefined();
  });

  it("disables New task when busy", () => {
    mockSession.phase = "planning";
    render(<AgentPanel {...defaultProps()} />);
    const btn = screen.getByTitle("新任务") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  // ── Context invalidation ───────────────────────────────────

  it("resets warning acknowledgement when patchId changes", () => {
    const { rerender } = render(
      <AgentPanel {...defaultProps()} pendingPreview={makePreview({ patchId: "A", warnings: ["warn A"] })} />,
    );

    fireEvent.click(screen.getByText(/我已了解/));
    const applyBtnA = screen.getByText("应用到载体") as HTMLButtonElement;
    expect(applyBtnA.disabled).toBe(false);

    rerender(
      <AgentPanel {...defaultProps()} pendingPreview={makePreview({ patchId: "B", warnings: ["warn B"] })} />,
    );

    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    const applyBtnB = screen.getByText("应用到载体") as HTMLButtonElement;
    expect(applyBtnB.disabled).toBe(true);
  });

  it("keeps acknowledgement when same patchId rerenders", () => {
    const { rerender } = render(
      <AgentPanel {...defaultProps()} pendingPreview={makePreview({ patchId: "A", warnings: ["warn"] })} />,
    );

    fireEvent.click(screen.getByText(/我已了解/));
    const applyBtn = screen.getByText("应用到载体") as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(false);

    rerender(
      <AgentPanel {...defaultProps()} pendingPreview={makePreview({ patchId: "A", warnings: ["warn"] })} />,
    );

    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(applyBtn.disabled).toBe(false);
  });

  // ── Response patch handoff ─────────────────────────────────

  it("shows patch preview when pendingPreview has errors", () => {
    const errorPreview = makePreview({
      errors: ["Invalid patch schema"],
      proposedDocument: null,
    });
    render(<AgentPanel {...defaultProps()} pendingPreview={errorPreview} />);
    expect(screen.getByText("Invalid patch schema")).toBeDefined();
    // Apply should be disabled when there are errors
    const applyBtn = screen.getByText("应用到载体") as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
  });

  // ── onLoadPreview accepts unknown ──────────────────────────

  it("onLoadPreview accepts any value (unknown runtime boundary)", () => {
    render(<AgentPanel {...defaultProps()} />);
    const registration = mockSession.setOnSequencePatchReceived.mock.calls.find(
      ([callback]) => typeof callback === "function",
    );
    const callback = registration?.[0] as ((patch: unknown) => void) | undefined;
    expect(callback).toBeDefined();
    callback?.({ patchId: "runtime-value" });
    expect(onLoadPreview).toHaveBeenCalledTimes(1);
    const calledWith = onLoadPreview.mock.calls[0]![0];
    expect(typeof calledWith).toBe("object");
    expect(calledWith).not.toBeNull();
  });

  // ── Task stream node statuses ──────────────────────────────

  it("shows active planning node when phase is planning", () => {
    mockSession.phase = "planning";
    mockSession.lastUserGoal = "Design primers";
    mockSession.messages = [
      { role: "user", content: "Design primers" },
    ];
    render(<AgentPanel {...defaultProps()} />);
    const planningNode = screen.getByText("规划").closest(".task-node");
    expect(planningNode).not.toBeNull();
    expect(planningNode!.className).toContain("task-node--active");
  });

  it("shows active tool run node when phase is executing", () => {
    mockSession.phase = "executing";
    mockSession.lastUserGoal = "Design primers";
    mockSession.runLog = [
      { step: "1", tool: "primer3", status: "running", message: "Computing..." },
    ];
    render(<AgentPanel {...defaultProps()} />);
    const toolNode = screen.getByText("Tool run").closest(".task-node");
    expect(toolNode).not.toBeNull();
    expect(toolNode!.className).toContain("task-node--active");
  });

  it("shows active tool run node when phase is executing with empty run log", () => {
    mockSession.phase = "executing";
    mockSession.lastUserGoal = "Design primers";
    render(<AgentPanel {...defaultProps()} />);
    const toolNode = screen.getByText("Tool run").closest(".task-node");
    expect(toolNode).not.toBeNull();
    expect(toolNode!.className).toContain("task-node--active");
    expect(screen.getByText("Running tools...")).toBeDefined();
  });

  it("shows done planning node when all plan rows are done", () => {
    mockSession.plan = [
      { label: "Step 1", tool: "tool", status: "done", summary: "" },
      { label: "Step 2", tool: "tool", status: "done", summary: "" },
    ];
    render(<AgentPanel {...defaultProps()} />);
    const planningNode = screen.getByText("规划").closest(".task-node");
    expect(planningNode).not.toBeNull();
    expect(planningNode!.className).toContain("task-node--done");
  });

  it("shows plan row tool and summary in task node detail", () => {
    mockSession.plan = [
      { label: "Analyze sequence", tool: "analyze", status: "done", summary: "Checked 3 features" },
    ];
    render(<AgentPanel {...defaultProps()} />);
    expect(screen.getByText("analyze · Checked 3 features")).toBeDefined();
  });

  it("treats unknown plan status as waiting", () => {
    mockSession.plan = [
      { label: "Step 1", tool: "tool", status: "unknown_status", summary: "" },
    ];
    render(<AgentPanel {...defaultProps()} />);
    const planningNode = screen.getByText("规划").closest(".task-node");
    expect(planningNode).not.toBeNull();
    expect(planningNode!.className).toContain("task-node--waiting");
  });

  it("treats unknown run log status as waiting", () => {
    mockSession.runLog = [
      { step: "1", tool: "tool", status: "unknown_status", message: "" },
    ];
    render(<AgentPanel {...defaultProps()} />);
    const toolNode = screen.getByText("Tool run").closest(".task-node");
    expect(toolNode).not.toBeNull();
    expect(toolNode!.className).toContain("task-node--waiting");
  });

  // ── Wide/narrow mode ───────────────────────────────────────

  it("toggles wide mode", () => {
    render(<AgentPanel {...defaultProps()} />);
    const panel = screen.getByText("GeneCode Agent").closest(".agent-panel")!;
    expect(panel.className).not.toContain("agent-panel--wide");

    fireEvent.click(screen.getByLabelText("Wide view"));
    expect(panel.className).toContain("agent-panel--wide");

    fireEvent.click(screen.getByLabelText("Default view"));
    expect(panel.className).not.toContain("agent-panel--wide");
  });

  it("persists a manually resized panel and keeps wide mode authoritative", () => {
    const view = render(<AgentPanel {...defaultProps()} />);
    const panel = screen.getByText("GeneCode Agent").closest(".agent-panel") as HTMLElement;
    const handle = screen.getByTitle("Drag to resize");

    fireEvent.mouseDown(handle, { clientX: 1000 });
    fireEvent.mouseMove(document, { clientX: 900 });
    expect(panel.style.width).toBe("520px");
    fireEvent.mouseUp(document);
    expect(window.localStorage.getItem("genecode-agent-panel-width")).toBe("520");

    fireEvent.click(screen.getByLabelText("Wide view"));
    expect(panel.className).toContain("agent-panel--wide");
    expect(panel.style.width).toBe("");

    view.unmount();
    render(<AgentPanel {...defaultProps()} />);
    const restoredPanel = screen.getByText("GeneCode Agent").closest(".agent-panel") as HTMLElement;
    expect(restoredPanel.style.width).toBe("520px");
  });

  it("wide mode does not break collapse/expand", () => {
    render(<AgentPanel {...defaultProps()} />);
    const panel = screen.getByText("GeneCode Agent").closest(".agent-panel")!;

    // Enable wide mode
    fireEvent.click(screen.getByLabelText("Wide view"));
    expect(panel.className).toContain("agent-panel--wide");

    // Collapse
    fireEvent.click(screen.getByTitle("Collapse"));
    expect(panel.className).toContain("agent-panel--collapsed");
    expect(panel.className).toContain("agent-panel--wide");
    // Collapsed width should apply even when wide class is present
    expect(getComputedStyle(panel).width).toBe(getComputedStyle(document.documentElement).getPropertyValue("--agent-collapsed-width").trim());

    // Expand
    fireEvent.click(screen.getByTitle("Expand"));
    expect(panel.className).not.toContain("agent-panel--collapsed");
    expect(panel.className).toContain("agent-panel--wide");
  });

  it("supports workspace-controlled open and close state", () => {
    const onOpenChange = vi.fn();
    const { container } = render(
      <AgentPanel {...defaultProps()} open={false} onOpenChange={onOpenChange} />,
    );
    const panel = container.querySelector(".agent-panel")!;
    expect(panel.className).toContain("agent-panel--collapsed");

    fireEvent.click(screen.getByRole("button", { name: "Expand GeneCode Agent panel" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("can hide the collapsed rail when the workspace has a launcher", () => {
    const { container } = render(
      <AgentPanel {...defaultProps()} open={false} hideCollapsedRail />,
    );
    const panel = container.querySelector(".agent-panel")!;
    expect(panel.className).toContain("agent-panel--collapsed");
    expect(panel.className).toContain("agent-panel--rail-hidden");
  });

  it("shows an explicit close action when the collapsed rail is hidden", () => {
    const onOpenChange = vi.fn();
    render(
      <AgentPanel {...defaultProps()} open hideCollapsedRail onOpenChange={onOpenChange} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close GeneCode Agent" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // ── Objective node ─────────────────────────────────────────

  it("shows objective node when lastUserGoal is set", () => {
    mockSession.lastUserGoal = "Design Gibson primers for my gene";
    render(<AgentPanel {...defaultProps()} />);
    expect(screen.getByText("目标")).toBeDefined();
    expect(screen.getByText("Design Gibson primers for my gene")).toBeDefined();
  });

  it("shows the live Step flow surface while planning", () => {
    mockSession.lastUserGoal = "Design Gibson primers for my gene";
    mockSession.phase = "planning";
    render(<AgentPanel {...defaultProps()} />);

    expect(screen.getByText("Step flow")).toBeDefined();
    expect(screen.getByText("等待 Agent 事件")).toBeDefined();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("region", { name: "Agent 任务进度" })).toBeNull();
  });

  it("streams tool events into Step flow and updates the node when the step completes", () => {
    mockSession.lastUserGoal = "Design Gibson primers for my gene";
    mockSession.phase = "executing";
    mockSession.runLog = [
      { step: "设计引物", tool: "primer3", status: "running", message: "正在计算候选引物" },
    ];
    const { container, rerender } = render(<AgentPanel {...defaultProps()} />);

    expect(screen.getByText("Step flow")).toBeDefined();
    const dag = container.querySelector(".agent-step-dag");
    expect(dag).not.toBeNull();
    expect(dag?.textContent).toContain("primer3");
    expect(dag?.textContent).toContain("正在计算候选引物");
    expect(dag?.querySelector(".agent-step-dag__node--active")).not.toBeNull();

    mockSession.phase = "idle";
    mockSession.runLog = [
      { step: "设计引物", tool: "primer3", status: "completed", message: "已找到 3 对候选引物" },
    ];
    mockSession.resultCount = 3;
    rerender(<AgentPanel {...defaultProps()} />);
    expect(dag?.textContent).toContain("已找到 3 对候选引物");
    expect(dag?.querySelector(".agent-step-dag__node--done")).not.toBeNull();
  });

  it("keeps the empty task entry concise when a document is ready", () => {
    render(<AgentPanel {...defaultProps()} />);
    expect(screen.queryByText("Set objective")).toBeNull();
    expect(screen.getByText("新建分子设计")).toBeDefined();
  });

  it("shows Set objective guidance when sequence context is missing", () => {
    render(<AgentPanel {...defaultProps()} doc={makeDoc({ sequence: "" })} />);
    expect(screen.getByText("设定目标")).toBeDefined();
    expect(screen.getByText("添加序列或描述基因、登录号或设计目标")).toBeDefined();
  });

  // ── Document context ───────────────────────────────────────

  it("shows circular document type", () => {
    render(<AgentPanel {...defaultProps()} doc={makeDoc({ circular: true })} />);
    expect(screen.getByText(/Circular/)).toBeDefined();
  });

  it("hides starter chips when messages exist", () => {
    mockSession.messages = [
      { role: "user", content: "Hello" },
    ];
    render(<AgentPanel {...defaultProps()} />);
    expect(screen.queryByText("Clone insert into vector")).toBeNull();
  });

  // ── Step DAG view ──────────────────────────────────────────

  it("renders the step flow DAG when plan and run log exist", () => {
    mockSession.plan = [
      { label: "Analyze vector", tool: "context_probe", status: "done", summary: "" },
    ];
    mockSession.runLog = [
      { step: "1", tool: "primer3", status: "success", message: "Found 3 primers" },
    ];
    const { container } = render(<AgentPanel {...defaultProps()} />);
    expect(screen.getByText("Step flow")).toBeDefined();
    const dag = container.querySelector(".agent-step-dag");
    expect(dag).not.toBeNull();
    expect(within(dag as HTMLElement).getByText("Analyze vector")).toBeDefined();
    expect(within(dag as HTMLElement).getAllByText("primer3").length).toBeGreaterThan(0);
    expect(within(dag as HTMLElement).getByText("Found 3 primers")).toBeDefined();
  });

  it("shows validation and results steps in the DAG after a check", () => {
    mockSession.runLog = [
      { step: "1", tool: "primer3", status: "success", message: "ok" },
    ];
    mockSession.validationStatus = "completed";
    mockSession.recommendation = { title: "Design", summary: "", risks: [], confidence: null };
    const { container } = render(<AgentPanel {...defaultProps()} />);
    const dag = container.querySelector(".agent-step-dag");
    expect(dag).not.toBeNull();
    expect(within(dag as HTMLElement).getAllByText("Validation").length).toBeGreaterThan(0);
    expect(within(dag as HTMLElement).getAllByText("Results").length).toBeGreaterThan(0);
  });

  it("reports validation markers to the workspace when a check completes", () => {
    const onValidationMarkersChange = vi.fn();
    mockSession.workspace = "rtqpcr";
    mockSession.candidates = [
      makeCandidate({
        workspace: "rtqpcr",
        forwardPrimer: "ATCGATCGATCG",
        bindingStartForward: 0,
        bindingEndForward: 12,
      }),
    ];
    mockSession.validationResults = [
      {
        f: "ATCGATCGATCG",
        specificityCheck: { status: "Pass", summary: "specific" },
      },
    ];
    mockSession.validationStatus = "completed";
    render(<AgentPanel {...defaultProps()} onValidationMarkersChange={onValidationMarkersChange} />);
    expect(onValidationMarkersChange).toHaveBeenCalledTimes(1);
    const markers = onValidationMarkersChange.mock.calls[0]![0] as Array<{ label: string; start: number; end: number }>;
    expect(markers.length).toBeGreaterThan(0);
    expect(markers[0]!.label).toBe("Forward primer");
    expect(markers[0]!.start).toBe(0);
    expect(markers[0]!.end).toBe(12);
  });

  it("clears validation markers when the check resets", () => {
    const onValidationMarkersChange = vi.fn();
    mockSession.workspace = "rtqpcr";
    mockSession.candidates = [
      makeCandidate({ workspace: "rtqpcr", forwardPrimer: "ATCGATCGATCG" }),
    ];
    mockSession.validationResults = [];
    mockSession.validationStatus = "idle";
    render(<AgentPanel {...defaultProps()} onValidationMarkersChange={onValidationMarkersChange} />);
    expect(onValidationMarkersChange).toHaveBeenCalledWith([]);
  });

  // ── Locatable step nodes ───────────────────────────────────

  it("locates a candidate region and focuses its card when a tool node is clicked", () => {
    const onLocateRegion = vi.fn();
    mockSession.runLog = [
      { step: "1", tool: "primer3", status: "success", message: "found 1" },
    ];
    mockSession.workspace = "rtqpcr";
    mockSession.candidates = [
      makeCandidate({
        workspace: "rtqpcr",
        title: "Candidate A",
        bindingStartForward: 0,
        bindingEndForward: 12,
      }),
    ];
    mockSession.recommendation = { title: "Design", summary: "", risks: [], confidence: null };
    const { container } = render(
      <AgentPanel {...defaultProps()} onLocateRegion={onLocateRegion} />,
    );
    const toolButton = container.querySelector('[data-step-id="tool-0"]');
    expect(toolButton).not.toBeNull();
    fireEvent.click(toolButton as Element);
    expect(onLocateRegion).toHaveBeenCalledTimes(1);
    expect(onLocateRegion.mock.calls[0]![0]).toMatchObject({ start: 0, end: 12 });
    // The matching candidate card receives a focus request.
    const candidate = container.querySelector(".agent-candidate--focused");
    expect(candidate).not.toBeNull();
  });

  it("does not fire locate for a node without a locatable target", () => {
    const onLocateRegion = vi.fn();
    mockSession.runLog = [
      { step: "1", tool: "context_probe", status: "success", message: "ok" },
    ];
    mockSession.candidates = [];
    const { container } = render(
      <AgentPanel {...defaultProps()} onLocateRegion={onLocateRegion} />,
    );
    const toolElement = container.querySelector('[data-step-id="tool-0"]');
    expect(toolElement).not.toBeNull(); // unlocatable → rendered as plain div
    expect(toolElement!.tagName).toBe("DIV");
    expect(onLocateRegion).not.toHaveBeenCalled();
  });

  it("shows a hover tooltip with region summary and locate hint for clickable nodes", () => {
    mockSession.runLog = [
      { step: "1", tool: "primer3", status: "success", message: "found 1" },
    ];
    mockSession.workspace = "rtqpcr";
    mockSession.candidates = [
      makeCandidate({
        workspace: "rtqpcr",
        title: "Candidate A",
        bindingStartForward: 0,
        bindingEndForward: 12,
      }),
    ];
    mockSession.recommendation = { title: "Design", summary: "", risks: [], confidence: null };
    const { container } = render(<AgentPanel {...defaultProps()} />);
    const tooltip = container.querySelector('[data-step-id="tool-0"] .agent-step-dag__tooltip');
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).toContain("Forward primer 1–12");
    expect(tooltip!.textContent).toContain("点击定位到编辑器");
  });

  it("includes the validation status line in the validation node tooltip", () => {
    mockSession.runLog = [
      { step: "1", tool: "check_rt_specificity", status: "success", message: "ok" },
    ];
    mockSession.workspace = "rtqpcr";
    mockSession.candidates = [
      makeCandidate({
        workspace: "rtqpcr",
        bindingStartForward: 0,
        bindingEndForward: 12,
      }),
    ];
    mockSession.validationStatus = "completed";
    mockSession.validationResults = [
      { specificityCheck: { status: "Pass", summary: "specific" } },
    ];
    mockSession.recommendation = { title: "Design", summary: "", risks: [], confidence: null };
    const { container } = render(<AgentPanel {...defaultProps()} />);
    const tooltip = container.querySelector('[data-step-id="tool-0"] .agent-step-dag__tooltip');
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).toContain("Pass");
    expect(tooltip!.textContent).toContain("specific");
  });
});
