// Regression tests for the Sequence view interaction fixes (audit P1-P3):
//
// P1 — SequenceRow used to call setPointerCapture on pointerdown. Per the
// Pointer Events spec, while a pointer is captured the browser redirects the
// compatible click event to the capturing <svg> — so every annotation onClick
// (feature / cutsite / primer / label) was silently swallowed and clicks only
// placed a caret. The fix defers capture until a drag is actually under way
// (first pointermove with the primary button held) and guards the release
// with hasPointerCapture.
//
// P2 — renderArrow/renderPrimer/renderLabels/renderCutsites now also wire
// onDoubleClick to the engine's ${type}DoubleClicked handlers (Edit Feature /
// Edit Primer / cutsite info dialogs), matching the Map view.
//
// P3 — labels are no longer uniformly red italic: feature labels take the
// feature color, cutsite labels a dark slate, primer labels the primer blue.
//
// jsdom cannot emulate the capture-driven click redirection, so the P1
// regression contract is asserted directly:
//   1. pointerdown alone never captures,
//   2. capture engages lazily on the first drag move,
//   3. releasePointerCapture is only called while capture is held
//      (this guards the NotFoundError a plain click used to hit),
//   4. a plain click on an annotation still fires its onClick handler,
//   5. drag selection still updates the selection layer.

import React, { act } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";

// Raw createRoot usage (no React Testing Library) needs the act environment
// flag so React stops warning about unmocked act() calls.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../src/withEditorInteractions/index.js", () => ({
  default: Component => Component
}));

const { SequencePanelUnconnected } = await import(
  "../src/genecode/SequencePanel/SequencePanel.jsx"
);

// --- Browser pointer-capture contract emulation -------------------------------

const captureByElement = new WeakMap();
function capturedPointerIds(element) {
  if (!captureByElement.has(element)) {
    captureByElement.set(element, new Set());
  }
  return captureByElement.get(element);
}

const calls = { set: 0, has: 0, release: 0 };
let restoreCaptureMethods = () => {};

beforeEach(() => {
  calls.set = 0;
  calls.has = 0;
  calls.release = 0;
});

afterAll(() => {
  restoreCaptureMethods();
  document.body.innerHTML = "";
});

{
  const originals = {};
  const install = (name, impl) => {
    originals[name] = Object.getOwnPropertyDescriptor(Element.prototype, name);
    Object.defineProperty(Element.prototype, name, {
      configurable: true,
      writable: true,
      value: impl
    });
  };
  install("setPointerCapture", function (pointerId) {
    calls.set += 1;
    capturedPointerIds(this).add(pointerId);
  });
  install("hasPointerCapture", function (pointerId) {
    calls.has += 1;
    return capturedPointerIds(this).has(pointerId);
  });
  install("releasePointerCapture", function (pointerId) {
    calls.release += 1;
    capturedPointerIds(this).delete(pointerId);
  });
  restoreCaptureMethods = () => {
    for (const [name, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(Element.prototype, name, descriptor);
      else delete Element.prototype[name];
    }
  };
}

// --- Render helpers -----------------------------------------------------------

const SEQUENCE = "ATG".repeat(20); // 60 bp, one row at default 11px char width

function makeSequenceData(overrides = {}) {
  return {
    name: "Test plasmid",
    sequence: SEQUENCE,
    circular: false,
    // OVE-shaped features: the annotation object IS the feature (flat, with
    // color at the top level) — the shape the app produces from GenBank files.
    features: [
      {
        id: "cds-1",
        name: "Example CDS",
        type: "CDS",
        start: 3,
        end: 32,
        forward: true,
        color: "#83b7d7"
      }
    ],
    cutsites: [
      {
        id: "eco-ri",
        name: "EcoRI",
        start: 16,
        end: 21,
        topSnipPosition: 18
      }
    ],
    parts: [],
    warnings: [],
    assemblyPieces: [],
    lineageAnnotations: [],
    primers: [],
    translations: [],
    ...overrides
  };
}

async function renderPanel(overrides = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const props = {
    sequenceData: makeSequenceData(),
    dimensions: { width: 800, height: 300 },
    editorClicked: vi.fn(),
    featureClicked: vi.fn(),
    featureDoubleClicked: vi.fn(),
    cutsiteClicked: vi.fn(),
    cutsiteDoubleClicked: vi.fn(),
    primerDoubleClicked: vi.fn(),
    selectionLayerRightClicked: vi.fn(),
    backgroundRightClicked: vi.fn(),
    selectionLayerUpdate: vi.fn(),
    caretPositionUpdate: vi.fn(),
    selectionLayer: { start: -1, end: -1 },
    caretPosition: -1,
    ...overrides
  };
  await act(async () => {
    root.render(React.createElement(SequencePanelUnconnected, props));
  });
  return {
    container,
    props,
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
    }
  };
}

function pointer(type, overrides = {}) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    button: 0,
    buttons: 0,
    pointerId: 1,
    clientX: 100,
    clientY: 100,
    shiftKey: false,
    ...overrides
  });
  return event;
}

function dispatchClick(node, overrides = {}) {
  const event = new window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    ...overrides
  });
  node.dispatchEvent(event);
  return event;
}

function dispatchDblClick(node, overrides = {}) {
  const event = new window.MouseEvent("dblclick", {
    bubbles: true,
    cancelable: true,
    ...overrides
  });
  node.dispatchEvent(event);
  return event;
}

function findLabelText(container, text) {
  return (
    [...container.querySelectorAll(".genecode-sequence-label-text")].find(
      node => node.textContent === text
    ) ?? null
  );
}

// --- Tests --------------------------------------------------------------------

describe("SequencePanel pointer capture (P1 regression)", () => {
  it("never captures on a plain pointerdown, and a click on an annotation still selects it", async () => {
    const { container, props, cleanup } = await renderPanel();
    // The feature arrow is the annotation's interactive surface (feature
    // names are no longer painted in the row-leading label lane).
    const featureArrow = container.querySelector(
      ".genecode-sequence-hit-region polygon"
    );
    expect(featureArrow).not.toBeNull();

    featureArrow.dispatchEvent(pointer("pointerdown", { clientX: 60, clientY: 60 }));
    expect(calls.set).toBe(0);
    expect(calls.release).toBe(0);

    featureArrow.dispatchEvent(pointer("pointerup", { clientX: 60, clientY: 60 }));
    // Note: the raw panel does not stopPropagation — in the real app the
    // withEditorInteractions wrapper's annotationClicked does, so the row's
    // caret handler is suppressed there. This test only asserts the panel
    // routes the click to the annotation handler.
    dispatchClick(featureArrow, { clientX: 60, clientY: 60 });

    expect(props.featureClicked).toHaveBeenCalledTimes(1);
    const payload = props.featureClicked.mock.calls[0][0];
    // annotationClicked consumes top-level start/end/id to build the selection.
    expect(payload.annotation.id).toBe("cds-1");
    expect(payload.annotation.start).toBe(3);
    expect(payload.annotation.end).toBe(32);
    // The whole interaction must stay capture-free.
    expect(calls.set).toBe(0);
    expect(calls.release).toBe(0);
    await cleanup();
  });

  it("captures lazily on the first drag move and releases on pointerup", async () => {
    const { container, props, cleanup } = await renderPanel();
    const row = container.querySelector(".genecode-sequence-row");
    expect(row).not.toBeNull();

    row.dispatchEvent(pointer("pointerdown", { clientX: 40, clientY: 120 }));
    expect(calls.set).toBe(0);

    // First move with the primary button held engages capture…
    row.dispatchEvent(
      pointer("pointermove", { buttons: 1, clientX: 40, clientY: 120 })
    );
    expect(calls.set).toBe(1);
    expect(calls.release).toBe(0);

    // …and a second move drives the drag selection through the engine.
    row.dispatchEvent(
      pointer("pointermove", { buttons: 1, clientX: 220, clientY: 120 })
    );
    expect(props.selectionLayerUpdate).toHaveBeenCalled();

    row.dispatchEvent(pointer("pointerup", { clientX: 220, clientY: 120 }));
    expect(calls.release).toBe(1);
    // A drag must not have moved the caret (selection-only interaction).
    expect(props.caretPositionUpdate).not.toHaveBeenCalled();
    await cleanup();
  });

  it("does not release an unheld capture on a plain click (NotFoundError guard)", async () => {
    const { container, cleanup } = await renderPanel();
    const row = container.querySelector(".genecode-sequence-row");

    row.dispatchEvent(pointer("pointerdown", { clientX: 120, clientY: 120 }));
    row.dispatchEvent(pointer("pointerup", { clientX: 120, clientY: 120 }));

    expect(calls.set).toBe(0);
    expect(calls.release).toBe(0);
    // The guard must actually have consulted hasPointerCapture before deciding
    // not to release, otherwise the assert above would pass vacuously.
    expect(calls.has).toBeGreaterThan(0);
    await cleanup();
  });

  it("still places the caret when clicking the sequence background", async () => {
    const { container, props, cleanup } = await renderPanel();
    const row = container.querySelector(".genecode-sequence-row");

    row.dispatchEvent(pointer("pointerdown", { clientX: 120, clientY: 120 }));
    row.dispatchEvent(pointer("pointerup", { clientX: 120, clientY: 120 }));
    dispatchClick(row, { clientX: 120, clientY: 120 });

    expect(props.editorClicked).toHaveBeenCalledTimes(1);
    await cleanup();
  });
});

describe("SequencePanel double-click wiring (P2)", () => {
  it("does not paint a row-leading feature label (arrow double-click still routes)", async () => {
    const { container, props, cleanup } = await renderPanel();
    // Feature names are not shown at the start of every sequence row; the
    // feature arrow is the interactive surface (SnapGene keeps row-leading
    // labels to cut sites and primers).
    expect(findLabelText(container, "Example CDS")).toBeNull();

    const arrow = container.querySelector(".genecode-sequence-hit-region polygon");
    expect(arrow).not.toBeNull();
    dispatchDblClick(arrow);

    expect(props.featureDoubleClicked).toHaveBeenCalledTimes(1);
    expect(props.featureDoubleClicked.mock.calls[0][0].annotation.id).toBe("cds-1");
    // A double-click must not fire the single-click handler.
    expect(props.featureClicked).not.toHaveBeenCalled();
    await cleanup();
  });

  it("routes a double-click on a cutsite label to cutsiteDoubleClicked", async () => {
    const { container, props, cleanup } = await renderPanel();
    const label = findLabelText(container, "EcoRI");
    expect(label).not.toBeNull();

    dispatchDblClick(label);

    expect(props.cutsiteDoubleClicked).toHaveBeenCalledTimes(1);
    expect(props.cutsiteDoubleClicked.mock.calls[0][0].annotation.id).toBe("eco-ri");
    await cleanup();
  });

  it("routes a double-click on the feature arrow to featureDoubleClicked", async () => {
    const { container, props, cleanup } = await renderPanel();
    const arrow = container.querySelector(".genecode-sequence-hit-region polygon");
    expect(arrow).not.toBeNull();

    dispatchDblClick(arrow);

    expect(props.featureDoubleClicked).toHaveBeenCalledTimes(1);
    expect(props.featureDoubleClicked.mock.calls[0][0].annotation.id).toBe("cds-1");
    await cleanup();
  });
});

describe("SequencePanel label colors (P3)", () => {
  it("renders only cut-site and primer labels in the label lane", async () => {
    const { container, cleanup } = await renderPanel();
    // Feature names are intentionally absent from the row-leading label lane.
    expect(findLabelText(container, "Example CDS")).toBeNull();
    // Cut-site labels are still painted.
    expect(findLabelText(container, "EcoRI")).not.toBeNull();
    await cleanup();
  });

  it("tags cutsite labels with the cutsite class (dark slate via CSS)", async () => {
    const { container, cleanup } = await renderPanel();
    const label = findLabelText(container, "EcoRI");
    expect(label).not.toBeNull();

    expect(label.getAttribute("class")).toContain("genecode-sequence-label-cutsites");
    // Cutsite labels must not inherit the feature fill override.
    expect(label.style.fill).toBe("");
    await cleanup();
  });
});

describe("SequencePanel focus-scroll on mount (P5)", () => {
  // 3000 bp so a real-width render produces many rows (bpsPerRow ~100 at
  // width 1200, charWidth 11). A selection in the middle must scroll.
  const LONG_SEQUENCE = "ACGT".repeat(750);

  function longSequenceData() {
    return makeSequenceData({ sequence: LONG_SEQUENCE });
  }

  function baseProps(overrides = {}) {
    return {
      sequenceData: longSequenceData(),
      dimensions: { width: 1200, height: 600 },
      selectionLayer: { start: -1, end: -1 },
      caretPosition: -1,
      editorClicked: vi.fn(),
      featureClicked: vi.fn(),
      selectionLayerUpdate: vi.fn(),
      caretPositionUpdate: vi.fn(),
      ...overrides
    };
  }

  // A persistent render handle so a test can mount once, install the scrollTop
  // spy, then re-render with changed props to re-trigger the focus effect
  // while the spy is live.
  function createP5Panel() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    return {
      container,
      render: async propsToUse => {
        await act(async () => {
          root.render(React.createElement(SequencePanelUnconnected, propsToUse));
        });
      },
      unmount: async () => {
        await act(async () => root.unmount());
        container.remove();
      }
    };
  }

  // Spy on the scroll container's scrollTop so we can assert the exact value
  // the focus effect assigns, independent of jsdom's (absent) layout engine.
  function spyOnScrollTop(container) {
    const scrollEl = container.querySelector(".genecode-sequence-scroll");
    expect(scrollEl).not.toBeNull();
    const state = { value: 0 };
    Object.defineProperty(scrollEl, "scrollTop", {
      configurable: true,
      get: () => state.value,
      set: v => {
        state.value = v;
      }
    });
    return state;
  }

  it("bails on the placeholder-dimensions frame, then scrolls to the selection once real dimensions arrive", async () => {
    const panel = createP5Panel();
    // First render with the ReflexElement placeholder dimensions the panel
    // actually receives on mount (before react-measure publishes pixels).
    await panel.render(
      baseProps({
        dimensions: { height: "100%", width: "100%" },
        selectionLayer: { start: 1500, end: 1600 }
      })
    );
    const scrollState = spyOnScrollTop(panel.container);
    // The placeholder frame's effect already ran (and bailed) before the spy
    // was installed, so this only documents the starting state — the real
    // regression teeth are the second-phase assertion below. With the bug,
    // the placeholder frame computed a huge target (bpsPerRow 1 → row 1500)
    // and consumed the focus key; the real-dimensions frame that follows then
    // early-returned without scrolling. With the fix, the placeholder frame
    // bails out entirely, so the focus key is still fresh when real
    // dimensions arrive.
    expect(scrollState.value).toBe(0);

    await panel.render(
      baseProps({
        dimensions: { width: 1200, height: 600 },
        selectionLayer: { start: 1500, end: 1600 }
      })
    );

    // Selection at bp 1500 is many rows down; the effect must scroll to it.
    expect(scrollState.value).toBeGreaterThan(0);
    await panel.unmount();
  });

  it("scrolls to a mid-sequence selection when real dimensions are present from the start", async () => {
    const panel = createP5Panel();
    await panel.render(baseProps({}));
    const scrollState = spyOnScrollTop(panel.container);

    await panel.render(baseProps({ selectionLayer: { start: 1500, end: 1600 } }));

    expect(scrollState.value).toBeGreaterThan(0);
    await panel.unmount();
  });

  it("keeps the panel at the top when the selection starts at the first row", async () => {
    const panel = createP5Panel();
    await panel.render(baseProps({}));
    const scrollState = spyOnScrollTop(panel.container);

    // First-row selection: targetTop (0) and targetBottom stay inside the
    // viewport, so no scroll is needed.
    await panel.render(baseProps({ selectionLayer: { start: 5, end: 20 } }));

    expect(scrollState.value).toBe(0);
    await panel.unmount();
  });
});

describe("SequencePanel cutsite dedup (isoschizomers)", () => {
  it("renders one vertical marker per cut position instead of one per enzyme", async () => {
    // Five isoschizomers all cut the same 4-bp recognition site (start 10).
    const cutsites = [
      { id: "a", name: "VpaKutJI", start: 10, end: 14, topSnipPosition: 11 },
      { id: "b", name: "VpaK11BI", start: 10, end: 14, topSnipPosition: 11 },
      { id: "c", name: "VchO66I", start: 10, end: 14, topSnipPosition: 11 },
      { id: "d", name: "HgiBI", start: 10, end: 14, topSnipPosition: 11 },
      { id: "e", name: "Cfr47I", start: 10, end: 14, topSnipPosition: 11 },
      { id: "f", name: "EcoRI", start: 30, end: 35, topSnipPosition: 31 }
    ];
    const { container, cleanup } = await renderPanel({
      sequenceData: makeSequenceData({ cutsites })
    });
    // Only the cutsite marker lines count — the label connector lines live in
    // the same hit-region class but carry the label class instead.
    const markerLines = [...container.querySelectorAll(
      ".genecode-sequence-hit-region line.genecode-sequence-cutsite-marker"
    )];
    // One marker for position 11 and one for position 31 — never five stacked.
    expect(markerLines).toHaveLength(2);
    const xs = markerLines.map(line => Number(line.getAttribute("x1")));
    expect(new Set(xs).size).toBe(2);
    await cleanup();
  });

  it("labels a group with the total enzyme count", async () => {
    const cutsites = [
      { id: "a", name: "VpaKutJI", start: 10, end: 14, topSnipPosition: 11 },
      { id: "b", name: "VpaK11BI", start: 10, end: 14, topSnipPosition: 11 },
      { id: "c", name: "EcoRI", start: 30, end: 35, topSnipPosition: 31 },
      { id: "d", name: "SacI", start: 70, end: 75, topSnipPosition: 71 }
    ];
    const { container, cleanup } = await renderPanel({
      sequenceData: makeSequenceData({ cutsites })
    });
    const cutLabels = [...container.querySelectorAll(".genecode-sequence-label-cutsites")];
    // The count is explicitly enzymes at this cut, not additional cut sites.
    expect(cutLabels.length).toBeLessThanOrEqual(3);
    const texts = cutLabels.map(node => node.textContent);
    expect(texts).toContain("VpaKutJI · 2酶");
    expect(texts).not.toContain("VpaK11BI");
    await cleanup();
  });

  it("shows the full group size when more than two enzymes share a position", async () => {
    // Five enzymes share the same pair of cuts.
    const cutsites = [
      { id: "a", name: "VpaKutJI", start: 10, end: 14, topSnipPosition: 11 },
      { id: "b", name: "VpaK11BI", start: 10, end: 14, topSnipPosition: 11 },
      { id: "c", name: "VchO66I", start: 10, end: 14, topSnipPosition: 11 },
      { id: "d", name: "HgiBI", start: 10, end: 14, topSnipPosition: 11 },
      { id: "e", name: "Cfr47I", start: 10, end: 14, topSnipPosition: 11 },
      { id: "f", name: "EcoRI", start: 30, end: 35, topSnipPosition: 31 }
    ];
    const { container, cleanup } = await renderPanel({
      sequenceData: makeSequenceData({ cutsites })
    });
    const cutLabels = [...container.querySelectorAll(".genecode-sequence-label-cutsites")];
    const texts = cutLabels.map(node => node.textContent);
    expect(texts).toContain("VpaKutJI · 5酶");
    await cleanup();
  });

  it("routes a double-click on a merged cutsite label with every isoschizomer name", async () => {
    const cutsites = [
      { id: "a", name: "VpaKutJI", start: 10, end: 14, topSnipPosition: 11 },
      { id: "b", name: "VpaK11BI", start: 10, end: 14, topSnipPosition: 11 },
      { id: "c", name: "VchO66I", start: 10, end: 14, topSnipPosition: 11 },
      { id: "d", name: "EcoRI", start: 30, end: 35, topSnipPosition: 31 }
    ];
    const { container, props, cleanup } = await renderPanel({
      sequenceData: makeSequenceData({ cutsites })
    });
    const mergedLabel = findLabelText(container, "VpaKutJI · 3酶");
    expect(mergedLabel).not.toBeNull();
    dispatchDblClick(mergedLabel);
    expect(props.cutsiteDoubleClicked).toHaveBeenCalledTimes(1);
    const { annotation } = props.cutsiteDoubleClicked.mock.calls[0][0];
    expect(annotation.id).toBe("a");
    expect(annotation.isoschizomerNames).toEqual(["VpaKutJI", "VpaK11BI", "VchO66I"]);
    await cleanup();
  });

  it("keeps a plain click on a merged cutsite label routed to cutsiteClicked with the original annotation id", async () => {
    const cutsites = [
      { id: "a", name: "VpaKutJI", start: 10, end: 14, topSnipPosition: 11 },
      { id: "b", name: "VpaK11BI", start: 10, end: 14, topSnipPosition: 11 },
      { id: "c", name: "VchO66I", start: 10, end: 14, topSnipPosition: 11 }
    ];
    const { container, props, cleanup } = await renderPanel({
      sequenceData: makeSequenceData({ cutsites })
    });
    const mergedLabel = findLabelText(container, "VpaKutJI · 3酶");
    expect(mergedLabel).not.toBeNull();
    dispatchClick(mergedLabel);
    expect(props.cutsiteClicked).toHaveBeenCalledTimes(1);
    // The merged label rides on a fresh annotation object (isoschizomerNames
    // attached without polluting the flat source cutsite), but the original
    // annotation identity fields — id, name, topSnipPosition — must survive.
    const { annotation } = props.cutsiteClicked.mock.calls[0][0];
    expect(annotation.id).toBe("a");
    expect(annotation.name).toBe("VpaKutJI");
    expect(annotation.topSnipPosition).toBe(11);
    await cleanup();
  });

  it("keeps a plain click on a deduped cutsite marker routed to cutsiteClicked", async () => {
    const cutsites = [
      { id: "a", name: "VpaKutJI", start: 10, end: 14, topSnipPosition: 11 },
      { id: "b", name: "VpaK11BI", start: 10, end: 14, topSnipPosition: 11 }
    ];
    const { container, props, cleanup } = await renderPanel({
      sequenceData: makeSequenceData({ cutsites })
    });
    const markers = [...container.querySelectorAll(
      ".genecode-sequence-hit-region line.genecode-sequence-cutsite-marker"
    )];
    expect(markers).toHaveLength(1);
    dispatchClick(markers[0], { clientX: 60, clientY: 60 });
    expect(props.cutsiteClicked).toHaveBeenCalledTimes(1);
    expect(props.cutsiteClicked.mock.calls[0][0].annotation.id).toBe("a");
    await cleanup();
  });
});

describe("SequencePanel readable annotation canvas", () => {
  it("uses the host's familiar enzyme names for group labels and selection without mutating the input", async () => {
    const sequenceData = makeSequenceData({ cutsites: [
      { id: "rare", name: "Sse8387I", start: 10, end: 17, topSnipPosition: 16, bottomSnipPosition: 12 },
      { id: "common", name: "PstI", start: 11, end: 16, topSnipPosition: 16, bottomSnipPosition: 12 }
    ] });
    const before = JSON.stringify(sequenceData);
    const { container, props, cleanup } = await renderPanel({
      sequenceData, enzymeGroupsOverride: { "Common cloning": ["PstI"] }
    });
    const label = findLabelText(container, "PstI · 2酶");
    expect(label).not.toBeNull();
    dispatchClick(label);
    expect(props.cutsiteClicked.mock.calls[0][0].annotation.id).toBe("common");
    dispatchDblClick(label);
    expect(props.cutsiteDoubleClicked.mock.calls[0][0].annotation.isoschizomerNames).toEqual(["PstI", "Sse8387I"]);
    const marker = container.querySelector(".genecode-sequence-cutsite-visual");
    expect(marker.getAttribute("aria-label")).toContain("PstI");
    expect(JSON.stringify(sequenceData)).toBe(before);
    await cleanup();
  });

  it("truncates long feature labels without losing the full name or keyboard selection", async () => {
    const feature = {
      id: "long-feature", name: "A very long annotation name that must not escape its feature",
      start: 3, end: 12, forward: true, type: "CDS", color: "#338877"
    };
    const { container, props, cleanup } = await renderPanel({
      sequenceData: makeSequenceData({ features: [feature] }),
      selectionLayer: { start: 3, end: 12 }
    });
    const region = container.querySelector(".genecode-sequence-feature");
    expect(region.querySelector(".genecode-sequence-feature-label").textContent).toMatch(/…$/);
    expect(region.querySelector("title").textContent).toContain(feature.name);
    expect(region.getAttribute("aria-label")).toContain("4–13");
    expect(region.getAttribute("aria-pressed")).toBe("true");
    expect(region.querySelector("clipPath rect")).not.toBeNull();
    await act(async () => region.dispatchEvent(new window.KeyboardEvent("keydown", {
      key: "Enter", bubbles: true, cancelable: true
    })));
    expect(props.featureClicked).toHaveBeenCalledTimes(1);
    expect(props.featureClicked.mock.calls[0][0].annotation.id).toBe(feature.id);
    expect(props.editorClicked).not.toHaveBeenCalled();
    await cleanup();
  });

  it("shows a terminal arrow only where a forward feature actually ends", async () => {
    const { container, cleanup } = await renderPanel({
      sequenceData: makeSequenceData({
        sequence: "ATG".repeat(60), cutsites: [],
        features: [{ id: "spanning", name: "Spanning CDS", start: 3, end: 112, forward: true }]
      }),
      dimensions: { width: 800, height: 900 }
    });
    const segments = [...container.querySelectorAll('[data-annotation-id="spanning"]')];
    expect(segments.length).toBeGreaterThan(1);
    expect(segments[0].getAttribute("data-arrowhead")).toBe("false");
    expect(segments.at(-1).getAttribute("data-arrowhead")).toBe("true");
    expect(segments.filter(node => node.getAttribute("data-arrowhead") === "true")).toHaveLength(1);
    await cleanup();
  });

  it("expands dense labels and collapses by keyboard without changing editor data or selection", async () => {
    const sequenceData = makeSequenceData({
      features: [], cutsites: Array.from({ length: 35 }, (_, index) => ({
        id: `dense-${index}`, name: `Enzyme${index}`, start: index, end: index + 3,
        topSnipPosition: index + 1, bottomSnipPosition: index + 2
      }))
    });
    const before = JSON.stringify(sequenceData);
    const { container, props, cleanup } = await renderPanel({ sequenceData });
    const collapsedCount = container.querySelectorAll(".genecode-sequence-label-cutsites").length;
    const control = container.querySelector(".genecode-sequence-overflow-control");
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(collapsedCount).toBeLessThan(35);
    await act(async () => dispatchClick(control));
    expect(container.querySelectorAll(".genecode-sequence-label-cutsites")).toHaveLength(35);
    expect(control.getAttribute("aria-expanded")).toBe("true");
    await act(async () => control.dispatchEvent(new window.KeyboardEvent("keydown", {
      key: " ", bubbles: true, cancelable: true
    })));
    expect(container.querySelectorAll(".genecode-sequence-label-cutsites")).toHaveLength(collapsedCount);
    expect(props.editorClicked).not.toHaveBeenCalled();
    expect(props.selectionLayerUpdate).not.toHaveBeenCalled();
    expect(JSON.stringify(sequenceData)).toBe(before);
    await cleanup();
  });

  it("does not merge sites with the same top cut but different bottom cuts", async () => {
    const { container, cleanup } = await renderPanel({
      sequenceData: makeSequenceData({ cutsites: [
        { id: "a", name: "EnzymeA", start: 10, end: 15, topSnipPosition: 12, bottomSnipPosition: 14 },
        { id: "b", name: "EnzymeB", start: 10, end: 15, topSnipPosition: 12, bottomSnipPosition: 16 }
      ] })
    });
    expect(findLabelText(container, "EnzymeA")).not.toBeNull();
    expect(findLabelText(container, "EnzymeB")).not.toBeNull();
    expect(container.querySelectorAll(".genecode-sequence-cutsite-visual")).toHaveLength(2);
    await cleanup();
  });

  it("shows both strand markers for a focused blunt cut even when their boundary is identical", async () => {
    const { container, cleanup } = await renderPanel({
      sequenceData: makeSequenceData({ cutsites: [
        { id: "blunt", name: "Blunt", start: 10, end: 15, topSnipPosition: 13, bottomSnipPosition: 13 }
      ] })
    });
    const label = findLabelText(container, "Blunt").closest(".genecode-sequence-label-group");
    expect(container.querySelectorAll(".genecode-sequence-cutsite-marker")).toHaveLength(1);
    await act(async () => label.dispatchEvent(new window.FocusEvent("focusin", { bubbles: true })));
    expect(container.querySelectorAll(".genecode-sequence-cutsite-marker")).toHaveLength(2);
    expect(container.querySelector('[data-cut-strand="bottom"]').getAttribute("data-cut-position")).toBe("13");
    await cleanup();
  });
});
