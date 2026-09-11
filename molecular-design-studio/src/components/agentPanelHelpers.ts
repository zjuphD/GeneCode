/**
 * AgentPanel helpers — constants, status derivation, formatters.
 *
 * Extracted from AgentPanel.tsx to reduce file size.
 */

import type { SequenceDocument } from "../types";
import type { PlanRow, RunLogRow, AgentRecommendation, AgentRunMeta, ResultCandidate } from "../agent/responseTypes";
import type { AgentMode, AgentWorkspace } from "../agent/service";
import type { RequestPhase } from "../agent/useAgentSession";

// ── Types ──────────────────────────────────────────────────

export type TaskNodeStatus = "done" | "active" | "waiting" | "error" | "skipped" | "review";

// ── Constants ──────────────────────────────────────────────

export const WORKSPACE_OPTIONS: Array<{ id: AgentWorkspace; label: string; shortLabel: string }> = [
  { id: "cloning", label: "分子克隆", shortLabel: "克隆" },
  { id: "rtqpcr", label: "RT-qPCR", shortLabel: "RT-qPCR" },
  { id: "sgrna", label: "sgRNA", shortLabel: "sgRNA" },
  { id: "sirna", label: "siRNA", shortLabel: "siRNA" },
  { id: "mutagenesis", label: "点突变", shortLabel: "突变" },
];

export const AGENT_MODE_OPTIONS: Array<{ id: AgentMode; label: string; icon: string; description: string }> = [
  {
    id: "review",
    label: "审阅",
    icon: "🔍",
    description: "检查当前设计，不运行高风险设计工具或创建序列修改。",
  },
  {
    id: "plan",
    label: "引导",
    icon: "📋",
    description: "先创建计划。设计工具仅在您确认后运行。",
  },
  {
    id: "auto",
    label: "自动",
    icon: "⚡",
    description: "自动运行整个流程：规划、无需确认执行，并将序列修改直接应用到文档副本作为新文件。",
  },
];

export const MODE_PLACEHOLDERS: Record<AgentMode, string> = {
  review: "让我审阅引物、sgRNA、突变或当前的克隆计划…",
  plan: "告诉我你想设计什么，我会先创建计划…",
  auto: "描述设计目标，或接着问一个问题…",
};

export interface TaskStarter {
  label: string;
  prompt: string;
  /** The workspace a starter is locked to — clicking it pins this workspace
   *  so the snapshot slots and routing never drift from the task intent. */
  workspace: AgentWorkspace;
}

export const TASK_STARTERS: Record<AgentWorkspace, TaskStarter[]> = {
  cloning: [
    {
      label: "将插入片段克隆到载体",
      workspace: "cloning",
      prompt:
        "I want to clone an insert into the current vector. Read the open vector and its selected insertion region first, then ask for any missing insert sequence or constraints.",
    },
    {
      label: "设计 Gibson 引物",
      workspace: "cloning",
      prompt:
        "Design Gibson or homologous-arm primers from the selected region of the current vector. Derive both junctions from the vector, show the plan before execution, and ask for any missing insert sequence.",
    },
    {
      label: "检查构建体风险",
      workspace: "cloning",
      prompt:
        "Check the current construct plan for cloning risks, missing information, primer concerns, and sequence-context issues.",
    },
  ],
  rtqpcr: [
    {
      label: "设计 RT-qPCR 引物",
      workspace: "rtqpcr",
      prompt:
        "Design RT-qPCR primers for a target gene. Ask for gene name or accession if not provided.",
    },
    {
      label: "检查引物特异性",
      workspace: "rtqpcr",
      prompt:
        "Review the current RT-qPCR primer design for specificity, amplicon length, and gDNA considerations.",
    },
  ],
  sgrna: [
    {
      label: "设计 KO sgRNA",
      workspace: "sgrna",
      prompt:
        "Design knockout sgRNAs for this target using SpCas9 NGG. Use the open sequence if appropriate or ask for gene, accession, species, and constraints.",
    },
    {
      label: "设计 KI sgRNA",
      workspace: "sgrna",
      prompt:
        "Design knock-in sgRNAs near the intended edit region. Ask me for the edit location or accession if the current context is not enough.",
    },
    {
      label: "检查向导 RNA 风险",
      workspace: "sgrna",
      prompt:
        "Review sgRNA candidates for PAM, cut position, GC, and obvious guide quality risks before execution.",
    },
  ],
  sirna: [
    {
      label: "设计 siRNA 双链体",
      workspace: "sirna",
      prompt:
        "Design siRNA duplex candidates for the current target. Use a 21 nt duplex with dTdT overhang unless another format is needed.",
    },
    {
      label: "优先共享转录本",
      workspace: "sirna",
      prompt:
        "Design siRNA candidates that prefer shared transcript regions where possible. Ask for species, accession, or isoform constraints if needed.",
    },
    {
      label: "检查种子区风险",
      workspace: "sirna",
      prompt:
        "Check siRNA seed risk, GC range, functional region, and shortlist quality for the current target.",
    },
  ],
  mutagenesis: [
    {
      label: "DNA 点突变引物",
      workspace: "mutagenesis",
      prompt:
        "Design DNA point mutation primers for the current template. Ask me for position, reference base, alternate base, and any primer constraints.",
    },
    {
      label: "氨基酸突变引物",
      workspace: "mutagenesis",
      prompt:
        "Design amino-acid mutation primers. Ask me for CDS start, amino-acid position, source residue, and target residue if missing.",
    },
    {
      label: "检查突变设置",
      workspace: "mutagenesis",
      prompt:
        "Check whether the current mutation setup has enough template, coordinate, reference, alternate, and CDS information to design primers.",
    },
  ],
};

export const UNIFIED_TASK_STARTERS: TaskStarter[] = [
  TASK_STARTERS.cloning[0]!,
  TASK_STARTERS.rtqpcr[0]!,
  TASK_STARTERS.sgrna[0]!,
  TASK_STARTERS.sirna[0]!,
  TASK_STARTERS.mutagenesis[0]!,
];

export function workspaceDisplayLabel(workspace: AgentWorkspace): string {
  return WORKSPACE_OPTIONS.find((option) => option.id === workspace)?.shortLabel ?? "分子设计";
}

export function inferWorkspaceFromGoal(
  goal: string,
  fallback: AgentWorkspace,
): AgentWorkspace {
  const normalized = goal.trim().toLowerCase();
  if (!normalized) return fallback;
  if (/\b(sgrna|guide rna|crispr|cas9|cas12|knockout|knock-out|knock-in|knock in)\b/.test(normalized)) {
    return "sgrna";
  }
  if (/\b(sirna|rnai|rna interference|gene silencing)\b/.test(normalized)) {
    return "sirna";
  }
  if (/\b(rt-?qpcr|q-pcr|quantitative pcr)\b/.test(normalized)) {
    return "rtqpcr";
  }
  if (/\b(mutagenesis|point mutation|site-directed|amino-acid mutation|amino acid mutation)\b/.test(normalized)) {
    return "mutagenesis";
  }
  if (/\b(clone|cloning|gibson|golden gate|assembly|homologous recombination|insert|vector)\b/.test(normalized)) {
    return "cloning";
  }
  return fallback;
}

export const WORKSPACE_PLACEHOLDERS: Record<AgentWorkspace, string> = {
  cloning: "提供插入片段序列、克隆目标或约束条件…",
  rtqpcr: "提供基因、登录号、序列、物种或 RT-qPCR 约束…",
  sgrna: "提供基因、登录号、序列或 sgRNA 设计目标…",
  sirna: "提供基因、登录号、序列或 siRNA 设计目标…",
  mutagenesis: "提供突变定义（如 M14A）或设计约束…",
};

// ── Status derivation ──────────────────────────────────────

export function mapPlanRowStatus(status: string): TaskNodeStatus {
  if (status === "completed" || status === "done") return "done";
  if (status === "active" || status === "running") return "active";
  if (status === "error" || status === "failed") return "error";
  if (status === "skipped") return "skipped";
  return "waiting";
}

export function mapRunLogStatus(status: string): TaskNodeStatus {
  if (status === "completed" || status === "done") return "done";
  if (status === "running" || status === "active") return "active";
  if (status === "failed" || status === "error") return "error";
  return "waiting";
}

export function deriveContextStatus(doc: SequenceDocument | null): TaskNodeStatus {
  return doc && doc.sequence.length > 0 ? "done" : "waiting";
}

export function deriveObjectiveStatus(phase: RequestPhase, lastUserGoal: string): TaskNodeStatus {
  if (phase === "planning" || phase === "executing") return "active";
  if (lastUserGoal) return "done";
  return "waiting";
}

export function derivePlanningStatus(phase: RequestPhase, plan: PlanRow[]): TaskNodeStatus {
  if (phase === "planning") return "active";
  if (plan.length === 0) return "waiting";
  const statuses = plan.map((r) => mapPlanRowStatus(r.status));
  if (statuses.every((s) => s === "done")) return "done";
  if (statuses.some((s) => s === "active")) return "active";
  return "waiting";
}

export function deriveToolStatus(phase: RequestPhase, runLog: RunLogRow[]): TaskNodeStatus {
  if (phase === "executing") return "active";
  if (runLog.length === 0) return "waiting";
  const statuses = runLog.map((r) => mapRunLogStatus(r.status));
  if (statuses.every((s) => s === "done")) return "done";
  if (statuses.some((s) => s === "active")) return "active";
  if (statuses.some((s) => s === "error")) return "error";
  return "waiting";
}

export function deriveResultStatus(
  phase: RequestPhase,
  recommendation: AgentRecommendation | null,
  candidates: ResultCandidate[],
  resultCount: number | null,
  agentRunId: string | null,
): TaskNodeStatus {
  if (phase === "executing") return "active";
  if (recommendation || candidates.length > 0 || resultCount !== null || agentRunId !== null) return "done";
  return "waiting";
}

export function validationStatusLine(result: Record<string, unknown>): string {
  const check = result.specificityCheck ?? result.genomeOfftargetCheck ?? result.transcriptomeOfftargetCheck;
  if (typeof check !== "object" || check === null || Array.isArray(check)) return "已收到验证结果";
  const data = check as Record<string, unknown>;
  const status = typeof data.status === "string" ? data.status : "已检查";
  const summary = typeof data.summary === "string" ? data.summary : "";
  const exact = typeof data.exact_hits === "number" ? `exact ${data.exact_hits}` : "";
  const one = typeof data.one_mismatch_hits === "number" ? `1 mismatch ${data.one_mismatch_hits}` : "";
  return [status, summary || [exact, one].filter(Boolean).join(" · ")].filter(Boolean).join(" · ");
}

export function buildRunNoteText({
  recommendation,
  candidates,
  agentRun,
}: {
  recommendation: AgentRecommendation | null;
  candidates: ResultCandidate[];
  agentRun: AgentRunMeta;
}): string {
  const lines: string[] = [];

  if (recommendation) {
    lines.push(`Recommendation: ${recommendation.title}`);
    if (recommendation.summary) lines.push(recommendation.summary);
    if (recommendation.risks?.length) {
      lines.push(`Risks: ${recommendation.risks.join("; ")}`);
    }
    if (recommendation.confidence !== null) {
      lines.push(`Confidence: ${recommendation.confidence}%`);
    }
  }

  if (candidates.length > 0) {
    const top = candidates[0]!; // non-null: guarded by length check
    lines.push(`Top candidate: ${top.title ?? "Unnamed"}`);
    const metrics = top.metrics ?? [];
    if (metrics.length > 0) lines.push(`Metrics: ${metrics.join("; ")}`);
  }

  if (agentRun.runId) {
    const statusPart = agentRun.status ? ` — ${agentRun.status}` : "";
    lines.push(`Run: ${agentRun.runId}${statusPart}`);
  }

  return lines.join("\n");
}

/**
 * Build a CSV string from artifact data (candidate_table or ordering_table).
 */
export function buildArtifactCsv(data: Record<string, unknown>): string {
  const rows = (data.candidates ?? data.items ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return "";
  // Collect all unique keys across all rows
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const header = keys.join(",");
  const lines = rows.map((row) =>
    keys.map((k) => {
      const val = row[k];
      if (val === null || val === undefined) return "";
      const str = String(val);
      // Escape CSV: quote if contains comma, quote, or newline
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(","),
  );
  return [header, ...lines].join("\n");
}

/**
 * Build a CSV export of Agent result candidates (one row per candidate).
 *
 * Used by Auto mode as the landing point for pure design tasks that produce
 * candidates but no sequencePatch: the results are automatically archived to
 * a downloadable file so the run has a concrete artifact even when there is
 * nothing to apply to the editor.
 */
export function buildCandidatesCsv(candidates: ResultCandidate[]): string {
  const header = [
    "title",
    "summary",
    "forwardPrimer",
    "reversePrimer",
    "tmForward",
    "tmReverse",
    "gcForward",
    "gcReverse",
    "fullLengthForward",
    "fullLengthReverse",
    "insertLength",
    "metrics",
    "sequenceRows",
  ];
  const escape = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return "";
    const str = String(value);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const rows = candidates.map((candidate) => {
    const metrics = (candidate.metrics ?? []).join(" | ");
    const sequenceRows = (candidate.sequenceRows ?? [])
      .map((row) => `${row.label}=${row.value}`)
      .join(" | ");
    return [
      escape(candidate.title),
      escape(candidate.summary),
      escape(candidate.forwardPrimer),
      escape(candidate.reversePrimer),
      escape(candidate.tmForward),
      escape(candidate.tmReverse),
      escape(candidate.gcForward),
      escape(candidate.gcReverse),
      escape(candidate.fullLengthForward),
      escape(candidate.fullLengthReverse),
      escape(candidate.insertLength),
      escape(metrics),
      escape(sequenceRows),
    ].join(",");
  });
  return [header.join(","), ...rows].join("\n");
}
