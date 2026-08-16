// Regression tests for A-ENG-002 (cutsite-cache capacity key).
//
// Upstream OVE mutated `editorState.editorSize = <count>` from a selector,
// but the per-editor combineReducers had no `editorSize` reducer, so it
// warned ("Unexpected key") and DROPPED the value — the cutsite cache always
// fell back to its default capacity 1. A-OVE-001 removed the mutation; this
// suite locks in the A-ENG-002 completion:
//   1. the reducer now registers `editorSize` (no warning, value preserved),
//   2. the capacity is threaded through as a selector argument — a naive
//      "read state.VectorEditor" inside the composed selector is wrong
//      because that selector receives the per-editor slice, so it would
//      always evaluate to 0 and silently disable the cache,
//   3. the cache actually respects the capacity (observable via object
//      identity of the returned result).
//
// NOTE on ordering: the cutsite results cache is a module-level singleton
// within this test file, and it can only shrink via eviction — there is no
// API to clear it. The capacity-1 eviction test therefore runs FIRST (on a
// fresh module cache), and every cache test uses unique sequences so leftover
// entries never collide with a later test's args.
import { describe, expect, it, vi } from "vitest";

// The redux stack transitively imports @teselagen/ui (only showContextMenu).
vi.mock("@teselagen/ui", () => ({
  showContextMenu: vi.fn()
}));

const { editorReducer } = await import("../src/redux/index.js");
const { cutsitesSelector, editorSizeSelector } = await import(
  "../src/selectors/cutsitesSelector.js"
);

describe("A-ENG-002: cutsite cache respects the capacity", () => {
  it("evicts the oldest result once capacity 1 is exceeded", () => {
    // Fresh module cache at file start → capacity 1 with exactly one entry
    // guarantees the second distinct args evict the first.
    const seqC = "GGCGGCGGCGGCGGCG";
    const seqD = "AAATTTAAATTTAAAT";
    const r1 = cutsitesSelector(seqC, false, [], {}, 1);
    const r2 = cutsitesSelector(seqD, false, [], {}, 1); // evicts seqC entry
    const r3 = cutsitesSelector(seqC, false, [], {}, 1); // miss -> recompute
    expect(r2).toBeDefined();
    expect(r3).not.toBe(r1);
  });

  it("keeps up to editorSize distinct results and reuses the cached object", () => {
    const seqA = "ACGTACGTACGTACGT";
    const seqB = "TTTTTTTTTTTTTTTT";
    const r1 = cutsitesSelector(seqA, false, [], {}, 2);
    const r2 = cutsitesSelector(seqB, false, [], {}, 2);
    const r3 = cutsitesSelector(seqA, false, [], {}, 2); // cache hit (capacity 2)
    expect(r3).toBe(r1); // same object identity == served from cache
    expect(r3.cutsitesArray).toEqual([]);
  });
});

describe("A-ENG-002: editorSize selector threading", () => {
  it("returns the editor count threaded as the third selector argument", () => {
    const editorState = { sequenceData: { sequence: "ACGT" } };
    expect(editorSizeSelector(editorState, undefined, 2)).toBe(2);
    expect(editorSizeSelector(editorState, undefined, 0)).toBe(0);
  });

  it("falls back to capacity 1 only when no count is passed", () => {
    expect(editorSizeSelector({}, undefined, undefined)).toBe(1);
  });

  it("ignores non-numeric third args (filteredCutsitesSelector forwards enzymeGroupsOverride)", () => {
    // filteredCutsitesSelector calls the composed cutsitesSelector with
    // (state, additionalEnzymes, enzymeGroupsOverride) — the third arg here
    // is an enzyme-groups object, never a capacity. A truthy object must not
    // become the cache capacity (which would break the eviction comparison).
    expect(
      editorSizeSelector({}, {}, { "Common Cloning": ["EcoRI"] })
    ).toBe(1);
  });
});

describe("A-ENG-002: editorSize reducer key registration", () => {
  it("initializes editorSize and passes a value through with no Unexpected-key warning", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const init = editorReducer({}, {});
    expect(init.editorSize).toBe(null);

    // Simulate a legacy state slice that carries an editorSize value: with the
    // key registered, combineReducers neither warns nor drops it.
    const next = editorReducer({ ...init, editorSize: 3 }, {
      type: "A_ENG_002_NOOP_ACTION"
    });
    expect(next.editorSize).toBe(3);
    expect(
      errSpy.mock.calls.some(args => String(args[0]).includes("Unexpected key"))
    ).toBe(false);
    errSpy.mockRestore();
  });
});
