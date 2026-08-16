/**
 * DiffMarkerTooltip — rich hover tooltip for Proposed-track diff markers.
 *
 * Shows the operation kind, coordinates, reason, and a before→after sequence
 * comparison (inserted bases / removed fragment / replaced old and new).
 * Long sequences are truncated with the full value available on hover.
 *
 * The tooltip is positioned by its parent with an absolute `left` percentage
 * matching the marker's track position; the component clamps the center so it
 * stays inside the track.
 */

import type { PatchDiffMarker } from "../agent/patchDiffMarkers";

const MAX_SEQUENCE_SHOWN = 60;

function formatRange(marker: PatchDiffMarker): string {
  if (marker.kind === "insert" || marker.start === marker.end) {
    return `位置 ${marker.start + 1}`;
  }
  return `${marker.start + 1}–${marker.end}`;
}

function truncate(sequence: string): string {
  return sequence.length > MAX_SEQUENCE_SHOWN
    ? `${sequence.slice(0, MAX_SEQUENCE_SHOWN)}…`
    : sequence;
}

export function DiffMarkerTooltip({
  marker,
  className,
  leftPercent,
}: {
  marker: PatchDiffMarker;
  className?: string;
  /** Center of the tooltip as a percentage of the track (0-100). */
  leftPercent: number;
}) {
  const before = marker.beforeSequence;
  const after = marker.afterSequence;
  const hasBefore = typeof before === "string" && before.length > 0;
  const hasAfter = typeof after === "string" && after.length > 0;
  // Keep the centered tooltip inside the track even for edge markers.
  // Tighter than the raw center so wide tooltips don't spill past the track.
  const clamped = Math.max(16, Math.min(84, leftPercent));

  return (
    <div
      className={`diff-tooltip${className ? ` ${className}` : ""}`}
      role="tooltip"
      style={{ left: `${clamped}%` }}
    >
      <div className="diff-tooltip__head">
        <span className={`diff-tooltip__kind diff-tooltip__kind--${marker.kind}`}>
          {marker.label}
        </span>
        <span className="diff-tooltip__coords">{formatRange(marker)}</span>
      </div>
      {marker.reason && (
        <div className="diff-tooltip__reason">{marker.reason}</div>
      )}
      {(hasBefore || hasAfter) && (
        <div className="diff-tooltip__compare">
          {hasBefore && (
            <div className="diff-tooltip__row diff-tooltip__row--before">
              <span className="diff-tooltip__row-label">
                {marker.kind === "delete" ? "删除" : "替换前"}
              </span>
              <code className="diff-tooltip__seq" title={before}>
                {truncate(before!)}
              </code>
            </div>
          )}
          {hasBefore && hasAfter && (
            <span className="diff-tooltip__arrow" aria-hidden="true">↓</span>
          )}
          {hasAfter && (
            <div className="diff-tooltip__row diff-tooltip__row--after">
              <span className="diff-tooltip__row-label">
                {marker.kind === "insert" ? "插入" : "替换后"}
              </span>
              <code className="diff-tooltip__seq" title={after}>
                {truncate(after!)}
              </code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
