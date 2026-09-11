import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { getComplementSequenceString } from "@teselagen/sequence-utils";
import prepareRowData from "../../utils/prepareRowData";
import withEditorInteractions from "../../withEditorInteractions";
import {
  editorDragged,
  editorDragStarted,
  editorDragStopped
} from "../../withEditorInteractions/clickAndDragUtils";
import "./style.css";
import {
  buildRowLayout,
  buildRowOffsets,
  DEFAULT_LAYOUT_OPTIONS,
  SEQUENCE_PANEL_LAYOUT_VERSION,
  fitAnnotationLabel,
  hasAnnotationArrowhead,
  getAnnotationLabel,
  getRecognitionSiteOverlaps,
  getCutsitePosition,
  getCutsiteBottomPosition,
  getCutsiteGroupKey,
  getFocusPosition,
  getStableBpsPerRow,
  getNearestCaretPosition,
  getAutoScrollDelta,
  isCaretWithinSelection,
  getRowIndexForContentOffset,
  getRowIndexForPosition,
  getVisibleRowRange
} from "./layout";

const EMPTY_SEQUENCE_DATA = { sequence: "", features: [], parts: [], primers: [], translations: [] };
const AUTO_SCROLL_EDGE_THRESHOLD = 56;
const AUTO_SCROLL_MAX_SPEED = 22;

function getSequenceString(row) {
  return typeof row?.sequence === "string" ? row.sequence : "";
}

function getItemColor(item, fallback) {
  const color = item?.annotation?.color || item?.annotation?.labelColor;
  if (typeof color !== "string") return fallback;
  return color.startsWith("override_") ? color.slice("override_".length) : color;
}

function getTrack(layout, id) {
  return layout.tracks.find(track => track.id === id);
}

function getBaseX(layout, row, position) {
  return layout.leftGutter + (position - row.start) * layout.charWidth;
}

function getRangeWidth(item, charWidth) {
  return Math.max(charWidth, (item.end - item.start + 1) * charWidth);
}

function renderCutsiteRecognition(item, row, layout, sequenceForwardTrack, sequenceReverseTrack, sequenceLength, isHovered) {
  // SnapGene keeps the sequence quiet until the pointer is over a site. The
  // recognition motif and the two-strand cut geometry are hover feedback, not
  // permanent decoration on every base row.
  if (!isHovered) return null;
  const overlaps = getRecognitionSiteOverlaps(item, row, sequenceLength);
  if (!overlaps.length) return null;
  const tracks = [sequenceForwardTrack, sequenceReverseTrack].filter(Boolean);
  const color = "#8d989f";
  return overlaps.flatMap((range, rangeIndex) => {
    const x = getBaseX(layout, row, range.start);
    const width = Math.max(layout.charWidth, (range.end - range.start + 1) * layout.charWidth);
    return tracks.map(track => (
      <rect
        key={`cutsite-recognition-${item.id}-${rangeIndex}-${track.id}`}
        className="genecode-sequence-cutsite-recognition genecode-sequence-cutsite-recognition--hovered"
        data-recognition-start={range.start}
        data-recognition-end={range.end}
        x={x}
        y={track.y}
        width={width}
        height={track.height}
        rx="1"
        fill={color}
        fillOpacity="0.28"
        stroke={color}
        strokeOpacity="0.5"
        strokeWidth="0.7"
        pointerEvents="none"
      />
    ));
  });
}

function getInteractionType(item, trackKind) {
  if (item?.featureType || item?.labelType) {
    const type = item.featureType || item.labelType;
    return {
      parts: "part",
      features: "feature",
      warnings: "warning",
      assemblyPieces: "assemblyPiece",
      lineageAnnotations: "lineageAnnotation",
      primers: "primer",
      cutsites: "cutsite"
    }[type] || type;
  }
  if (trackKind === "primers") return "primer";
  if (trackKind === "translations") {
    return item?.id === "primaryProteinSequence" || item?.annotation?.annotationType === "primaryProteinSequence"
      ? "primaryProteinSequence"
      : "translation";
  }
  if (trackKind === "cutsites") return "cutsite";
  return null;
}

function getInteractionHandlers(item, trackKind, interactionProps) {
  const type = getInteractionType(item, trackKind);
  if (!type) return {};
  return {
    onClick: interactionProps?.[`${type}Clicked`],
    onDoubleClick: interactionProps?.[`${type}DoubleClicked`],
    onContextMenu: interactionProps?.[`${type}RightClicked`]
  };
}

function invokeAnnotationHandler(handler, event, item) {
  if (!handler) return false;
  handler({
    event,
    annotation: item.annotation || item,
    gapsBefore: 0,
    gapsInside: 0
  });
  return true;
}

function getHitRegionProps(handlers, item) {
  const hasAny = Boolean(handlers.onClick || handlers.onDoubleClick || handlers.onContextMenu);
  return {
    className: hasAny ? "genecode-sequence-hit-region" : undefined,
    role: hasAny ? "button" : undefined,
    tabIndex: hasAny ? 0 : undefined,
    onKeyDown: hasAny ? event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      invokeAnnotationHandler(handlers.onClick || handlers.onDoubleClick, event, item);
    } : undefined,
    onClick: event => invokeAnnotationHandler(handlers.onClick, event, item),
    onDoubleClick: event => invokeAnnotationHandler(handlers.onDoubleClick, event, item),
    onContextMenu: event => invokeAnnotationHandler(handlers.onContextMenu, event, item)
  };
}

function renderBases(row, layout, direction, sequenceData) {
  const sequence = getSequenceString(row);
  if (!sequence.length) return null;
  const text = direction === "reverse"
    ? getComplementSequenceString(sequence, sequenceData.isRna)
    : sequence;
  const track = getTrack(layout, `sequence-${direction}`);
  if (!track) return null;
  const y = track.y + track.height - 5;
  return Array.from(text).map((base, index) => (
    <text
      key={`${direction}-base-${row.start + index}`}
      x={layout.leftGutter + index * layout.charWidth + layout.charWidth / 2}
      y={y}
      textAnchor="middle"
      className={`genecode-sequence-base genecode-sequence-base-${direction}`}
    >
      {base}
    </text>
  ));
}

function renderRuler(row, layout, sequenceLength) {
  const track = getTrack(layout, "axis");
  if (!track) return null;
  const baseY = track.y + 3;
  const ticks = [];
  for (let offset = 0; offset < layout.rowLength; offset += 1) {
    const globalPosition = row.start + offset;
    const isMajor = globalPosition === 0 || (globalPosition + 1) % 10 === 0;
    if (!isMajor && layout.charWidth < 7) continue;
    const x = getBaseX(layout, row, globalPosition) + layout.charWidth / 2;
    ticks.push(
      <line
        key={`tick-${globalPosition}`}
        x1={x}
        x2={x}
        y1={baseY}
        y2={baseY + (isMajor ? 4 : 2)}
        stroke="#76808a"
        strokeWidth={isMajor ? 1 : 0.7}
      />
    );
    if (isMajor && layout.charWidth >= 7) {
      ticks.push(
        <text
          key={`tick-label-${globalPosition}`}
          x={x}
          y={track.y + track.height - 1}
          textAnchor="middle"
          className="genecode-sequence-ruler-label"
        >
          {Math.min(sequenceLength, globalPosition + 1)}
        </text>
      );
    }
  }
  return (
    <g className="genecode-sequence-ruler">
      <line
        x1={layout.leftGutter}
        x2={layout.leftGutter + layout.rowLength * layout.charWidth}
        y1={baseY}
        y2={baseY}
        stroke="#76808a"
      />
      {ticks}
    </g>
  );
}

function renderArrow(item, layout, track, fallbackColor, interactionProps, rowId) {
  const annotation = item.annotation || {};
  const x = getBaseX(layout, { start: layout.rowStart }, item.start);
  const width = getRangeWidth(item, layout.charWidth);
  const y = track.y + item.lane * track.laneHeight + 2;
  const height = Math.max(12, track.laneHeight - 4);
  const forward = annotation.forward !== false;
  const arrow = hasAnnotationArrowhead(item) ? Math.min(9, Math.max(3, width / 3)) : 0;
  const points = forward
    ? `${x},${y} ${x + width - arrow},${y} ${x + width},${y + height / 2} ${x + width - arrow},${y + height} ${x},${y + height}`
    : `${x + arrow},${y} ${x + width},${y} ${x + width},${y + height} ${x + arrow},${y + height} ${x},${y + height / 2}`;
  const handlers = getInteractionHandlers(item, track.kind, interactionProps);
  const color = getItemColor(item, fallbackColor);
  const label = item.label || getAnnotationLabel(item);
  const selected = interactionProps.selectionLayer?.start === item.sourceStart
    && interactionProps.selectionLayer?.end === item.sourceEnd;
  const clipId = `${rowId}-${track.id}-${item.id}-${item.start}-${item.lane}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const labelWidth = width - 14 - arrow;
  const hitProps = getHitRegionProps(handlers, item);
  return (
    <g
      key={`${track.id}-${item.id}-${item.start}-${item.end}`}
      {...hitProps}
      className={`${hitProps.className || ""} genecode-sequence-feature${selected ? " genecode-sequence-feature--selected" : ""}`}
      style={{ "--annotation-color": color }}
      aria-label={`${label}，${item.sourceStart + 1}–${item.sourceEnd + 1}，${forward ? "正向" : "反向"}`}
      aria-pressed={selected}
      data-annotation-id={annotation.id}
      data-arrowhead={arrow > 0}
    >
      <title>{`${label}\n${annotation.type || "特征"} · ${item.sourceStart + 1}–${item.sourceEnd + 1} · ${forward ? "正向 →" : "← 反向"}\n单击选中，双击编辑`}</title>
      <defs><clipPath id={clipId}><rect x={x + 7 + (forward ? 0 : arrow)} y={y} width={Math.max(0, labelWidth)} height={height} /></clipPath></defs>
      <polygon className="genecode-sequence-feature-shape" points={points} strokeWidth="1" strokeLinejoin="round" />
      {labelWidth >= 25 && (
        <text
          x={x + width / 2}
          y={y + height / 2}
          dominantBaseline="central"
          textAnchor="middle"
          clipPath={`url(#${clipId})`}
          className="genecode-sequence-feature-label"
        >
          {fitAnnotationLabel(label, labelWidth, 6.3)}
        </text>
      )}
    </g>
  );
}

function renderPrimer(item, layout, track, interactionProps) {
  const x = getBaseX(layout, { start: layout.rowStart }, item.start);
  const width = getRangeWidth(item, layout.charWidth);
  const y = track.y + item.lane * track.laneHeight + 16;
  const height = 14;
  const forward = item.annotation?.forward !== false;
  const arrow = hasAnnotationArrowhead(item) ? Math.min(7, Math.max(3, width / 3)) : 0;
  const points = forward
    ? `${x},${y} ${x + width - arrow},${y} ${x + width},${y + height / 2} ${x + width - arrow},${y + height} ${x},${y + height}`
    : `${x + arrow},${y} ${x + width},${y} ${x + width},${y + height} ${x + arrow},${y + height} ${x},${y + height / 2}`;
  const handlers = getInteractionHandlers(item, track.kind, interactionProps);
  return (
    <g
      key={`${track.id}-${item.id}-${item.start}-${item.end}`}
      {...getHitRegionProps(handlers, item)}
      aria-label={`${item.label}，引物，${item.sourceStart + 1}–${item.sourceEnd + 1}`}
    >
      <title>{`${item.label}\n引物 · ${item.sourceStart + 1}–${item.sourceEnd + 1} · ${forward ? "正向 →" : "← 反向"}`}</title>
      <polygon className="genecode-sequence-primer-shape" points={points} fill="white" stroke="#a541c7" strokeWidth="1.4" />
      {width >= 64 && (
        <text x={x + width / 2} y={y - 4} textAnchor="middle" className="genecode-sequence-primer-label">
          {fitAnnotationLabel(item.label || getAnnotationLabel(item, "Primer"), width - 22)}
        </text>
      )}
    </g>
  );
}

function renderLabels(track, layout, row, interactionProps, hoveredCutsiteId, onCutsiteHover, onToggleLabels) {
  if (!track) return null;
  const overflowWidth = Math.min(168, layout.rowLength * layout.charWidth);
  return (
    <g className="genecode-sequence-labels">
      {track.items.map(item => {
        const x = getBaseX(layout, row, getCutsitePosition(item, row));
        const labelX = getBaseX(layout, row, (item.labelExtent.start + item.labelExtent.end) / 2);
        const y = track.y + item.lane * track.laneHeight;
        const sequenceY = getTrack(layout, "sequence-forward")?.y ?? track.y + track.height;
        return <path key={`connector-${item.id}-${item.start}`} className={`genecode-sequence-cutsite-connector${hoveredCutsiteId === item.id ? " genecode-sequence-cutsite-connector--hovered" : ""}`} d={`M ${labelX} ${y + 15} L ${x} ${y + 18} L ${x} ${sequenceY - 2}`} fill="none" pointerEvents="none" />;
      })}
      {track.items.map(item => {
        const anchor = item.labelType === "cutsites"
          ? getCutsitePosition(item, row)
          : item.start;
        const isCutsite = item.labelType === "cutsites";
        const labelLeft = getBaseX(layout, row, item.labelExtent.start);
        const labelWidth = (item.labelExtent.end - item.labelExtent.start) * layout.charWidth;
        const labelX = labelLeft + labelWidth / 2;
        const y = track.y + item.lane * track.laneHeight;
        // Each collision-free lane owns its own connector baseline. The old
        // implementation reused lane 0's baseline for every label, which made
        // labels in lanes 1–3 appear to cross and visually overlap.
        const labelY = y + 12;
        const handlers = getInteractionHandlers(item, item.labelType, interactionProps);
        const cutsiteClass = isCutsite
          ? item.annotation?.labelClassName || item.annotation?.labelClassname || item.labelClassName || item.labelClassname || ""
          : "";
        const isCutsiteHovered = isCutsite && hoveredCutsiteId === item.id;
        const labelText = fitAnnotationLabel(item.label, labelWidth - 14, 7);
        const labelStyle = isCutsite
          ? undefined
          : item.labelType === "features"
            ? { fill: getItemColor(item, "#2b3642") }
            : undefined;
        const hitProps = getHitRegionProps(handlers, item);
        const names = item.annotation?.isoschizomerNames || [getAnnotationLabel(item)];
        const boundary = Number(item.annotation?.topSnipPosition ?? anchor);
        const detail = isCutsite
          ? `${names.join(" / ")}\n${names.length > 1 ? `同一双链切点共 ${names.length} 种酶；` : ""}正链：${boundary === 0 ? "序列起点" : `第 ${boundary} 位后`}\n单击定位，双击查看酶信息`
          : `${item.label} · ${item.sourceStart + 1}–${item.sourceEnd + 1}`;
        return (
          <g
            key={`label-${item.id}-${item.start}-${item.end}`}
            {...hitProps}
            className={`${hitProps.className || ""} genecode-sequence-label-group${isCutsiteHovered ? " genecode-sequence-label-group--hovered" : ""}`}
            aria-label={detail.replaceAll("\n", "；")}
            onMouseEnter={isCutsite ? () => onCutsiteHover?.(item.id) : undefined}
            onMouseLeave={isCutsite ? () => onCutsiteHover?.(null) : undefined}
            onFocus={isCutsite ? () => onCutsiteHover?.(item.id) : undefined}
            onBlur={isCutsite ? () => onCutsiteHover?.(null) : undefined}
          >
            <title>{detail}</title>
              <rect
                className="genecode-sequence-cutsite-label-badge"
                x={labelLeft}
                y={y - 1}
                width={labelWidth}
                height="16"
                rx="2"
              />
            <text
              x={labelX}
              y={labelY}
              textAnchor="middle"
              className={`genecode-sequence-label-text genecode-sequence-label-${item.labelType || "other"} ${cutsiteClass}${isCutsiteHovered ? " genecode-sequence-label-cutsites-hovered" : ""}`}
              style={labelStyle}
            >
              {labelText}
            </text>
          </g>
        );
      })}
      {(track.hiddenCount > 0 || track.expanded) && (
        <g className="genecode-sequence-overflow-control" role="button" tabIndex={0}
          aria-label={track.expanded ? "收起本行标记" : `展开本行其余 ${track.hiddenCount} 个标记`}
          aria-expanded={track.expanded}
          onPointerDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); onToggleLabels?.(); }}
          onKeyDown={event => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault(); event.stopPropagation(); onToggleLabels?.();
            }
          }}
        >
          <rect x={layout.leftGutter} y={track.y + track.height - 24} width={overflowWidth} height="23" rx="4" />
          <text x={layout.leftGutter + 8} y={track.y + track.height - 8} className="genecode-sequence-overflow-label">
            {fitAnnotationLabel(track.expanded ? "收起本行标记 ↑" : `另有 ${track.hiddenCount} 个标记 · 展开 ↓`, overflowWidth - 16, 6)}
          </text>
        </g>
      )}
    </g>
  );
}

function getAminoAcidEntries(item, row) {
  const annotation = item.annotation || {};
  const aminoAcids = Array.isArray(annotation.aminoAcids) ? annotation.aminoAcids : [];
  const entries = aminoAcids.filter(sliver => {
    const position = Number(sliver.sequenceIndex);
    return Number.isFinite(position) && position >= row.start && position <= row.end;
  });
  const centered = entries.filter(sliver => sliver.positionInCodon === 1);
  return (centered.length ? centered : entries.filter((_, index) => index % 3 === 1)).map(sliver => ({
    ...sliver,
    value: sliver.aminoAcid?.value || sliver.value || "?"
  }));
}

function renderTranslations(track, layout, row) {
  if (!track) return null;
  return track.items.flatMap(item => {
    const entries = getAminoAcidEntries(item, row);
    return entries.map((sliver, index) => {
      const position = Number(sliver.sequenceIndex);
      const x = getBaseX(layout, row, position) + layout.charWidth / 2;
      const y = track.y + item.lane * track.laneHeight + track.laneHeight - 5;
      const aaIndex = Number(sliver.aminoAcidIndex);
      return (
        <g key={`aa-${item.id}-${position}-${index}`}>
          <text x={x} y={y} textAnchor="middle" className="genecode-sequence-amino-acid">
            {sliver.value}
          </text>
          {Number.isFinite(aaIndex) && (aaIndex + 1) % 5 === 0 && (
            <text x={x} y={track.y + item.lane * track.laneHeight + 8} textAnchor="middle" className="genecode-sequence-amino-acid-index">
              {aaIndex + 1}
            </text>
          )}
        </g>
      );
    });
  });
}

function renderCutsites(row, layout, cutsiteItems, sequenceForwardTrack, sequenceReverseTrack, interactionProps, sequenceLength, hoveredCutsiteId, onCutsiteHover) {
  if ((!sequenceForwardTrack && !sequenceReverseTrack) || !cutsiteItems.length) return null;
  // The engine emits one cutsite per enzyme. Draw one marker per pair of
  // strand boundaries; distinct bottom cuts must not be silently merged.
  const seenPositions = new Set();
  const uniqueItems = cutsiteItems.filter(item => {
    const key = getCutsiteGroupKey(item, row);
    if (seenPositions.has(key)) return false;
    seenPositions.add(key);
    return true;
  });
  return uniqueItems.map(item => {
    const topPosition = getCutsitePosition(item, row);
    const bottomPosition = getCutsiteBottomPosition(item, row);
    const isHovered = hoveredCutsiteId === item.id;
    const handlers = getInteractionHandlers(item, "cutsites", interactionProps);
    const hitProps = getHitRegionProps(handlers, item);
    const marker = (position, track, strand) => {
      if (position === null || position === undefined || !track) return null;
      // `position` is a boundary coordinate: x=leftGutter + position*charWidth
      // puts the stroke exactly between the two adjacent base glyphs.
      const x = getBaseX(layout, row, position);
      return (
        <line
          key={`${strand}-${position}`}
          className={`genecode-sequence-cutsite-marker genecode-sequence-cutsite-marker--${strand}`}
          data-cut-position={position}
          data-cut-strand={strand}
          x1={x}
          x2={x}
          y1={track.y - 3}
          y2={track.y + track.height + 3}
          stroke={isHovered ? getItemColor(item, "#d46a6a") : "#6d7882"}
          strokeWidth={isHovered ? "1.8" : "1"}
          strokeOpacity={isHovered ? "0.92" : "0.72"}
          vectorEffect="non-scaling-stroke"
        />
      );
    };
    const recognitionOverlaps = getRecognitionSiteOverlaps(item, row, sequenceLength);
    const firstTrack = sequenceForwardTrack || sequenceReverseTrack;
    const lastTrack = sequenceReverseTrack || sequenceForwardTrack;
    const hoverTop = firstTrack ? firstTrack.y - 5 : 0;
    const hoverBottom = lastTrack ? lastTrack.y + lastTrack.height + 5 : hoverTop + layout.charWidth;
    return (
      <g
        key={`cutsite-${item.id}-${topPosition}-${bottomPosition}`}
        {...hitProps}
        className={`${hitProps.className || ""} genecode-sequence-cutsite-visual${isHovered ? " genecode-sequence-cutsite-visual--hovered" : ""}`}
        aria-label={`${getAnnotationLabel(item)} 切点，正链第 ${topPosition} 位后`}
        onMouseEnter={() => onCutsiteHover?.(item.id)}
        onMouseLeave={() => onCutsiteHover?.(null)}
        onFocus={() => onCutsiteHover?.(item.id)}
        onBlur={() => onCutsiteHover?.(null)}
      >
        {recognitionOverlaps.map((range, index) => (
          <rect
            key={`cutsite-hover-target-${item.id}-${index}`}
            className="genecode-sequence-cutsite-hover-target"
            x={getBaseX(layout, row, range.start)}
            y={hoverTop}
            width={Math.max(layout.charWidth, (range.end - range.start + 1) * layout.charWidth)}
            height={Math.max(layout.charWidth, hoverBottom - hoverTop)}
            fill="transparent"
            pointerEvents="all"
          />
        ))}
        {marker(topPosition, sequenceForwardTrack, "top")}
        {(isHovered || topPosition === null) && marker(bottomPosition, sequenceReverseTrack, "bottom")}
      </g>
    );
  });
}

function renderSelectionAndCaret(row, layout, props) {
  const sequenceTrack = getTrack(layout, "sequence-forward");
  const reverseTrack = getTrack(layout, "sequence-reverse");
  const selectionRects = layout.selectionRanges.flatMap(range => {
    const x = getBaseX(layout, row, range.start);
    const width = (range.end - range.start + 1) * layout.charWidth;
    return [sequenceTrack, reverseTrack].filter(Boolean).map(track => (
      <rect
        key={`selection-${track.id}-${range.start}-${range.end}`}
        className="genecode-sequence-selection-hit-region"
        x={x}
        y={track.y}
        width={width}
        height={track.height}
        fill="#3d84c6"
        fillOpacity="0.22"
        pointerEvents="all"
        onContextMenu={event => props.selectionLayerRightClicked?.({
          event,
          annotation: props.selectionLayer
        })}
      />
    ));
  });
  const caretPosition = Number(props.caretPosition);
  const rowEndInsertion = row.end + 1;
  const caretTrack = sequenceTrack || reverseTrack;
  const caret = caretTrack && Number.isFinite(caretPosition) && caretPosition >= row.start && caretPosition <= rowEndInsertion
    ? (
        <line
          key="caret"
          x1={getBaseX(layout, row, caretPosition)}
          x2={getBaseX(layout, row, caretPosition)}
          y1={caretTrack.y - 2}
          y2={caretTrack.y + caretTrack.height + 2}
          stroke="#1467a8"
          strokeWidth="2"
          pointerEvents="none"
        />
      )
    : null;
  return [...selectionRects, caret];
}

function SequenceRow({ row, layout, sequenceData, sequenceLength, ...interactionProps }) {
  const rowId = useId();
  const [hoveredCutsiteId, setHoveredCutsiteId] = useState(null);
  const emitPosition = (event, nearestCaretPosOverride) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const nearestCaretPos = nearestCaretPosOverride ?? getNearestCaretPosition({
      clientX: event.clientX,
      rectLeft: rect.left,
      rowStart: row.start,
      rowEnd: row.end,
      leftGutter: layout.leftGutter,
      charWidth: layout.charWidth,
      sequenceLength
    });
    const payload = {
      event,
      nearestCaretPos,
      shiftHeld: event.shiftKey,
      sequenceLength,
      selectionLayer: interactionProps.selectionLayer,
      caretPosition: interactionProps.caretPosition
    };
    return payload;
  };

  const onClick = event => interactionProps.editorClicked?.(emitPosition(event));
  const onPointerDown = event => {
    if (event.button !== 0) return;
    const payload = emitPosition(event);
    editorDragStarted(payload);
    interactionProps.onSequenceDragStart?.(event);
  };
  const onPointerMove = event => {
    if (!(event.buttons & 1)) return;
    const node = event.currentTarget;
    // Lazy capture: only claim the pointer once a drag is actually under way.
    // Capturing on pointerdown would redirect the browser's compatible click
    // event to this <svg>, silently swallowing every annotation onClick
    // (feature/cutsite/primer/label selection) for plain clicks.
    if (!node.hasPointerCapture?.(event.pointerId)) {
      node.setPointerCapture?.(event.pointerId);
    }
    const nearestCaretPos = interactionProps.resolveNearestPositionAtPoint?.(event);
    editorDragged({
      ...emitPosition(event, nearestCaretPos),
      doNotWrapOrigin: !sequenceData.circular,
      caretPositionUpdate: interactionProps.caretPositionUpdate,
      selectionLayerUpdate: interactionProps.selectionLayerUpdate,
      selectionLayer: interactionProps.selectionLayer,
      caretPosition: interactionProps.caretPosition
    });
    interactionProps.onSequenceDragMove?.(event);
  };
  const onPointerUp = event => {
    const node = event.currentTarget;
    if (node.hasPointerCapture?.(event.pointerId)) {
      node.releasePointerCapture?.(event.pointerId);
    }
    editorDragStopped();
    interactionProps.onSequenceDragStop?.();
  };
  const onPointerCancel = () => {
    editorDragStopped();
    interactionProps.onSequenceDragStop?.();
  };
  const onContextMenu = event => {
    const payload = emitPosition(event);
    if (
      interactionProps.selectionLayerRightClicked &&
      isCaretWithinSelection({
        caretPosition: payload.nearestCaretPos,
        selectionLayer: interactionProps.selectionLayer,
        sequenceLength
      })
    ) {
      interactionProps.selectionLayerRightClicked({
        event,
        annotation: interactionProps.selectionLayer
      });
      return;
    }
    interactionProps.backgroundRightClicked?.(payload);
  };
  const featureForwardTrack = getTrack(layout, "features-forward");
  const featureReverseTrack = getTrack(layout, "features-reverse");
  const primerForwardTrack = getTrack(layout, "primers-forward");
  const primerReverseTrack = getTrack(layout, "primers-reverse");
  const translationTrack = getTrack(layout, "translations");
  const sequenceForwardTrack = getTrack(layout, "sequence-forward");
  const sequenceReverseTrack = getTrack(layout, "sequence-reverse");
  const sequenceBandX = Math.max(0, layout.leftGutter - 4);
  const sequenceBandWidth = layout.rowLength * layout.charWidth + 8;

  return (
    <svg
      className="genecode-sequence-row"
      data-row-number={row.rowNumber}
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="group"
      aria-label={`Sequence bases ${row.start + 1} to ${row.end + 1}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDragStart={event => event.preventDefault()}
      style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
      display="block"
    >
      <rect x="0" y="0" width={layout.width} height={layout.height} fill="#ffffff" />
      {sequenceForwardTrack && (
        <rect
          className="genecode-sequence-forward-band"
          x={sequenceBandX}
          y={sequenceForwardTrack.y - 1}
          width={sequenceBandWidth}
          height={sequenceForwardTrack.height + 2}
          pointerEvents="none"
        />
      )}
      {sequenceReverseTrack && (
        <rect
          className="genecode-sequence-reverse-band"
          x={sequenceBandX}
          y={sequenceReverseTrack.y - 1}
          width={sequenceBandWidth}
          height={sequenceReverseTrack.height + 2}
          pointerEvents="none"
        />
      )}
      {sequenceForwardTrack && sequenceReverseTrack && (
        <line
          className="genecode-sequence-strand-divider"
          x1={sequenceBandX}
          x2={sequenceBandX + sequenceBandWidth}
          y1={sequenceReverseTrack.y - 1}
          y2={sequenceReverseTrack.y - 1}
          pointerEvents="none"
        />
      )}
      {layout.cutsiteItems.map(item => renderCutsiteRecognition(
        item,
        row,
        layout,
        sequenceForwardTrack,
        sequenceReverseTrack,
        sequenceLength,
        hoveredCutsiteId === item.id
      ))}
      <text x="8" y={(sequenceForwardTrack?.y || layout.rowPaddingTop) + 14} className="genecode-sequence-prime-label">5&apos;</text>
      <text x={layout.leftGutter + layout.rowLength * layout.charWidth + 12} y={(sequenceForwardTrack?.y || layout.rowPaddingTop) + 14} className="genecode-sequence-prime-label">3&apos;</text>
      {renderLabels(getTrack(layout, "labels"), layout, row, interactionProps, hoveredCutsiteId, setHoveredCutsiteId, interactionProps.onToggleLabels)}
      {featureForwardTrack?.items.map(item => renderArrow(item, layout, featureForwardTrack, "#7da7c9", interactionProps, rowId))}
      {primerForwardTrack?.items.map(item => renderPrimer(item, layout, primerForwardTrack, interactionProps))}
      {renderBases(row, layout, "forward", sequenceData)}
      {renderRuler(row, layout, sequenceLength)}
      <text x="8" y={(getTrack(layout, "sequence-reverse")?.y || 0) + 14} className="genecode-sequence-prime-label">3&apos;</text>
      <text x={layout.leftGutter + layout.rowLength * layout.charWidth + 12} y={(getTrack(layout, "sequence-reverse")?.y || 0) + 14} className="genecode-sequence-prime-label">5&apos;</text>
      {renderBases(row, layout, "reverse", sequenceData)}
      {renderTranslations(translationTrack, layout, row)}
      {primerReverseTrack?.items.map(item => renderPrimer(item, layout, primerReverseTrack, interactionProps))}
      {featureReverseTrack?.items.map(item => renderArrow(item, layout, featureReverseTrack, "#9db7c9", interactionProps, rowId))}
      {renderCutsites(row, layout, layout.cutsiteItems, sequenceForwardTrack, sequenceReverseTrack, interactionProps, sequenceLength, hoveredCutsiteId, setHoveredCutsiteId)}
      {renderSelectionAndCaret(row, layout, interactionProps)}
    </svg>
  );
}

function SequencePanelView(props) {
  const [expandedLabelRows, setExpandedLabelRows] = useState(new Set());
  const sequenceData = props.sequenceData || EMPTY_SEQUENCE_DATA;
  const width = Number(props.dimensions?.width || props.width || 960);
  const height = Number(props.dimensions?.height || props.height || 480);
  const suppliedCharWidth = Number(props.charWidth);
  const charWidth = Math.max(
    DEFAULT_LAYOUT_OPTIONS.charWidth,
    Number.isFinite(suppliedCharWidth) ? suppliedCharWidth : DEFAULT_LAYOUT_OPTIONS.charWidth
  );
  const sequenceLength = sequenceData.noSequence
    ? Number(sequenceData.size || 0)
    : String(sequenceData.sequence || "").length;
  const stableBpsPerRow = getStableBpsPerRow({
    width: width - DEFAULT_LAYOUT_OPTIONS.leftGutter - DEFAULT_LAYOUT_OPTIONS.rightGutter,
    charWidth,
    isProtein: sequenceData.isProtein
  });
  const suppliedBpsPerRow = Number(props.bpsPerRow);
  const bpsPerRow = Number.isFinite(suppliedBpsPerRow) && suppliedBpsPerRow > 0
    ? Math.min(suppliedBpsPerRow, stableBpsPerRow)
    : stableBpsPerRow;
  const rowData = useMemo(() => prepareRowData({
    ...sequenceData,
    sequence: sequenceData.sequence || "",
    features: sequenceData.filteredFeatures || sequenceData.features || [],
    parts: sequenceData.filteredParts || sequenceData.parts || [],
    primers: sequenceData.filteredPrimers || sequenceData.primers || [],
    translations: sequenceData.translations || [],
    cutsites: sequenceData.cutsites || []
  }, Math.max(1, bpsPerRow)), [sequenceData, bpsPerRow]);
  const layoutProps = useMemo(() => ({
    charWidth,
    sequenceLength,
    sequenceData,
    annotationVisibility: props.annotationVisibility || {},
    annotationLabelVisibility: props.annotationLabelVisibility || {},
    preferredEnzymeNames: props.enzymeGroupsOverride?.["Common cloning"] || [],
    selectionLayer: props.selectionLayer,
    caretPosition: props.caretPosition,
    layoutOptions: {
      ...DEFAULT_LAYOUT_OPTIONS,
      charWidth
    }
  }), [
    charWidth,
    sequenceLength,
    sequenceData,
    props.annotationVisibility,
    props.annotationLabelVisibility,
    props.enzymeGroupsOverride,
    props.selectionLayer,
    props.caretPosition
  ]);
  const layouts = useMemo(() => rowData.map(row => buildRowLayout(row, {
    ...layoutProps, labelsExpanded: expandedLabelRows.has(row.rowNumber)
  })), [rowData, layoutProps, expandedLabelRows]);
  const offsets = useMemo(() => buildRowOffsets(layouts), [layouts]);
  const totalHeight = offsets[offsets.length - 1] || 0;
  const scrollRef = useRef(null);
  const initialFocusKeyRef = useRef(null);
  const previousFocusKeyRef = useRef(null);
  const previousFocusInputsRef = useRef(null);
  const dragStateRef = useRef({
    active: false,
    pointerId: null,
    latestPointer: null,
    frameId: null
  });
  const dragContextRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(height);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return undefined;
    const updateHeight = () => setViewportHeight(node.clientHeight || height);
    updateHeight();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);
    return () => observer.disconnect();
  }, [height]);

  const focusPosition = getFocusPosition({
    caretPosition: props.caretPosition,
    selectionLayer: props.selectionLayer,
    previousCaretPosition: previousFocusInputsRef.current?.caretPosition,
    previousSelectionLayer: previousFocusInputsRef.current?.selectionLayer
  });
  const focusKey = `${props.caretPosition ?? -1}:${props.selectionLayer?.start ?? -1}:${props.selectionLayer?.end ?? -1}`;

  // The hosting ReflexElement starts panels with placeholder dimensions
  // ({height:"100%", width:"100%"}) and only publishes real pixel values once
  // react-measure fires — typically one frame after mount. Until then
  // width/height are NaN (Number("100%")), bpsPerRow collapses to 1 (one base
  // per row) and a scroll computed here would fling the panel to the very
  // bottom — and, worse, consume the initial focus key so the later,
  // correctly-geometried render would never scroll to the selection (audit
  // P5: Map selection → switch to Sequence lands at the top, not the
  // selection). Bail out entirely (without touching any focus refs) until the
  // panel is measurable.
  const layoutReady =
    Number.isFinite(width) &&
    width > 0 &&
    Number.isFinite(height) &&
    height > 0 &&
    Number.isFinite(bpsPerRow) &&
    bpsPerRow >= 1;

  useEffect(() => {
    if (!layoutReady) return;
    if (initialFocusKeyRef.current === null) {
      initialFocusKeyRef.current = focusKey;
      previousFocusKeyRef.current = focusKey;
      previousFocusInputsRef.current = {
        caretPosition: props.caretPosition,
        selectionLayer: props.selectionLayer || {}
      };
    } else {
      if (focusKey === previousFocusKeyRef.current) return;
      previousFocusKeyRef.current = focusKey;
      previousFocusInputsRef.current = {
        caretPosition: props.caretPosition,
        selectionLayer: props.selectionLayer || {}
      };
    }
    if (focusPosition < 0) return;
    const targetRow = getRowIndexForPosition(focusPosition, bpsPerRow, rowData.length);
    const node = scrollRef.current;
    if (!node || targetRow < 0) return;
    const targetTop = offsets[targetRow] || 0;
    const targetBottom = offsets[targetRow + 1] || targetTop;
    const viewportTop = node.scrollTop;
    const viewportBottom = viewportTop + (node.clientHeight || height);
    if (targetTop < viewportTop) {
      node.scrollTop = targetTop;
    } else if (targetBottom > viewportBottom) {
      node.scrollTop = Math.max(0, targetBottom - (node.clientHeight || height));
    }
    // Note: `width` is intentionally not a dependency — it feeds only
    // `stableBpsPerRow`/`bpsPerRow` and `layoutReady`, which are listed, and
    // a width change within the same bpsPerRow bucket does not alter offsets
    // (width only affects contentWidth). Keep it out to avoid pointless runs.
  }, [bpsPerRow, focusKey, focusPosition, height, layoutReady, offsets, rowData.length]);

  const visible = getVisibleRowRange(offsets, scrollTop, viewportHeight, 3);
  const visibleRows = visible.end >= visible.start
    ? rowData.slice(visible.start, visible.end + 1)
    : [];
  const contentWidth = layouts.reduce((max, layout) => Math.max(max, layout.width), 0) || width;

  const resolveNearestPositionAtPoint = event => {
    const node = scrollRef.current;
    if (!node || !rowData.length) return undefined;
    const containerRect = node.getBoundingClientRect();
    const totalHeight = offsets[offsets.length - 1] || 0;
    const contentY = Math.min(
      Math.max(0, node.scrollTop + Number(event.clientY) - containerRect.top),
      Math.max(0, totalHeight - Number.EPSILON)
    );
    const rowIndex = getRowIndexForContentOffset(offsets, contentY);
    const targetRow = rowData[rowIndex];
    const targetLayout = layouts[rowIndex];
    if (!targetRow || !targetLayout) return undefined;
    return getNearestCaretPosition({
      clientX: event.clientX,
      rectLeft: containerRect.left - node.scrollLeft,
      rowStart: targetRow.start,
      rowEnd: targetRow.end,
      leftGutter: targetLayout.leftGutter,
      charWidth: targetLayout.charWidth,
      sequenceLength
    });
  };

  const requestAutoScrollFrame = callback => {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      return null;
    }
    return window.requestAnimationFrame(callback);
  };
  const cancelAutoScrollFrame = () => {
    const frameId = dragStateRef.current.frameId;
    if (frameId === null || typeof window === "undefined") return;
    window.cancelAnimationFrame?.(frameId);
    dragStateRef.current.frameId = null;
  };
  const snapshotPointer = event => ({
    clientX: Number(event.clientX),
    clientY: Number(event.clientY),
    shiftKey: Boolean(event.shiftKey),
    pointerId: event.pointerId,
    type: event.type
  });
  const startDragTracking = event => {
    const state = dragStateRef.current;
    state.active = true;
    state.pointerId = event.pointerId;
    state.latestPointer = snapshotPointer(event);
  };
  const stopDragTracking = () => {
    const state = dragStateRef.current;
    state.active = false;
    state.pointerId = null;
    state.latestPointer = null;
    cancelAutoScrollFrame();
  };

  const runAutoScrollFrame = () => {
    const state = dragStateRef.current;
    state.frameId = null;
    if (!state.active || !state.latestPointer) return;
    const node = scrollRef.current;
    const context = dragContextRef.current;
    if (!node || !context) return;
    const rect = node.getBoundingClientRect();
    const delta = getAutoScrollDelta({
      clientY: state.latestPointer.clientY,
      viewportTop: rect.top,
      viewportBottom: rect.bottom,
      edgeThreshold: AUTO_SCROLL_EDGE_THRESHOLD,
      maxSpeed: AUTO_SCROLL_MAX_SPEED
    });
    if (!delta) return;

    const currentTop = node.scrollTop;
    const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
    const nextTop = Math.min(maxScrollTop, Math.max(0, currentTop + delta));
    if (nextTop === currentTop) return;
    node.scrollTop = nextTop;

    const nearestCaretPos = context.resolveNearestPositionAtPoint(state.latestPointer);
    if (Number.isFinite(nearestCaretPos)) {
      editorDragged({
        event: state.latestPointer,
        nearestCaretPos,
        shiftHeld: state.latestPointer.shiftKey,
        sequenceLength: context.sequenceLength,
        selectionLayer: context.selectionLayer,
        caretPosition: context.caretPosition,
        doNotWrapOrigin: !context.circular,
        caretPositionUpdate: context.caretPositionUpdate,
        selectionLayerUpdate: context.selectionLayerUpdate
      });
    }
    state.frameId = requestAutoScrollFrame(runAutoScrollFrame);
  };
  const scheduleAutoScroll = event => {
    const state = dragStateRef.current;
    if (!state.active) return;
    state.latestPointer = snapshotPointer(event);
    if (state.frameId !== null) return;
    const node = scrollRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const delta = getAutoScrollDelta({
      clientY: state.latestPointer.clientY,
      viewportTop: rect.top,
      viewportBottom: rect.bottom,
      edgeThreshold: AUTO_SCROLL_EDGE_THRESHOLD,
      maxSpeed: AUTO_SCROLL_MAX_SPEED
    });
    if (delta) state.frameId = requestAutoScrollFrame(runAutoScrollFrame);
  };

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const matchesPointer = event => {
      const state = dragStateRef.current;
      return state.active && (state.pointerId === null || state.pointerId === event.pointerId);
    };
    const onWindowPointerMove = event => {
      if (matchesPointer(event)) scheduleAutoScroll(event);
    };
    const onWindowPointerUp = event => {
      if (!matchesPointer(event)) return;
      editorDragStopped();
      stopDragTracking();
    };
    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerUp);
    return () => {
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerUp);
      window.removeEventListener("pointercancel", onWindowPointerUp);
      if (dragStateRef.current.active) editorDragStopped();
      stopDragTracking();
    };
  }, []);

  dragContextRef.current = {
    sequenceLength,
    circular: sequenceData.circular,
    selectionLayer: props.selectionLayer,
    caretPosition: props.caretPosition,
    caretPositionUpdate: props.caretPositionUpdate,
    selectionLayerUpdate: props.selectionLayerUpdate,
    resolveNearestPositionAtPoint
  };

  return (
    <div
      className="genecode-sequence-panel"
      data-layout-version={SEQUENCE_PANEL_LAYOUT_VERSION}
      data-rendered-row-count={visibleRows.length}
      data-total-row-count={rowData.length}
      style={{ width: "100%", height: height || 400, overflow: "hidden", background: "#ffffff" }}
    >
      <div
        ref={scrollRef}
        className="genecode-sequence-scroll"
        style={{ width: "100%", height: "100%", overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
        onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div style={{ position: "relative", width: contentWidth, height: totalHeight }}>
          <div style={{ position: "absolute", top: offsets[visible.start] || 0, left: 0, width: contentWidth }}>
            {visibleRows.map((row, index) => {
              const rowIndex = visible.start + index;
              return (
                <SequenceRow
                  key={`${row.rowNumber}-${layouts[rowIndex].layoutVersion}`}
                  row={row}
                  layout={layouts[rowIndex]}
                  sequenceData={sequenceData}
                  sequenceLength={sequenceLength}
                  {...props}
                  onToggleLabels={() => setExpandedLabelRows(current => {
                    const next = new Set(current);
                    if (next.has(row.rowNumber)) next.delete(row.rowNumber);
                    else next.add(row.rowNumber);
                    return next;
                  })}
                  resolveNearestPositionAtPoint={resolveNearestPositionAtPoint}
                  onSequenceDragStart={startDragTracking}
                  onSequenceDragMove={scheduleAutoScroll}
                  onSequenceDragStop={stopDragTracking}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export { SequencePanelView as SequencePanelUnconnected };
export const SequencePanel = withEditorInteractions(SequencePanelView);
export default SequencePanel;
