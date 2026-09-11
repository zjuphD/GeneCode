/**
 * PrimerExplanation — design review and educational explanation for primer results.
 *
 * Shows automated quality checks (Tm matching, GC range, primer length,
 * cross-dimer, specificity), design rationale, and learning tips.
 */

import type { ResultCandidate } from "../agent/responseTypes";

// ── Types ──────────────────────────────────────────────────

type PrimerReviewStatus = "pass" | "review" | "verify";

interface PrimerReviewItem {
  label: string;
  status: PrimerReviewStatus;
  detail: string;
}

interface PrimerExplanationModel {
  overallLabel: string;
  overallStatus: PrimerReviewStatus;
  rationale: string;
  checks: PrimerReviewItem[];
  learning: string[];
}

// ── Helpers ────────────────────────────────────────────────

function formatPair(left: number, right: number, suffix: string): string {
  return `${left}${suffix} / ${right}${suffix}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fragmentPrimersFor(candidate: ResultCandidate): Array<Record<string, unknown>> {
  return Array.isArray(candidate.raw?.fragment_primers)
    ? candidate.raw.fragment_primers.filter(isRecord)
    : [];
}

function buildPrimerExplanation(candidate: ResultCandidate): PrimerExplanationModel {
  const checks: PrimerReviewItem[] = [];
  const fragmentPrimers = fragmentPrimersFor(candidate);
  const isMultiFragment = fragmentPrimers.length > 0;

  if (isMultiFragment) {
    const tmDeltas = fragmentPrimers.flatMap((fragment) => {
      const tmForward = numberValue(fragment.tm_f);
      const tmReverse = numberValue(fragment.tm_r);
      return tmForward !== null && tmReverse !== null ? [Math.abs(tmForward - tmReverse)] : [];
    });
    const maxTmDelta = tmDeltas.length > 0 ? Math.max(...tmDeltas) : null;
    checks.push({
      label: "各片段 Tm 匹配",
      status: maxTmDelta === null ? "verify" : maxTmDelta <= 2 ? "pass" : "review",
      detail: maxTmDelta === null
        ? "部分片段没有返回完整 Tm，需要逐行核对。"
        : `${fragmentPrimers.length} 个片段中最大差值 ${maxTmDelta.toFixed(1)}°C。${maxTmDelta <= 2 ? "各片段的两条引物可优先尝试同一退火条件。" : "至少一个片段的 F/R Tm 差值偏大，建议单独复核。"}`,
    });

    const gcValues = fragmentPrimers.flatMap((fragment) => [numberValue(fragment.gc_f), numberValue(fragment.gc_r)]).filter((value): value is number => value !== null);
    const gcInRange = gcValues.length === fragmentPrimers.length * 2 && gcValues.every((value) => value >= 40 && value <= 60);
    checks.push({
      label: "各片段 GC 范围",
      status: gcValues.length === fragmentPrimers.length * 2 ? gcInRange ? "pass" : "review" : "verify",
      detail: gcValues.length === fragmentPrimers.length * 2
        ? `${gcInRange ? "所有" : "部分"}片段引物处于常用 40–60% 区间。`
        : "部分片段没有返回完整 GC%，需要逐行核对。",
    });

    const lengths = fragmentPrimers.flatMap((fragment) => [
      numberValue(fragment.full_length_f),
      numberValue(fragment.full_length_r),
    ]).filter((value): value is number => value !== null);
    const lengthsReasonable = lengths.length === fragmentPrimers.length * 2 && lengths.every((value) => value >= 18 && value <= 80);
    checks.push({
      label: "完整引物长度",
      status: lengths.length === fragmentPrimers.length * 2 ? lengthsReasonable ? "pass" : "review" : "verify",
      detail: lengths.length === fragmentPrimers.length * 2
        ? `${fragmentPrimers.length * 2} 条订购序列均已返回长度；${lengthsReasonable ? "长度处于常见合成范围。" : "至少一条长度需要人工复核。"}`
        : "部分片段没有返回完整长度，需要核对最终订购序列。",
    });

    const crossDimerValues = fragmentPrimers.map((fragment) => {
      const quality = isRecord(fragment.quality) ? fragment.quality : null;
      return quality && typeof quality.cross_dimer === "boolean" ? quality.cross_dimer : null;
    });
    const hasCrossDimer = crossDimerValues.some((value) => value === true);
    checks.push({
      label: "片段间 / 片段内二聚体",
      status: crossDimerValues.every((value) => value !== null) ? hasCrossDimer ? "review" : "pass" : "verify",
      detail: crossDimerValues.every((value) => value !== null)
        ? hasCrossDimer ? "至少一个片段报告潜在二聚体，建议优先查看该片段的备选引物。" : "当前规则未发现明显二聚体风险；仍建议检查混合 PCR 条件。"
        : "结果未包含每个片段的二聚体判断，建议补充专门复核。",
    });

    checks.push({
      label: "特异性",
      status: "verify",
      detail: "多片段方案需要分别确认每条 PCR 引物的模板特异性，不能只看汇总 Tm/GC。",
    });

    const hasReview = checks.some((item) => item.status === "review");
    const hasVerify = checks.some((item) => item.status === "verify");
    const method = typeof candidate.raw?.assembly_method === "string" ? candidate.raw.assembly_method : "多片段组装";
    return {
      overallLabel: hasReview ? "建议复核" : hasVerify ? "初步通过，待验证" : "初步通过",
      overallStatus: hasReview ? "review" : hasVerify ? "verify" : "pass",
      rationale: `${method} 已为每个片段分别生成一对 PCR 引物；5′ assembly tail 负责相邻边界拼接，3′ core 负责在对应片段上退火。`,
      checks,
      learning: [
        "每个片段都要单独核对 Forward/Reverse，不要只订购汇总卡片里的第一对和最后一对。",
        "Golden Gate 的 overhang 或 Gibson 的同源臂决定连接顺序；它们不等于 PCR 退火区。",
        "混合组装前仍需分别确认片段方向、内部 Type IIS 位点或重复同源区，以及每条引物的特异性。",
      ],
    };
  }

  const tmDelta = candidate.tmDelta ?? (
    candidate.tmForward !== null && candidate.tmReverse !== null
      ? Math.abs(candidate.tmForward - candidate.tmReverse)
      : null
  );

  if (candidate.tmForward !== null && candidate.tmReverse !== null && tmDelta !== null) {
    checks.push({
      label: "Tm 匹配",
      status: tmDelta <= 2 ? "pass" : "review",
      detail: `${formatPair(candidate.tmForward, candidate.tmReverse, "°C")}，差值 ${tmDelta.toFixed(1)}°C。${tmDelta <= 2 ? "适合同一退火条件。" : "差值偏大，建议重新平衡结合区。"}`,
    });
  } else {
    checks.push({ label: "Tm 匹配", status: "verify", detail: "结果未返回完整 Tm，需要补充计算。" });
  }

  if (candidate.gcForward !== null && candidate.gcReverse !== null) {
    const gcInRange = [candidate.gcForward, candidate.gcReverse].every((value) => value >= 40 && value <= 60);
    checks.push({
      label: "GC 范围",
      status: gcInRange ? "pass" : "review",
      detail: `${formatPair(candidate.gcForward, candidate.gcReverse, "%")}。${gcInRange ? "均处于常用的 40–60% 区间。" : "至少一条超出常用区间，需关注退火稳定性。"}`,
    });
  } else {
    checks.push({ label: "GC 范围", status: "verify", detail: "结果未返回完整 GC%，需要补充计算。" });
  }

  // Compute primer lengths: prefer explicit fullLength fields, fall back to sequence length
  const fwdLen = candidate.fullLengthForward ?? (candidate.forwardPrimer ? candidate.forwardPrimer.length : null);
  const revLen = candidate.fullLengthReverse ?? (candidate.reversePrimer ? candidate.reversePrimer.length : null);

  if (fwdLen !== null && revLen !== null) {
    const lengthsReasonable = [fwdLen, revLen].every((value) => value >= 18 && value <= 80);
    const source = candidate.fullLengthForward !== null ? "" : "（由序列推算）";
    checks.push({
      label: "引物长度",
      status: lengthsReasonable ? "pass" : "review",
      detail: `${formatPair(fwdLen, revLen, " nt")}${source}。${lengthsReasonable ? "长度可用于常规合成；克隆引物可能包含 5′ 附加序列。" : "长度超出常见合成范围，建议检查尾序列和结合区。"}`,
    });
  } else {
    checks.push({ label: "引物长度", status: "verify", detail: "结果未返回引物序列或长度，需要核对最终订购序列。" });
  }

  checks.push({
    label: "交叉二聚体",
    status: candidate.crossDimer === false ? "pass" : candidate.crossDimer === true ? "review" : "verify",
    detail: candidate.crossDimer === false
      ? "当前规则未发现明显交叉二聚体风险。"
      : candidate.crossDimer === true
        ? "检测到潜在互补，建议复核 3′ 端配对并考虑备选引物。"
        : "当前结果未包含二聚体判断，建议用专门工具复核。",
  });

  checks.push({
    label: "特异性",
    status: "verify",
    detail: "参数合格不等于全基因组特异；实验前仍应结合物种数据库做 BLAST 或脱靶复核。",
  });

  const hasReview = checks.some((item) => item.status === "review");
  const hasVerify = checks.some((item) => item.status === "verify");
  const workspace = (candidate.workspace ?? "").toLowerCase();
  const rationale = workspace === "rtqpcr"
    ? "这组结果优先平衡两条引物的 Tm 与 GC，并结合扩增子长度选择可在同一退火条件下工作的候选。"
    : workspace === "mutagenesis"
      ? "点突变引物需要让突变位点位于稳定的结合窗口内，同时兼顾两端退火能力与整条引物长度。"
      : "克隆引物的 5′ 端可承担同源臂或酶切位点功能，真正决定退火表现的是靠近 3′ 端的模板结合区。";

  return {
    overallLabel: hasReview ? "建议复核" : hasVerify ? "初步通过，待验证" : "初步通过",
    overallStatus: hasReview ? "review" : hasVerify ? "verify" : "pass",
    rationale,
    checks,
    learning: [
      "Tm 差越小，两条引物越容易在同一退火温度下协同扩增。",
      "GC% 反映结合稳定性，但最终判断还要结合 3′ 端结构、重复序列和模板背景。",
      workspace === "rtqpcr"
        ? "RT-qPCR 还要关注扩增子长度、跨外显子设计和基因组 DNA 干扰。"
        : workspace === "mutagenesis"
          ? "突变 PCR 后通常还需去除原始模板，并通过测序确认目标突变。"
          : "带 5′ 尾序列的克隆引物应分别核对完整订购序列和实际退火结合区。",
    ],
  };
}

// ── Constants ──────────────────────────────────────────────

const STATUS_LABELS: Record<PrimerReviewStatus, string> = {
  pass: "通过",
  review: "复核",
  verify: "待验证",
};

// ── Component ──────────────────────────────────────────────

export function PrimerExplanation({ candidate }: { candidate: ResultCandidate }) {
  const model = buildPrimerExplanation(candidate);

  return (
    <section className="agent-primer-explanation" aria-label="设计讲解与复核">
      <div className="agent-primer-explanation__header">
        <strong>设计讲解与复核</strong>
        <span className={`agent-primer-explanation__overall agent-primer-explanation__overall--${model.overallStatus}`}>
          {model.overallLabel}
        </span>
      </div>
      <details className="agent-disclosure">
      <summary>设计依据与检查详情</summary>
      <div className="agent-primer-explanation__rationale">
        <span>为什么这样设计</span>
        <p>{model.rationale}</p>
      </div>
      <div className="agent-primer-explanation__checks">
        <span className="agent-primer-explanation__section-title">自动复核</span>
        {model.checks.map((item) => (
          <div className="agent-primer-review" key={item.label}>
            <span className={`agent-primer-review__status agent-primer-review__status--${item.status}`}>
              {STATUS_LABELS[item.status]}
            </span>
            <div>
              <strong>{item.label}</strong>
              <p>{item.detail}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="agent-primer-explanation__learning">
        <span className="agent-primer-explanation__section-title">学习提示</span>
        <ul>
          {model.learning.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>
      </details>
    </section>
  );
}
