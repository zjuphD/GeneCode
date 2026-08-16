/**
 * operationHints — biology hint badges for patch operations.
 *
 * Rendered in the PatchPreview operation table to help users quickly judge
 * whether a proposed change is biologically reasonable before applying it:
 * - insert / replace: GC content of the affected sequence (with a warning
 *   band for extreme values).
 * - add_feature / remove_feature: the feature type, humanized.
 *
 * Pure and serializable — no React, no document access.
 */

import { gcPercent } from "../editor/sequenceActions";
import { analyzeReplaceTranslation, isAmbiguityRich } from "./translationConsequences";
import type { PreviewOperationRow } from "./patchTypes";

export type OperationHintTone = "ok" | "warn" | "info";

export interface OperationHint {
  id: string;
  tone: OperationHintTone;
  label: string;
  title: string;
}

/** GC outside this band gets a caution tone (common primer/oligo design rule). */
const GC_WARN_LOW = 30;
const GC_WARN_HIGH = 70;

const FEATURE_TYPE_LABELS: Record<string, string> = {
  CDS: "CDS",
  gene: "基因",
  promoter: "启动子",
  terminator: "终止子",
  rep_origin: "复制起点",
  primer_bind: "引物结合",
  regulatory: "调控元件",
  misc_feature: "其他特征",
  source: "来源",
  restriction_site: "酶切位点",
};

export function featureTypeLabel(type: string): string {
  return FEATURE_TYPE_LABELS[type] ?? type;
}

function gcHint(
  id: string,
  sequence: string | undefined,
  tonePrefix: string,
): OperationHint | null {
  if (!sequence || sequence.length === 0) return null;
  // Guard against misleading low-GC warnings for ambiguity-rich sequences.
  if (isAmbiguityRich(sequence)) return null;
  const gc = gcPercent(sequence);
  const extreme = gc < GC_WARN_LOW || gc > GC_WARN_HIGH;
  const rounded = gc.toFixed(0);
  return {
    id,
    tone: extreme ? "warn" : "ok",
    label: `${tonePrefix} GC ${rounded}%`,
    title: extreme
      ? `GC 含量 ${rounded}% 超出常用区间（${GC_WARN_LOW}–${GC_WARN_HIGH}%），可能影响杂交/克隆效率`
      : `GC 含量 ${rounded}%，在常用区间（${GC_WARN_LOW}–${GC_WARN_HIGH}%）内`,
  };
}

/**
 * Build biology hint badges for one preview operation row. Rows without
 * sequence detail (e.g. feature ops without a resolved type) yield no hints.
 */
export function buildOperationHints(row: PreviewOperationRow): OperationHint[] {
  const hints: OperationHint[] = [];

  switch (row.kind) {
    case "insert": {
      const hint = gcHint("insert-gc", row.afterSequence, "插入");
      if (hint) hints.push(hint);
      break;
    }
    case "replace": {
      // Translation consequences (frameshift, codon changes, stop codon)
      // are the highest-signal hints for a replace and come first.
      if (row.beforeSequence && row.afterSequence) {
        const t = analyzeReplaceTranslation(row.beforeSequence, row.afterSequence);
        if (t.frameshiftRisk) {
          hints.push({
            id: "replace-frameshift",
            tone: "warn",
            label: "移码风险",
            title: `替换长度变化 ${t.lengthDelta > 0 ? "+" : ""}${t.lengthDelta} bp 不是 3 的倍数，替换位点之后的所有密码子都将移位`,
          });
        }
        if (t.introducedStop) {
          hints.push({
            id: "replace-stop",
            tone: "warn",
            label: "引入终止密码子",
            title: `替换后第 ${t.introducedStop.index} 个密码子 ${t.introducedStop.before}(${t.introducedStop.beforeAa}) → ${t.introducedStop.after}(*)，将提前终止翻译`,
          });
        }
        if (t.codonChanges.length > 0) {
          const first = t.codonChanges[0]!;
          const label =
            t.codonChanges.length === 1
              ? `密码子 ${first.before}→${first.after}`
              : `密码子 ${t.codonChanges.length} 处改变`;
          const changes =
            t.codonChanges.length === 1
              ? `第 ${first.index} 个密码子 ${first.before}(${first.beforeAa}) → ${first.after}(${first.afterAa})`
              : `${t.codonChanges.length} 个密码子改变：${t.codonChanges
                  .map((c) => `${c.index}:${c.before}(${c.beforeAa})→${c.after}(${c.afterAa})`)
                  .join(" ")}`;
          const translations =
            t.beforeTranslation || t.afterTranslation
              ? `；区域翻译 ${t.beforeTranslation || "—"} → ${t.afterTranslation || "—"}`
              : "";
          hints.push({
            id: "replace-codons",
            tone: "info",
            label,
            title: `${changes}${translations}；按替换区域起点对齐（假定密码子边界，长度非 3 的倍数时后续实际密码子会偏移）`,
          });
        }
      }
      const before = gcHint("replace-before-gc", row.beforeSequence, "替换前");
      if (before) hints.push(before);
      const after = gcHint("replace-after-gc", row.afterSequence, "替换后");
      if (after) hints.push(after);
      break;
    }
    case "delete": {
      const hint = gcHint("delete-gc", row.beforeSequence, "删除");
      if (hint) hints.push(hint);
      break;
    }
    case "add_feature":
    case "remove_feature": {
      if (!row.featureType) break;
      const label = featureTypeLabel(row.featureType);
      hints.push({
        id: `${row.kind}-type`,
        tone: "info",
        label: `${row.kind === "add_feature" ? "新增" : "移除"} · ${label}`,
        title: `${row.kind === "add_feature" ? "新增" : "移除"}特征类型：${row.featureType}`,
      });
      break;
    }
  }

  return hints;
}
