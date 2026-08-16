import { getOverlapsOfPotentiallyCircularRanges } from "@teselagen/range-utils";

export const SEQUENCE_PANEL_LAYOUT_VERSION = "p0.2";

export const DEFAULT_LAYOUT_OPTIONS = Object.freeze({
  charWidth: 11,
  leftGutter: 42,
  rightGutter: 44,
  rowPaddingTop: 8,
  rowPaddingBottom: 16,
  labelLaneHeight: 22,
  featureLaneHeight: 18,
  primerLaneHeight: 18,
  sequenceHeight: 20,
  axisHeight: 18,
  translationHeight: 20,
  laneGap: 4,
  maxLabelLanes: 4,
  maxLabelsPerRow: 24
});

// Sequence labels are rendered with a 10px monospace font while bases use
// `charWidth` (normally 11px).  A lane must reserve the label's visual width,
// not only the annotated recognition range; otherwise nearby but distinct
// enzymes (for example `SacI +1` and `EcoRI +1`) still collide horizontally.
const LABEL_GLYPH_WIDTH_PX = 6.1;
const LABEL_HORIZONTAL_PADDING_PX = 4;

const FEATURE_TYPES = [
  "parts",
  "features",
  "warnings",
  "assemblyPieces",
  "lineageAnnotations"
];

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function getItemAnnotation(item) {
  return item && item.annotation ? item.annotation : item || {};
}

export function getAnnotationLabel(item, fallback = "Untitled") {
  const annotation = getItemAnnotation(item);
  return (
    annotation.name ||
    annotation.label ||
    annotation.type ||
    item?.id ||
    fallback
  );
}

/**
 * Resolve the absolute cut position for a cutsite item within a row.
 *
 * `topSnipPosition` is an absolute boundary coordinate in this engine (see
 * RowItem/Cutsites.js and CircularView/positionCutsites.js): position N is the
 * cut between bases N-1 and N, not the centre of base N. A row therefore owns
 * the insertion interval [row.start, row.end + 1]. If a recognition site
 * overlaps a row but its cut is in a different row, return null instead of
 * painting a false marker at the clipped recognition start.
 */
export function getCutsitePosition(item, row) {
  const annotation = item.annotation || {};
  const candidate = Number(annotation.topSnipPosition);
  if (Number.isFinite(candidate)) {
    return candidate >= row.start && candidate <= row.end + 1 ? candidate : null;
  }
  const fallback = Number(item.start);
  return Number.isFinite(fallback) && fallback >= row.start && fallback <= row.end
    ? fallback
    : null;
}

/** Resolve the bottom-strand cut boundary for the current row. */
export function getCutsiteBottomPosition(item, row) {
  const topPosition = getCutsitePosition(item, row);
  const annotation = item.annotation || {};
  const candidate = Number(annotation.bottomSnipPosition);
  if (Number.isFinite(candidate)) {
    return candidate >= row.start && candidate <= row.end + 1 ? candidate : null;
  }
  return topPosition;
}

export function getRowLength(row) {
  if (!row) return 0;
  const start = isFiniteNumber(row.start) ? row.start : 0;
  const end = isFiniteNumber(row.end) ? row.end : start - 1;
  return Math.max(0, Math.floor(end - start + 1));
}

function getSourceRange(item) {
  const annotation = getItemAnnotation(item);
  const start = isFiniteNumber(item?.start) ? item.start : annotation.start;
  const end = isFiniteNumber(item?.end) ? item.end : annotation.end;
  if (!isFiniteNumber(start) || !isFiniteNumber(end)) return null;
  return { start: Math.floor(start), end: Math.floor(end) };
}

/**
 * OVE stores zero-based inclusive ranges. This function keeps that contract
 * inside the renderer and clips already row-mapped ranges without mutation.
 */
export function getRowOverlaps(item, row, sequenceLength) {
  const sourceRange = getSourceRange(item);
  if (!sourceRange || !row || sequenceLength <= 0) return [];

  const rowRange = {
    start: Math.floor(row.start),
    end: Math.floor(row.end)
  };
  const overlaps = getOverlapsOfPotentiallyCircularRanges(
    sourceRange,
    rowRange,
    sequenceLength
  );
  return overlaps.filter(
    overlap => overlap.end >= overlap.start && overlap.end >= rowRange.start && overlap.start <= rowRange.end
  );
}

/**
 * Return the visible portions of a restriction enzyme's recognition sequence.
 *
 * The engine keeps the recognition range separately from the cut span because
 * Type IIS and other enzymes can cut outside the motif.  The sequence view
 * should shade the recognition motif, not just draw the two cut boundaries.
 * Reversed ranges are meaningful for origin-spanning circular sites and are
 * deliberately passed through the range utility unchanged.
 */
export function getRecognitionSiteOverlaps(item, row, sequenceLength) {
  const annotation = getItemAnnotation(item);
  const recognition = annotation.recognitionSiteRange || item?.recognitionSiteRange;
  const sourceRange = recognition && isFiniteNumber(recognition.start) && isFiniteNumber(recognition.end)
    ? { start: Math.floor(recognition.start), end: Math.floor(recognition.end) }
    : getSourceRange(item);
  if (!sourceRange || !row || sequenceLength <= 0) return [];
  const rowRange = {
    start: Math.floor(row.start),
    end: Math.floor(row.end)
  };
  return getOverlapsOfPotentiallyCircularRanges(sourceRange, rowRange, sequenceLength)
    .filter(
      overlap =>
        overlap.end >= overlap.start &&
        overlap.end >= rowRange.start &&
        overlap.start <= rowRange.end
    );
}

function normalizeItems(items, row, sequenceLength, type) {
  return asArray(items).flatMap(item => {
    const annotation = getItemAnnotation(item);
    return getRowOverlaps(item, row, sequenceLength).map(range => ({
      ...item,
      annotation,
      annotationType: item?.annotationType || annotation.annotationType || type,
      start: range.start,
      end: range.end,
      sourceStart: isFiniteNumber(annotation.start) ? annotation.start : range.start,
      sourceEnd: isFiniteNumber(annotation.end) ? annotation.end : range.end,
      label: getAnnotationLabel(item)
    }));
  });
}

function sortItems(items) {
  return [...items].sort((left, right) => {
    const byStart = left.start - right.start;
    if (byStart) return byStart;
    const byEnd = left.end - right.end;
    if (byEnd) return byEnd;
    return String(left.id || left.label).localeCompare(String(right.id || right.label));
  });
}

/**
 * Reuses OVE's yOffset when present, then deterministically fills any gaps.
 * It assigns lanes independently for each track group so rows never overlap.
 */
export function assignLanes(items) {
  const sorted = sortItems(items);
  const laneEnds = [];
  return sorted.map(item => {
    const requestedLane = Number.isInteger(item.yOffset) && item.yOffset >= 0
      ? item.yOffset
      : -1;
    let lane = requestedLane;
    if (lane < 0 || laneEnds[lane] >= item.start) {
      lane = laneEnds.findIndex(lastEnd => lastEnd < item.start);
      if (lane < 0) lane = laneEnds.length;
    }
    laneEnds[lane] = item.end;
    return { ...item, lane };
  });
}

function getVisibility(props) {
  return {
    features: true,
    parts: true,
    warnings: true,
    assemblyPieces: true,
    lineageAnnotations: true,
    primers: true,
    translations: true,
    cutsites: true,
    sequence: true,
    reverseSequence: true,
    axis: true,
    axisNumbers: true,
    ...(props.annotationVisibility || {})
  };
}

function isVisible(type, visibility) {
  return visibility[type] !== false;
}

function isLabelVisible(type, props, visibility) {
  return (
    isVisible(type, visibility) &&
    (props.annotationLabelVisibility?.[type] ?? true) !== false
  );
}

function getLaneCount(items) {
  return items.reduce((count, item) => Math.max(count, item.lane + 1), 0);
}

function addTrack(tracks, track, y, options) {
  const laneCount = track.laneCount || 1;
  const height = track.height || laneCount * track.laneHeight;
  const gap = tracks.length ? options.laneGap : 0;
  const positioned = {
    ...track,
    y: y + gap,
    height,
    laneCount,
    laneHeight: track.laneHeight || height
  };
  tracks.push(positioned);
  return positioned.y + height;
}

function makeLaneTrack(id, items, laneHeight, options, extra = {}) {
  const { preserveLanes = false, ...trackExtra } = extra;
  const laneItems = preserveLanes ? items : assignLanes(items);
  return {
    id,
    kind: extra.kind || id,
    items: laneItems,
    laneHeight,
    laneCount: Math.max(1, getLaneCount(laneItems)),
    ...trackExtra
  };
}

function getLabelAnchor(item, row) {
  return item.labelType === "cutsites"
    ? getCutsitePosition(item, row)
    : item.start;
}

function getLabelExtent(item, row, charWidth) {
  const text = String(item.label || "");
  const widthPx = Math.max(
    LABEL_GLYPH_WIDTH_PX,
    text.length * LABEL_GLYPH_WIDTH_PX + LABEL_HORIZONTAL_PADDING_PX
  );
  const halfSpan = widthPx / Math.max(1, charWidth) / 2;
  const anchor = getLabelAnchor(item, row);
  return { start: anchor - halfSpan, end: anchor + halfSpan };
}

/**
 * Assign lanes using the rendered label footprint.  The old range-only
 * assignment is correct for feature arrows, but cut-site labels are centered
 * on a single cut coordinate and can extend several bases to either side.
 */
export function assignLabelLanes(items, row, options = DEFAULT_LAYOUT_OPTIONS) {
  const sorted = [...items].sort((left, right) => {
    const byAnchor = getLabelAnchor(left, row) - getLabelAnchor(right, row);
    if (byAnchor) return byAnchor;
    const byWidth = String(right.label || "").length - String(left.label || "").length;
    if (byWidth) return byWidth;
    return String(left.id || left.label).localeCompare(String(right.id || right.label));
  });
  const laneEnds = [];
  return sorted.map(item => {
    const extent = getLabelExtent(item, row, options.charWidth);
    const requestedLane = Number.isInteger(item.yOffset) && item.yOffset >= 0
      ? item.yOffset
      : -1;
    let lane = requestedLane;
    if (lane < 0 || laneEnds[lane] >= extent.start) {
      lane = laneEnds.findIndex(lastEnd => lastEnd < extent.start);
      if (lane < 0) lane = laneEnds.length;
    }
    laneEnds[lane] = extent.end;
    return { ...item, lane, labelExtent: extent };
  });
}

// Feature and part names are not painted at the start of every sequence row:
// the colored feature arrows already carry the identity, and SnapGene keeps
// row-leading labels to cut sites and primers. Cutsite (incl. merged
// isoschizomer) and primer labels stay; features/parts can be re-enabled via
// annotationLabelVisibility.
const ROW_START_LABEL_TYPES = ["primers", "cutsites"];

function makeLabelItems(row, sequenceLength, props, visibility, options) {
  const sources = [
    ...ROW_START_LABEL_TYPES.map(type => [type, row[type]])
  ];
  const labels = sources.flatMap(([type, values]) => {
    if (!isLabelVisible(type, props, visibility)) return [];
    return normalizeItems(values, row, sequenceLength, type)
      .map(item => ({
        ...item,
        labelType: type,
        label: getAnnotationLabel(item, type === "cutsites" ? "Cut site" : "Untitled")
      }))
      .filter(item => type !== "cutsites" || getCutsitePosition(item, row) !== null);
  });
  // Collapse cut sites by their resolved cut position: isoschizomers that cut
  // the same spot (up to a dozen enzymes) merge into a single label so the
  // label lane doesn't waste rows on stacked duplicates. SnapGene shows the
  // first enzyme name plus a "+N" count of additional isoschizomers (e.g.
  // "VpaKutJI +4"); we also keep the full enzyme list on the label item so a
  // double-click can open a dialog listing every enzyme at that position.
  const cutsiteByPosition = new Map();
  const deduped = labels.filter(item => {
    if (item.labelType !== "cutsites") return true;
    const position = getCutsitePosition(item, row);
    const group = cutsiteByPosition.get(position);
    if (group) {
      group.items.push(item);
      return false;
    }
    cutsiteByPosition.set(position, { items: [item] });
    return true;
  });
  // The filter pass left the representative item untouched; merge the group's
  // enzyme names into its label text now that every member is known. The
  // enzyme list rides on a fresh annotation object (for flat cutsites the
  // annotation IS the raw item, so mutating it would pollute the source data)
  // and flows to the double-click handler via item.annotation.
  for (const { items } of cutsiteByPosition.values()) {
    const representative = deduped.find(item => item === items[0]);
    if (!representative) continue;
    const enzymeNames = [...new Set(items.map(item => getAnnotationLabel(item)))];
    // Guard on the deduped name list so two same-name cutsites at one
    // position can never render a degenerate "+0" suffix.
    if (enzymeNames.length < 2) continue;
    representative.label = `${enzymeNames[0]} +${enzymeNames.length - 1}`;
    representative.annotation = {
      ...representative.annotation,
      isoschizomerNames: enzymeNames
    };
  }
  const sorted = sortItems(deduped);
  const visible = sorted.slice(0, options.maxLabelsPerRow);
  const laneItems = assignLabelLanes(visible, row, options)
    .filter(item => item.lane < options.maxLabelLanes);
  const hiddenCount = sorted.length - laneItems.length;
  return { items: laneItems, hiddenCount };
}

function makeSelectionRanges(selectionLayer, row, sequenceLength) {
  if (!selectionLayer || selectionLayer.start < 0 || sequenceLength <= 0) return [];
  return getRowOverlapsOfRange(selectionLayer, row, sequenceLength);
}

function getRowOverlapsOfRange(range, row, sequenceLength) {
  return getOverlapsOfPotentiallyCircularRanges(
    { start: range.start, end: range.end },
    { start: row.start, end: row.end },
    sequenceLength
  );
}

export function buildRowLayout(row, props = {}) {
  const options = { ...DEFAULT_LAYOUT_OPTIONS, ...(props.layoutOptions || {}) };
  const rawSequenceLength =
    props.sequenceLength ??
    props.sequenceData?.sequence?.length ??
    (row?.end ?? -1) + 1;
  const sequenceLength = Math.max(0, Number(rawSequenceLength) || 0);
  const rowLength = getRowLength(row);
  const visibility = getVisibility(props);
  const annotationVisibility = props.annotationVisibility || visibility;
  const tracks = [];
  let y = options.rowPaddingTop;

  const featureItems = FEATURE_TYPES.flatMap(type => {
    if (!isVisible(type, annotationVisibility)) return [];
    return normalizeItems(row?.[type], row, sequenceLength, type).map(item => ({
      ...item,
      featureType: type
    }));
  });
  const forwardFeatures = featureItems.filter(item => item.annotation.forward !== false);
  const reverseFeatures = featureItems.filter(item => item.annotation.forward === false);
  const primerItems = isVisible("primers", annotationVisibility)
    ? normalizeItems(row?.primers, row, sequenceLength, "primers")
    : [];
  const forwardPrimers = primerItems.filter(item => item.annotation.forward !== false);
  const reversePrimers = primerItems.filter(item => item.annotation.forward === false);
  const translationItems = isVisible("translations", annotationVisibility)
    ? normalizeItems(
        [
          ...asArray(row?.translations),
          ...asArray(row?.primaryProteinSequence)
        ],
        row,
        sequenceLength,
        "translations"
      )
    : [];
  const cutsiteItems = isVisible("cutsites", annotationVisibility)
    ? normalizeItems(row?.cutsites, row, sequenceLength, "cutsites")
        .filter(item => getCutsitePosition(item, row) !== null)
    : [];
  const labels = makeLabelItems(row, sequenceLength, props, annotationVisibility, options);

  if (labels.items.length || labels.hiddenCount) {
    y = addTrack(
      tracks,
      makeLaneTrack("labels", labels.items, options.labelLaneHeight, options, {
        kind: "labels",
        hiddenCount: labels.hiddenCount,
        preserveLanes: true
      }),
      y,
      options
    );
  }
  if (forwardFeatures.length) {
    y = addTrack(
      tracks,
      makeLaneTrack("features-forward", forwardFeatures, options.featureLaneHeight, options, {
        kind: "features",
        direction: "forward"
      }),
      y,
      options
    );
  }
  if (forwardPrimers.length) {
    y = addTrack(
      tracks,
      makeLaneTrack("primers-forward", forwardPrimers, options.primerLaneHeight, options, {
        kind: "primers",
        direction: "forward"
      }),
      y,
      options
    );
  }
  if (isVisible("sequence", annotationVisibility)) {
    y = addTrack(
      tracks,
      {
        id: "sequence-forward",
        kind: "sequence",
        direction: "forward",
        height: options.sequenceHeight,
        laneCount: 1,
        laneHeight: options.sequenceHeight,
        items: []
      },
      y,
      options
    );
  }
  if (isVisible("axis", annotationVisibility)) {
    y = addTrack(
      tracks,
      {
        id: "axis",
        kind: "axis",
        height: options.axisHeight,
        laneCount: 1,
        laneHeight: options.axisHeight,
        items: []
      },
      y,
      options
    );
  }
  if (isVisible("reverseSequence", annotationVisibility)) {
    y = addTrack(
      tracks,
      {
        id: "sequence-reverse",
        kind: "sequence",
        direction: "reverse",
        height: options.sequenceHeight,
        laneCount: 1,
        laneHeight: options.sequenceHeight,
        items: []
      },
      y,
      options
    );
  }
  if (translationItems.length) {
    y = addTrack(
      tracks,
      makeLaneTrack("translations", translationItems, options.translationHeight, options, {
        kind: "translations"
      }),
      y,
      options
    );
  }
  if (reversePrimers.length) {
    y = addTrack(
      tracks,
      makeLaneTrack("primers-reverse", reversePrimers, options.primerLaneHeight, options, {
        kind: "primers",
        direction: "reverse"
      }),
      y,
      options
    );
  }
  if (reverseFeatures.length) {
    y = addTrack(
      tracks,
      makeLaneTrack("features-reverse", reverseFeatures, options.featureLaneHeight, options, {
        kind: "features",
        direction: "reverse"
      }),
      y,
      options
    );
  }

  const height = Math.max(
    options.rowPaddingTop + options.rowPaddingBottom + options.sequenceHeight,
    y + options.rowPaddingBottom
  );
  const leftGutter = options.leftGutter;
  const width = leftGutter + rowLength * options.charWidth + options.rightGutter;
  const hitRegions = tracks.flatMap(track =>
    (track.items || []).map(item => ({
      id: item.id,
      type: item.annotationType || item.labelType || track.kind,
      start: item.start,
      end: item.end,
      lane: item.lane,
      track: track.id,
      annotation: item.annotation
    }))
  );

  return Object.freeze({
    layoutVersion: SEQUENCE_PANEL_LAYOUT_VERSION,
    rowStart: row?.start ?? 0,
    rowEnd: row?.end ?? -1,
    rowLength,
    charWidth: options.charWidth,
    leftGutter,
    rightGutter: options.rightGutter,
    width,
    height,
    tracks: Object.freeze(tracks.map(track => Object.freeze({
      ...track,
      items: Object.freeze(track.items || [])
    }))),
    cutsiteItems: Object.freeze(cutsiteItems),
    selectionRanges: Object.freeze(
      makeSelectionRanges(props.selectionLayer, row, sequenceLength)
    ),
    hitRegions: Object.freeze(hitRegions)
  });
}

export function buildRowOffsets(layouts) {
  const offsets = [0];
  layouts.forEach(layout => {
    offsets.push(offsets[offsets.length - 1] + layout.height);
  });
  return offsets;
}

function upperBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (values[mid] <= target) low = mid + 1;
    else high = mid;
  }
  return Math.max(0, low - 1);
}

export function getVisibleRowRange(offsets, scrollTop, viewportHeight, overscan = 3) {
  const rowCount = Math.max(0, offsets.length - 1);
  if (!rowCount) return { start: 0, end: -1 };
  const safeTop = Math.max(0, Number(scrollTop) || 0);
  const safeHeight = Math.max(1, Number(viewportHeight) || 1);
  const first = upperBound(offsets, safeTop);
  const last = upperBound(offsets, safeTop + safeHeight);
  return {
    start: Math.max(0, first - overscan),
    end: Math.min(rowCount - 1, last + overscan)
  };
}

export function getRowIndexForContentOffset(offsets, contentOffset) {
  const rowCount = Math.max(0, offsets.length - 1);
  if (!rowCount) return -1;
  const totalHeight = Math.max(0, Number(offsets[offsets.length - 1]) || 0);
  const safeOffset = Math.min(
    Math.max(0, Number(contentOffset) || 0),
    Math.max(0, totalHeight - Number.EPSILON)
  );
  return Math.min(rowCount - 1, upperBound(offsets, safeOffset));
}

export function getAutoScrollDelta({
  clientY,
  viewportTop,
  viewportBottom,
  edgeThreshold = 56,
  maxSpeed = 22
} = {}) {
  const y = Number(clientY);
  const top = Number(viewportTop);
  const bottom = Number(viewportBottom);
  if (![y, top, bottom].every(Number.isFinite) || bottom <= top) return 0;

  const threshold = Math.min(
    Math.max(1, Number(edgeThreshold) || 56),
    Math.max(1, (bottom - top) / 2)
  );
  const speed = Math.max(1, Number(maxSpeed) || 22);
  if (y < top + threshold) {
    return -Math.min(speed, Math.max(1, Math.ceil(((top + threshold - y) / threshold) * speed)));
  }
  if (y > bottom - threshold) {
    return Math.min(speed, Math.max(1, Math.ceil(((y - (bottom - threshold)) / threshold) * speed)));
  }
  return 0;
}

export function getNearestCaretPosition({
  clientX,
  rectLeft = 0,
  rowStart = 0,
  rowEnd = -1,
  leftGutter = DEFAULT_LAYOUT_OPTIONS.leftGutter,
  charWidth = DEFAULT_LAYOUT_OPTIONS.charWidth,
  sequenceLength = Number.POSITIVE_INFINITY
} = {}) {
  const rowLength = Math.max(0, Math.floor(rowEnd - rowStart + 1));
  const safeCharWidth = Math.max(1, Number(charWidth) || DEFAULT_LAYOUT_OPTIONS.charWidth);
  const localX = Number(clientX) - Number(rectLeft) - Number(leftGutter);
  const offset = Math.max(
    0,
    Math.min(rowLength, Math.floor(localX / safeCharWidth + 0.5))
  );
  return Math.min(
    Math.max(0, Number(sequenceLength) || 0),
    Math.max(0, Math.floor(rowStart) + offset)
  );
}

export function isCaretWithinSelection({
  caretPosition = -1,
  selectionLayer = {},
  sequenceLength = 0
} = {}) {
  const caret = Number(caretPosition);
  const start = Number(selectionLayer.start);
  const end = Number(selectionLayer.end);
  const length = Math.max(0, Number(sequenceLength) || 0);
  if (
    !Number.isFinite(caret) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    caret < 0 ||
    caret > length ||
    start < 0 ||
    end < 0
  ) {
    return false;
  }

  // Selection ranges address bases inclusively, while pointer hit-testing
  // returns a caret between bases. Include the boundary after the final base.
  const endBoundary = Math.min(length, end + 1);
  return start <= end
    ? caret >= start && caret <= endBoundary
    : caret >= start || caret <= endBoundary;
}

export function getFocusPosition({
  caretPosition = -1,
  selectionLayer = {},
  previousCaretPosition,
  previousSelectionLayer = {}
} = {}) {
  const caretChanged =
    Number.isFinite(Number(caretPosition)) &&
    Number(caretPosition) >= 0 &&
    Number(caretPosition) !== Number(previousCaretPosition);
  if (caretChanged) return Number(caretPosition);
  const selectionStartChanged =
    Number.isFinite(Number(selectionLayer.start)) &&
    selectionLayer.start >= 0 &&
    selectionLayer.start !== previousSelectionLayer.start;
  if (selectionStartChanged) return Number(selectionLayer.start);
  const selectionEndChanged =
    Number.isFinite(Number(selectionLayer.end)) &&
    selectionLayer.end >= 0 &&
    selectionLayer.end !== previousSelectionLayer.end;
  if (selectionEndChanged) return Number(selectionLayer.end);
  if (Number.isFinite(Number(caretPosition)) && Number(caretPosition) >= 0) {
    return Number(caretPosition);
  }
  if (Number.isFinite(Number(selectionLayer.start)) && selectionLayer.start >= 0) {
    return Number(selectionLayer.start);
  }
  if (Number.isFinite(Number(selectionLayer.end)) && selectionLayer.end >= 0) {
    return Number(selectionLayer.end);
  }
  return -1;
}

export function getRowIndexForPosition(position, bpsPerRow, rowCount) {
  const safeRowSize = Math.max(1, Math.floor(Number(bpsPerRow) || 1));
  const safeRowCount = Math.max(0, Math.floor(Number(rowCount) || 0));
  if (!safeRowCount || !Number.isFinite(Number(position)) || Number(position) < 0) {
    return -1;
  }
  return Math.min(safeRowCount - 1, Math.floor(Number(position) / safeRowSize));
}

export function getStableBpsPerRow({ width, charWidth, isProtein } = {}) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeCharWidth = Math.max(1, Number(charWidth) || DEFAULT_LAYOUT_OPTIONS.charWidth);
  const unitWidth = isProtein ? safeCharWidth * 3 : safeCharWidth;
  const raw = Math.max(1, Math.floor(safeWidth / unitWidth));
  if (isProtein) return Math.max(3, Math.floor(raw / 3) * 3);
  return raw >= 60 ? Math.max(10, Math.floor(raw / 10) * 10) : raw;
}
