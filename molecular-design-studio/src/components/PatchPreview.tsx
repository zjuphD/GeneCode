/**
 * Patch preview panel — shows operation rows, affected features,
 * warnings, errors, and action controls.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { PatchPreview } from "../agent/patchTypes";
import {
  buildPatchDiffMarkers,
  type PatchDiffMarker,
} from "../agent/patchDiffMarkers";
import { buildOperationHints } from "../agent/operationHints";
import { DiffMarkerTooltip } from "./DiffMarkerTooltip";

export interface PatchPreviewProps {
  preview: PatchPreview;
  warningsAcknowledged: boolean;
  onAcknowledgeWarnings: (ack: boolean) => void;
  onApply: () => void;
  onReject: () => void;
  /**
   * Apply the same change to a *copy* of the current sequence opened as a new
   * file/project, leaving the original document and its file untouched.
   */
  onApplyAsNewFile?: () => void;
  /**
   * Timeline-playback reveal: how many diff blocks are currently lit. Blocks
   * past this index render as faint "ghost" outlines until the playback lights
   * them one by one. Defaults to all markers (no playback) when omitted.
   */
  revealedCount?: number;
  /**
   * Operation row to focus once the playback finishes: the matching row is
   * highlighted and scrolled into view so the user lands on the final change.
   */
  focusedOperationId?: string | null;
}

const DIFF_KIND_CLASS: Record<PatchDiffMarker["kind"], string> = {
  insert: "patch-preview__diff-block--insert",
  delete: "patch-preview__diff-block--delete",
  replace: "patch-preview__diff-block--replace",
  add_feature: "patch-preview__diff-block--add",
  remove_feature: "patch-preview__diff-block--remove",
};

/** Dot markers share the same hues but must NOT inherit block animations. */
const DIFF_DOT_CLASS: Record<PatchDiffMarker["kind"], string> = {
  insert: "patch-preview__diff-item-dot--insert",
  delete: "patch-preview__diff-item-dot--delete",
  replace: "patch-preview__diff-item-dot--replace",
  add_feature: "patch-preview__diff-item-dot--feature",
  remove_feature: "patch-preview__diff-item-dot--feature",
};

/**
 * Animated diff track: renders each operation as a colored block positioned
 * on the before-sequence coordinate space. Timeline playback: blocks before
 * `revealedCount` are lit (each playing its kind animation on reveal), the
 * rest render as ghost outlines until the playback reaches them. Insert blocks
 * flash in, added features grow, deletions fade out, replacements pulse
 * (see App.css).
 */
function DiffTrack({
  markers,
  length,
  revealedCount = markers.length,
}: {
  markers: PatchDiffMarker[];
  length: number;
  revealedCount?: number;
}) {
  const denominator = Math.max(1, length);
  // Hovered marker drives the before→after tooltip. The track itself is
  // overflow-hidden, so the tooltip renders in a positioned wrapper around it.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoveredMarker = markers.find((marker) => marker.id === hoveredId) ?? null;
  const hoverCenter = useMemo(() => {
    if (!hoveredMarker) return null;
    const start = Math.max(
      0,
      Math.min(99.4, (hoveredMarker.start / denominator) * 100),
    );
    const width = Math.max(
      0.7,
      Math.min(100 - start, ((hoveredMarker.end - hoveredMarker.start) / denominator) * 100),
    );
    return start + width / 2;
  }, [hoveredMarker, denominator]);

  return (
    <div className="patch-preview__diff" role="img" aria-label="Proposed diff 示意图：各操作在原始序列上的位置">
      <div className="patch-preview__diff-header">
        <span className="patch-preview__section-title">Proposed diff</span>
        {revealedCount < markers.length && (
          <span className="patch-preview__diff-progress" aria-hidden="true">
            {revealedCount}/{markers.length}
          </span>
        )}
        <span className="patch-preview__diff-legend" aria-hidden="true">
          <i className="patch-preview__diff-legend-dot patch-preview__diff-legend-dot--insert" /> 插入
          <i className="patch-preview__diff-legend-dot patch-preview__diff-legend-dot--delete" /> 删除
          <i className="patch-preview__diff-legend-dot patch-preview__diff-legend-dot--replace" /> 替换
          <i className="patch-preview__diff-legend-dot patch-preview__diff-legend-dot--feature" /> 特征
        </span>
      </div>
      <div className="patch-preview__diff-track-wrap">
        <div className="patch-preview__diff-track">
          {markers.map((marker, index) => {
            const start = Math.max(
              0,
              Math.min(99.4, (marker.start / denominator) * 100),
            );
            const width = Math.max(
              0.7,
              Math.min(100 - start, ((marker.end - marker.start) / denominator) * 100),
            );
            const revealed = index < revealedCount;
            return (
              <span
                key={marker.id}
                className={`patch-preview__diff-block ${DIFF_KIND_CLASS[marker.kind]}${
                  revealed
                    ? " patch-preview__diff-block--revealed"
                    : " patch-preview__diff-block--ghost"
                }${hoveredId === marker.id ? " patch-preview__diff-block--hovered" : ""}`}
                style={{ left: `${start}%`, width: `${width}%` }}
                onMouseEnter={() => setHoveredId(marker.id)}
                onMouseLeave={() => setHoveredId(null)}
              />
            );
          })}
        </div>
        {hoveredMarker && hoverCenter !== null && (
          <DiffMarkerTooltip
            marker={hoveredMarker}
            className="patch-preview__diff-tooltip"
            leftPercent={hoverCenter}
          />
        )}
      </div>
      <div className="patch-preview__diff-items">
        {markers.map((marker, index) => (
          <span
            key={marker.id}
            className={`patch-preview__diff-item${index < revealedCount ? " patch-preview__diff-item--revealed" : " patch-preview__diff-item--ghost"}`}
          >
            <i className={`patch-preview__diff-item-dot ${DIFF_DOT_CLASS[marker.kind]}`} aria-hidden="true" />
            {marker.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function PatchPreviewPanel({
  preview,
  warningsAcknowledged,
  onAcknowledgeWarnings,
  onApply,
  onReject,
  onApplyAsNewFile,
  revealedCount,
  focusedOperationId,
}: PatchPreviewProps) {
  const hasErrors = preview.errors.length > 0;
  const hasWarnings = preview.warnings.length > 0;
  const canApply = !hasErrors && (!hasWarnings || warningsAcknowledged);
  const diffMarkers = useMemo(() => buildPatchDiffMarkers(preview), [preview]);
  // The focused operation row (set when the timeline playback finishes) is
  // highlighted and scrolled into view so the user lands on the final change.
  const focusedRowRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    if (!focusedOperationId) return;
    focusedRowRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [focusedOperationId]);

  return (
    <div className="patch-preview">
      <div className="patch-preview__header">
        <strong>{preview.title}</strong>
        <span className="patch-preview__summary">{preview.summary}</span>
      </div>

      <div className="patch-preview__meta">
        <span>
          长度：{preview.beforeLength.toLocaleString()} bp
          {preview.afterLength !== null &&
            ` → ${preview.afterLength.toLocaleString()} bp`}
        </span>
        {preview.operations.length > 0 && (
          <span>{preview.operations.length} 个操作</span>
        )}
      </div>

      {diffMarkers.length > 0 && (
        <DiffTrack
          markers={diffMarkers}
          length={preview.beforeLength}
          revealedCount={revealedCount}
        />
      )}

      {preview.operations.length > 0 && (
        <div className="patch-preview__table-scroll" role="region" aria-label="修改操作明细，可横向滚动" tabIndex={0}>
        <table className="patch-preview__ops">
          <thead>
            <tr>
              <th>类型</th>
              <th>位置</th>
              <th>原因</th>
              <th>Δ</th>
              <th>提示</th>
            </tr>
          </thead>
          <tbody>
            {preview.operations.map((op) => (
              <tr
                key={op.operationId}
                ref={op.operationId === focusedOperationId ? focusedRowRef : undefined}
                className={op.operationId === focusedOperationId ? "patch-preview__ops-row--focused" : undefined}
                data-focused={op.operationId === focusedOperationId ? "true" : undefined}
              >
                <td>{op.kind}</td>
                <td><code>{op.coordinates}</code></td>
                <td>{op.reason}</td>
                <td>
                  {op.lengthDelta > 0 ? "+" : ""}
                  {op.lengthDelta}
                </td>
                <td>
                  {buildOperationHints(op).map((hint) => (
                    <span
                      key={hint.id}
                      className={`patch-preview__bio-chip patch-preview__bio-chip--${hint.tone}`}
                      title={hint.title}
                    >
                      {hint.label}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {preview.affectedFeatures.length > 0 && (
        <div className="patch-preview__features">
          <div className="patch-preview__section-title">受影响的注释</div>
          <ul>
            {preview.affectedFeatures.map((f) => (
              <li key={f.featureId}>
                <span
                  className={`patch-preview__feature-action patch-preview__feature-action--${f.action}`}
                >
                  {f.action}
                </span>{" "}
                <strong>{f.featureName}</strong> — {f.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasErrors && (
        <div className="patch-preview__errors">
          {preview.errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      {hasWarnings && (
        <div className="patch-preview__warnings">
          {preview.warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
          <label className="patch-preview__ack">
            <input
              type="checkbox"
              checked={warningsAcknowledged}
              onChange={(e) => onAcknowledgeWarnings(e.target.checked)}
            />
            我已了解这些警告
          </label>
        </div>
      )}

      <div className="patch-preview__actions">
        <button
          type="button"
          className="patch-preview__btn patch-preview__btn--apply"
          disabled={!canApply}
          onClick={onApply}
        >
          应用到载体
        </button>
        {onApplyAsNewFile && (
          <button
            type="button"
            className="patch-preview__btn patch-preview__btn--copy"
            disabled={!canApply}
            onClick={onApplyAsNewFile}
          >
            复制为新文件并应用
          </button>
        )}
        <button
          type="button"
          className="patch-preview__btn patch-preview__btn--reject"
          onClick={onReject}
        >
          拒绝
        </button>
      </div>
      {onApplyAsNewFile && (
        <p className="patch-preview__copy-note">
          原文件保持不变，修改应用到副本并作为新文件打开。
        </p>
      )}
    </div>
  );
}

export default PatchPreviewPanel;
