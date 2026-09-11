import assert from "node:assert/strict";
import {
  buildRowLayout,
  buildRowOffsets,
  fitAnnotationLabel,
  hasAnnotationArrowhead,
  getRecognitionSiteOverlaps,
  getFocusPosition,
  getCutsiteBottomPosition,
  getCutsitePosition,
  isCaretWithinSelection,
  getNearestCaretPosition,
  getAutoScrollDelta,
  getRowIndexForContentOffset,
  getRowIndexForPosition,
  getRowOverlaps,
  getStableBpsPerRow,
  getVisibleRowRange
} from "./layout.js";

const visibleDefaults = {
  annotationVisibility: {
    features: true,
    parts: true,
    primers: true,
    translations: true,
    cutsites: true,
    sequence: true,
    reverseSequence: true,
    axis: true
  },
  annotationLabelVisibility: {
    features: true,
    primers: true,
    cutsites: true
  },
  sequenceLength: 120
};

const row = {
  rowNumber: 0,
  start: 0,
  end: 59,
  sequence: "ATG".repeat(20),
  features: [
    {
      id: "cds-1",
      start: 3,
      end: 32,
      yOffset: 0,
      annotation: {
        id: "cds-1",
        name: "Example CDS",
        type: "CDS",
        start: 3,
        end: 32,
        forward: true,
        color: "#83b7d7",
        aminoAcids: Array.from({ length: 30 }, (_, index) => ({
          sequenceIndex: index + 3,
          positionInCodon: index % 3,
          aminoAcidIndex: Math.floor(index / 3),
          aminoAcid: { value: "M" }
        }))
      }
    }
  ],
  primers: [
    {
      id: "primer-r",
      start: 40,
      end: 49,
      annotation: { id: "primer-r", name: "Reverse primer", start: 40, end: 49, forward: false }
    }
  ],
  cutsites: [
    {
      id: "eco-ri",
      start: 16,
      end: 21,
      annotation: {
        id: "eco-ri",
        name: "EcoRI",
        start: 16,
        end: 21,
        topSnipPosition: 18,
        recognitionSiteRange: { start: 16, end: 21 },
        labelClassName: "singleCutter",
        labelColor: "#b3372f"
      }
    }
  ],
  translations: [
    {
      id: "translation-1",
      start: 3,
      end: 32,
      annotation: {
        id: "translation-1",
        name: "Example CDS translation",
        start: 3,
        end: 32,
        forward: true,
        translationType: "CDS Feature",
        aminoAcids: Array.from({ length: 30 }, (_, index) => ({
          sequenceIndex: index + 3,
          positionInCodon: index % 3,
          aminoAcidIndex: Math.floor(index / 3),
          aminoAcid: { value: "M" }
        }))
      }
    }
  ]
};

const layout = buildRowLayout(row, visibleDefaults);
const trackIds = layout.tracks.map(track => track.id);
assert(trackIds.includes("sequence-forward"));
assert(trackIds.includes("sequence-reverse"));
assert(trackIds.includes("axis"));
assert(trackIds.includes("features-forward"));
assert(trackIds.includes("primers-reverse"));
assert(trackIds.includes("translations"));
assert(trackIds.includes("labels"));
assert.equal(layout.cutsiteItems.length, 1);
assert.equal(getCutsitePosition(row.cutsites[0], row), 18);
assert.equal(getCutsiteBottomPosition(row.cutsites[0], row), 18);
assert.deepEqual(
  getRecognitionSiteOverlaps(row.cutsites[0], row, 120),
  [{ start: 16, end: 21 }]
);
// Circular recognition sites may wrap the origin. Each visible row receives
// only its own inclusive segment, so the renderer can shade both ends without
// inventing a contiguous range across the row boundary.
assert.deepEqual(
  getRecognitionSiteOverlaps(
    { annotation: { recognitionSiteRange: { start: 58, end: 3 } } },
    { start: 0, end: 59 },
    60
  ),
  [{ start: 0, end: 3 }, { start: 58, end: 59 }]
);
assert.deepEqual(
  getRecognitionSiteOverlaps(
    { annotation: { recognitionSiteRange: { start: 58, end: 3 } } },
    { start: 0, end: 2 },
    60
  ),
  [{ start: 0, end: 2 }]
);
assert.equal(
  layout.tracks.find(track => track.id === "labels")?.items[0]?.annotation.labelClassName,
  "singleCutter"
);
// A cut coordinate is a boundary, so a cut at row.end + 1 is valid (between
// the last base in this row and the first base in the next row).
assert.equal(
  getCutsitePosition(
    { start: 58, end: 59, annotation: { topSnipPosition: 60 } },
    { start: 0, end: 59 }
  ),
  60
);
assert.equal(
  getCutsitePosition(
    { start: 58, end: 59, annotation: { topSnipPosition: 60 } },
    { start: 60, end: 119 }
  ),
  60
);
assert.equal(
  getCutsitePosition(
    { start: 58, end: 59, annotation: { topSnipPosition: 60 } },
    { start: 20, end: 58 }
  ),
  null
);
assert.equal(layout.height > 0, true);
assert.equal(layout.width, 42 + 60 * 11 + 44);
assert.equal(getRowOverlaps({ start: 58, end: 3 }, { start: 0, end: 59 }, 60).length, 2);

// Long enzyme names must be assigned by their rendered footprint, not just
// their recognition ranges. Two nearby sites therefore move to separate
// visual lanes instead of painting over one another (the screenshot
// regression reported for Nsp29132I/BspT104I-style labels).
const collisionLayout = buildRowLayout({
  ...row,
  end: 59,
  primers: [],
  cutsites: [
    { id: "nsp", start: 10, end: 14, annotation: { name: "Nsp29132I", start: 10, end: 14, topSnipPosition: 10 } },
    { id: "bspt", start: 12, end: 16, annotation: { name: "BspT104I", start: 12, end: 16, topSnipPosition: 12 } },
    { id: "sac", start: 30, end: 34, annotation: { name: "SacI +1", start: 30, end: 34, topSnipPosition: 30 } }
  ]
}, { ...visibleDefaults, sequenceLength: 60 });
const collisionLabels = collisionLayout.tracks.find(track => track.id === "labels")?.items || [];
assert.equal(collisionLabels.length, 3);
assert(collisionLabels.some(item => item.lane > 0), "nearby labels should use a second lane");
for (const left of collisionLabels) {
  for (const right of collisionLabels) {
    if (left === right || left.lane !== right.lane) continue;
    assert(
      left.labelExtent.end < right.labelExtent.start || right.labelExtent.end < left.labelExtent.start,
      `labels ${left.label} and ${right.label} overlap in lane ${left.lane}`
    );
  }
}

// Labels at either edge stay inside the base grid, while their true cut
// boundary remains unchanged for hit testing and connector rendering.
const edgeSites = [0, 1, 57, 59].map((position, index) => ({
  id: `edge-${index}`, start: position, end: Math.min(59, position + 2),
  annotation: { name: `LongEnzymeName${index}`, start: position, end: Math.min(59, position + 2), topSnipPosition: position }
}));
const edgeLayout = buildRowLayout({ ...row, cutsites: edgeSites }, visibleDefaults);
for (const item of edgeLayout.tracks.find(track => track.id === "labels").items) {
  assert(item.labelExtent.start >= 0);
  assert(item.labelExtent.end <= 60);
}
const sameTopDifferentBottom = buildRowLayout({ ...row, primers: [], cutsites: [
  { id: "cut-a", start: 10, end: 18, annotation: { name: "EnzymeA", start: 10, end: 18, topSnipPosition: 12, bottomSnipPosition: 16 } },
  { id: "cut-b", start: 10, end: 18, annotation: { name: "EnzymeB", start: 10, end: 18, topSnipPosition: 12, bottomSnipPosition: 18 } }
] }, visibleDefaults);
assert.equal(sameTopDifferentBottom.tracks.find(track => track.id === "labels").items.length, 2);
assert(edgeLayout.tracks.find(track => track.id === "labels").y < edgeLayout.tracks.find(track => track.id === "sequence-forward").y);
assert(edgeLayout.tracks.find(track => track.id === "features-forward").y > edgeLayout.tracks.find(track => track.id === "sequence-reverse").y);
assert.equal(fitAnnotationLabel("AmpR", 100), "AmpR");
assert.equal(fitAnnotationLabel("long feature label", 56), "long f…");
assert.equal(fitAnnotationLabel("特征很长的中文名称", 56), "特征很…");
assert.equal(fitAnnotationLabel("AmpR", 10), "");
assert.equal(hasAnnotationArrowhead({ start: 0, end: 59, sourceStart: 0, sourceEnd: 80, annotation: { forward: true } }), false);
assert.equal(hasAnnotationArrowhead({ start: 60, end: 80, sourceStart: 0, sourceEnd: 80, annotation: { forward: true } }), true);
assert.equal(hasAnnotationArrowhead({ start: 60, end: 80, sourceStart: 0, sourceEnd: 80, annotation: { forward: false } }), false);
assert.equal(hasAnnotationArrowhead({ start: 0, end: 59, sourceStart: 0, sourceEnd: 80, annotation: { forward: false } }), true);

const denseRow = { ...row, primers: [], cutsites: Array.from({ length: 35 }, (_, index) => ({
  id: `dense-${index}`, start: index, end: index + 1,
  annotation: { name: `DenseEnzyme${index}`, start: index, end: index + 1, topSnipPosition: index }
})) };
const denseLayout = buildRowLayout(denseRow, visibleDefaults);
const expandedLayout = buildRowLayout(denseRow, { ...visibleDefaults, labelsExpanded: true });
const denseLabels = denseLayout.tracks.find(track => track.id === "labels");
const expandedLabels = expandedLayout.tracks.find(track => track.id === "labels");
assert(denseLabels.hiddenCount > 0);
assert.equal(expandedLabels.hiddenCount, 0);
assert.equal(expandedLabels.items.length, 35);
assert(expandedLayout.height > denseLayout.height);

const ordinarySelectionLayout = buildRowLayout(row, {
  ...visibleDefaults,
  selectionLayer: { start: 10, end: 14 },
  sequenceLength: 120
});
assert.deepEqual(ordinarySelectionLayout.selectionRanges, [{ start: 10, end: 14 }]);
assert.equal(
  getNearestCaretPosition({
    clientX: 42 + 10 * 10 + 0.1,
    rectLeft: 0,
    rowStart: 0,
    rowEnd: 59,
    leftGutter: 42,
    charWidth: 10,
    sequenceLength: 120
  }),
  10
);
assert.equal(
  getNearestCaretPosition({
    clientX: 42 + 60 * 10,
    rectLeft: 0,
    rowStart: 0,
    rowEnd: 59,
    leftGutter: 42,
    charWidth: 10,
    sequenceLength: 120
  }),
  60,
  "a click at the row end places the insertion caret after the last base"
);
assert.equal(getFocusPosition({ caretPosition: 60, selectionLayer: { start: 10, end: 14 } }), 60);
assert.equal(isCaretWithinSelection({ caretPosition: 10, selectionLayer: { start: 10, end: 14 }, sequenceLength: 120 }), true);
assert.equal(isCaretWithinSelection({ caretPosition: 15, selectionLayer: { start: 10, end: 14 }, sequenceLength: 120 }), true);
assert.equal(isCaretWithinSelection({ caretPosition: 16, selectionLayer: { start: 10, end: 14 }, sequenceLength: 120 }), false);
assert.equal(isCaretWithinSelection({ caretPosition: 59, selectionLayer: { start: 58, end: 3 }, sequenceLength: 60 }), true);
assert.equal(isCaretWithinSelection({ caretPosition: 4, selectionLayer: { start: 58, end: 3 }, sequenceLength: 60 }), true);
assert.equal(isCaretWithinSelection({ caretPosition: 20, selectionLayer: { start: 58, end: 3 }, sequenceLength: 60 }), false);
assert.equal(getFocusPosition({ caretPosition: -1, selectionLayer: { start: 58, end: 3 } }), 58);
assert.equal(
  getFocusPosition({
    caretPosition: -1,
    selectionLayer: { start: 10, end: 80 },
    previousCaretPosition: -1,
    previousSelectionLayer: { start: 10, end: 14 }
  }),
  80,
  "an externally extended selection follows its changed end"
);
assert.equal(getRowIndexForPosition(0, 60, 4), 0);
assert.equal(getRowIndexForPosition(119, 60, 4), 1);
assert.equal(getRowIndexForPosition(250000, 60, 4167), 4166);

const emptyLayout = buildRowLayout({ start: 0, end: 0, sequence: "", features: [], primers: [], cutsites: [] }, {
  ...visibleDefaults,
  sequenceLength: 0
});
assert.equal(emptyLayout.height > 0, true);

const layouts = Array.from({ length: 2500 }, () => emptyLayout);
const offsets = buildRowOffsets(layouts);
const visible = getVisibleRowRange(offsets, 10000, 400, 3);
assert(visible.end - visible.start < 20);
assert.equal(getRowIndexForContentOffset(offsets, offsets[100]), 100);
assert.equal(getRowIndexForContentOffset(offsets, Number.POSITIVE_INFINITY), layouts.length - 1);
assert(getAutoScrollDelta({ clientY: 4, viewportTop: 0, viewportBottom: 400 }) < 0);
assert(getAutoScrollDelta({ clientY: 396, viewportTop: 0, viewportBottom: 400 }) > 0);
assert.equal(getAutoScrollDelta({ clientY: 200, viewportTop: 0, viewportBottom: 400 }), 0);
assert.equal(getStableBpsPerRow({ width: 800, charWidth: 10 }), 80);
assert.equal(getStableBpsPerRow({ width: 800, charWidth: 10, isProtein: true }) % 3, 0);

console.log("SequencePanel smoke passed", {
  height: layout.height,
  tracks: trackIds,
  virtualRows: visible.end - visible.start + 1
});
