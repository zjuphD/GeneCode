/**
 * CandidateCards — display top candidate with primer table, metrics, and explanation.
 */

import { useEffect, useRef, useState } from "react";
import type { ResultCandidate } from "../agent/responseTypes";
import { ConstructReview } from "./ConstructReview";
import { PrimerExplanation } from "./PrimerExplanation";
import { CopyActionButton } from "./CopyActionButton";
import type { SequenceDocument, SequenceFeatureInput } from "../types";
import { canWritePrimerFeatures } from "./candidateWriteback";

// ── Helpers ────────────────────────────────────────────────

function formatNumber(value: number | null, suffix = ""): string {
  if (value === null || value === undefined) return "-";
  return `${value}${suffix}`;
}

function SequenceRowDisplay({ rows }: { rows: Array<{ label: string; value: string }> }) {
  if (rows.length === 0) return null;
  return (
    <div className="agent-sequence-rows">
      {rows.map((row, i) => (
        <div key={i} className="agent-sequence-row">
          <span className="agent-sequence-row__label">{row.label}</span>
          <code className="agent-sequence-row__value">{row.value}</code>
        </div>
      ))}
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getFragmentPrimers(candidate: ResultCandidate): Array<Record<string, unknown>> {
  return Array.isArray(candidate.raw?.fragment_primers)
    ? candidate.raw.fragment_primers.filter(isRecord)
    : [];
}

function FragmentPrimerTable({ candidate }: { candidate: ResultCandidate }) {
  const fragmentPrimers = getFragmentPrimers(candidate);
  if (fragmentPrimers.length === 0) return null;

  return (
    <section className="agent-fragment-primers" aria-label="多片段引物清单">
      <div className="agent-fragment-primers__header">
        <strong>片段引物清单</strong>
        <span>{fragmentPrimers.length} 个片段 · {fragmentPrimers.length * 2} 条引物</span>
      </div>
      <div className="agent-fragment-primers__scroll">
        <table className="agent-fragment-primers__table">
          <thead>
            <tr>
              <th>片段</th>
              <th>Forward</th>
              <th>Reverse</th>
              <th>连接边界</th>
              <th>Tm / GC</th>
            </tr>
          </thead>
          <tbody>
            {fragmentPrimers.map((fragment, index) => {
              const name = textValue(fragment.fragmentName) || `Fragment ${index + 1}`;
              const forward = textValue(fragment.f);
              const reverse = textValue(fragment.r);
              const forwardOverhang = textValue(fragment.forwardOverhang || fragment.forwardTailSource);
              const reverseOverhang = textValue(fragment.reverseOverhang || fragment.reverseTailSource);
              const tmForward = numberValue(fragment.tm_f);
              const tmReverse = numberValue(fragment.tm_r);
              const gcForward = numberValue(fragment.gc_f);
              const gcReverse = numberValue(fragment.gc_r);
              return (
                <tr key={`${name}-${index}`}>
                  <th scope="row">{name}</th>
                  <td><code>{forward || "-"}</code></td>
                  <td><code>{reverse || "-"}</code></td>
                  <td>
                    <span className="agent-fragment-primers__junction">
                      {forwardOverhang || "-"} → {reverseOverhang || "-"}
                    </span>
                  </td>
                  <td>
                    <span className="agent-fragment-primers__metrics">
                      <span>{tmForward ?? "-"} / {tmReverse ?? "-"}°C</span>
                      <span>{gcForward ?? "-"} / {gcReverse ?? "-"}%</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="agent-fragment-primers__note">
        每行对应一条片段 PCR；连接边界是 5′ assembly tail，订购时使用完整序列。
      </p>
    </section>
  );
}

function buildPrimerOrderTsv(candidate: ResultCandidate): string {
  const notes: string[] = [];
  if (candidate.insertLength !== null) notes.push(`${candidate.insertLength} bp insert`);
  if (candidate.annealTemp !== null) notes.push(`anneal ${candidate.annealTemp}°C`);
  if (candidate.extensionSec !== null) notes.push(`extension ${candidate.extensionSec}s`);
  const notesStr = notes.join("; ");
  const header = "Name\tSequence\tTm\tGC\tLength\tNotes";
  const fwd = [
    "Forward primer",
    candidate.forwardPrimer ?? "-",
    formatNumber(candidate.tmForward, "°C"),
    formatNumber(candidate.gcForward, "%"),
    formatNumber(candidate.fullLengthForward, " nt"),
    notesStr,
  ].join("\t");
  const rev = [
    "Reverse primer",
    candidate.reversePrimer ?? "-",
    formatNumber(candidate.tmReverse, "°C"),
    formatNumber(candidate.gcReverse, "%"),
    formatNumber(candidate.fullLengthReverse, " nt"),
    notesStr,
  ].join("\t");
  const rows = [header, fwd, rev];
  const fragmentPrimers = Array.isArray(candidate.raw?.fragment_primers)
    ? candidate.raw.fragment_primers.filter(isRecord)
    : [];
  if (fragmentPrimers.length > 0) {
    rows.splice(1, rows.length - 1);
    fragmentPrimers.forEach((fragment) => {
      const fragmentName = typeof fragment.fragmentName === "string"
        ? fragment.fragmentName
        : `Fragment ${Number(fragment.fragmentIndex ?? 0) + 1}`;
      const addFragmentPrimer = (direction: "Forward" | "Reverse") => {
        const isForward = direction === "Forward";
        const sequence = fragment[isForward ? "f" : "r"];
        const tm = fragment[isForward ? "tm_f" : "tm_r"];
        const gc = fragment[isForward ? "gc_f" : "gc_r"];
        const length = fragment[isForward ? "full_length_f" : "full_length_r"];
        rows.push([
          `${fragmentName} ${direction}`,
          typeof sequence === "string" ? sequence : "-",
          formatNumber(typeof tm === "number" ? tm : null, "°C"),
          formatNumber(typeof gc === "number" ? gc : null, "%"),
          formatNumber(typeof length === "number" ? length : null, " nt"),
          `${candidate.raw?.method === "golden_gate" ? "Golden Gate" : "Multi-fragment assembly"}; ${notesStr}`,
        ].join("\t"));
      };
      addFragmentPrimer("Forward");
      addFragmentPrimer("Reverse");
    });
  }
  const review = isRecord(candidate.raw?.construct_review) ? candidate.raw.construct_review : null;
  const backbone = review && isRecord(review.backboneLinearization) ? review.backboneLinearization : null;
  if (backbone?.available === true) {
    const backboneNotes = "inverse PCR backbone linearization";
    rows.push([
      "Backbone Forward",
      typeof backbone.forwardPrimer === "string" ? backbone.forwardPrimer : "-",
      formatNumber(typeof backbone.tmForward === "number" ? backbone.tmForward : null, "°C"),
      formatNumber(typeof backbone.gcForward === "number" ? backbone.gcForward : null, "%"),
      typeof backbone.forwardPrimer === "string" ? `${backbone.forwardPrimer.length} nt` : "-",
      backboneNotes,
    ].join("\t"));
    rows.push([
      "Backbone Reverse",
      typeof backbone.reversePrimer === "string" ? backbone.reversePrimer : "-",
      formatNumber(typeof backbone.tmReverse === "number" ? backbone.tmReverse : null, "°C"),
      formatNumber(typeof backbone.gcReverse === "number" ? backbone.gcReverse : null, "%"),
      typeof backbone.reversePrimer === "string" ? `${backbone.reversePrimer.length} nt` : "-",
      backboneNotes,
    ].join("\t"));
  }
  return rows.join("\n");
}

function CopyPrimerOrderButton({ candidate }: { candidate: ResultCandidate }) {
  if (!candidate.forwardPrimer && !candidate.reversePrimer && getFragmentPrimers(candidate).length === 0) return null;
  return <CopyActionButton label="复制引物订购表" getText={() => buildPrimerOrderTsv(candidate)} />;
}

function buildResultTableText(candidate: ResultCandidate): string {
  const lines: string[] = [];
  if (candidate.title) lines.push(`# ${candidate.title}`);
  if (candidate.summary) lines.push(candidate.summary);
  const rows = candidate.sequenceRows ?? [];
  if (rows.length > 0) {
    lines.push("");
    for (const row of rows) {
      lines.push(`${row.label}\t${row.value}`);
    }
  }
  const metrics = candidate.metrics ?? [];
  if (metrics.length > 0) {
    lines.push(metrics.join("\t"));
  }
  return lines.join("\n");
}

// ── Component ──────────────────────────────────────────────

export function CandidateCards({ candidates, document, onAddFeature, focusedIndex = null, focusToken = 0 }: {
  candidates: ResultCandidate[];
  document?: SequenceDocument | null;
  onAddFeature?: (feature: SequenceFeatureInput) => void;
  /**
   * When set (with a changing focusToken), switch to this candidate and
   * scroll it into view with a brief highlight pulse.
   */
  focusedIndex?: number | null;
  focusToken?: number;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [flash, setFlash] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusedIndex == null) return;
    if (focusedIndex < 0 || focusedIndex >= candidates.length) return;
    setSelectedIndex(focusedIndex);
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), 1400);
    // jsdom does not implement scrollIntoView; guard so tests stay stable.
    cardRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    return () => window.clearTimeout(timer);
  }, [focusedIndex, focusToken, candidates.length]);

  const top = candidates[selectedIndex] ?? candidates[0];
  if (!top) return null;

  const fragmentPrimers = getFragmentPrimers(top);
  const isMultiFragment = fragmentPrimers.length > 0;
  const hasPrimerPair = !isMultiFragment && (top.forwardPrimer !== null || top.reversePrimer !== null);
  const hasPrimerResult = hasPrimerPair || isMultiFragment;
  const sequenceRows = top.sequenceRows ?? [];
  const metrics = top.metrics ?? [];
  const extraSequenceRows = hasPrimerPair
    ? sequenceRows.filter((row) => {
        const label = row.label.toLowerCase();
        return label !== "forward" && label !== "reverse";
      })
    : sequenceRows;

  const hasNonCloningData = !hasPrimerPair && (sequenceRows.length > 0 || metrics.length > 0);
  const hasPrimerCoordinates = top.bindingStartForward != null && top.bindingEndForward != null;
  const canWriteFeatures = hasPrimerPair && Boolean(onAddFeature) && canWritePrimerFeatures(top, document ?? null);

  return (
    <div ref={cardRef} className={`agent-candidate${flash ? " agent-candidate--focused" : ""}`}>
      <div className="agent-candidate__header">
        <span>{top.title ?? "首选候选"}</span>
        {top.insertLength !== null && (
          <span>插入片段 {top.insertLength.toLocaleString()} bp</span>
        )}
      </div>
      {top.summary && (
        <div className="agent-candidate__summary">{top.summary}</div>
      )}
      {extraSequenceRows.length > 0 && (
        <SequenceRowDisplay rows={extraSequenceRows} />
      )}
      {hasPrimerPair && (
        <>
          <table className="agent-primer-table">
            <thead>
              <tr>
                <th>引物</th>
                <th>序列</th>
                <th>Tm</th>
                <th>GC</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>正向</td>
                <td><code>{top.forwardPrimer ?? "-"}</code></td>
                <td>{formatNumber(top.tmForward, "°C")}</td>
                <td>{formatNumber(top.gcForward, "%")}</td>
              </tr>
              <tr>
                <td>反向</td>
                <td><code>{top.reversePrimer ?? "-"}</code></td>
                <td>{formatNumber(top.tmReverse, "°C")}</td>
                <td>{formatNumber(top.gcReverse, "%")}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}
      <FragmentPrimerTable candidate={top} />
      {hasPrimerResult && <CopyPrimerOrderButton candidate={top} />}
      {metrics.length > 0 ? (
        <div className="agent-candidate__metrics">
          {metrics.map((m, i) => <span key={i}>{m}</span>)}
        </div>
      ) : (
        <div className="agent-candidate__metrics">
          {top.tmDelta !== null &&          <span>Tm 差异 {top.tmDelta}°C</span>}
          {top.fullLengthForward !== null && <span>正向全长 {top.fullLengthForward} nt</span>}
          {top.fullLengthReverse !== null && <span>反向全长 {top.fullLengthReverse} nt</span>}
          {top.crossDimer !== null && (
            <span>交叉二聚体 {top.crossDimer ? "需复核" : "无"}</span>
          )}
          {top.annealTemp !== null && <span>退火 {top.annealTemp}°C</span>}
          {top.extensionSec !== null && <span>延伸 {top.extensionSec}s</span>}
        </div>
      )}
      {hasPrimerResult && <ConstructReview candidate={top} />}
      {hasPrimerResult && <PrimerExplanation candidate={top} />}
      {/* Save primer results as sequence features */}
      {canWriteFeatures && onAddFeature && (
        <div className="agent-copy-action">
          <button
            type="button"
            className="agent-btn agent-btn--secondary"
            onClick={() => {
              if (top.bindingStartForward != null && top.bindingEndForward != null) {
                onAddFeature({
                  name: `Forward primer (${top.title ?? "candidate"})`,
                  type: "primer",
                  start: top.bindingStartForward,
                  end: top.bindingEndForward,
                  strand: 1,
                  color: "#4f7fa8",
                  qualifiers: {
                    direction: ["forward"],
                    ...(top.forwardPrimer ? { sequence: [top.forwardPrimer] } : {}),
                    ...(top.forwardCore ? { binding_sequence: [top.forwardCore] } : {}),
                    ...(top.tmForward != null ? { tm: [String(top.tmForward)] } : {}),
                    ...(top.gcForward != null ? { gc_percent: [String(top.gcForward)] } : {}),
                    ...(top.title ? { design_candidate: [top.title] } : {}),
                  },
                });
              }
              if (top.bindingStartReverse != null && top.bindingEndReverse != null) {
                onAddFeature({
                  name: `Reverse primer (${top.title ?? "candidate"})`,
                  type: "primer",
                  start: top.bindingStartReverse,
                  end: top.bindingEndReverse,
                  strand: -1,
                  color: "#a76565",
                  qualifiers: {
                    direction: ["reverse"],
                    ...(top.reversePrimer ? { sequence: [top.reversePrimer] } : {}),
                    ...(top.reverseCore ? { binding_sequence: [top.reverseCore] } : {}),
                    ...(top.tmReverse != null ? { tm: [String(top.tmReverse)] } : {}),
                    ...(top.gcReverse != null ? { gc_percent: [String(top.gcReverse)] } : {}),
                    ...(top.title ? { design_candidate: [top.title] } : {}),
                  },
                });
              }
            }}
          >
            将引物保存到打开的插入片段
          </button>
        </div>
      )}
      {hasPrimerPair && hasPrimerCoordinates && !canWriteFeatures && top.bindingTarget === "insert" && (
        <p className="agent-candidate__writeback-note">
          引物坐标属于插入片段序列。打开该插入片段即可保存这些注释。
        </p>
      )}
      {hasNonCloningData && (
        <CopyActionButton
          label="复制结果表"
          getText={() => buildResultTableText(top)}
        />
      )}
      {candidates.length > 1 && (
        <div className="agent-candidate__switcher">
          {candidates.map((c, i) => (
            <button
              key={i}
              type="button"
              className={`agent-candidate__switcher-btn${i === selectedIndex ? " agent-candidate__switcher-btn--active" : ""}`}
              onClick={() => setSelectedIndex(i)}
              title={c.title ?? `Candidate ${i + 1}`}
            >
              {i === 0 ? "Top" : `#${i + 1}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
