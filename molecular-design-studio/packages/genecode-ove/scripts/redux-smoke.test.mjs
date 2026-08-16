import { describe, expect, it, vi } from "vitest";

vi.mock("@teselagen/ui", () => ({
  showContextMenu: vi.fn()
}));

describe("Genecode OVE Redux store isolation", () => {
  it("creates independent stores and keeps editor updates isolated", () => {
    return import("../src/createVectorEditor/makeStore.js").then(
      ({ default: makeStore }) => {
        const first = makeStore({ name: "genecode-smoke:first" });
        const second = makeStore({ name: "genecode-smoke:second" });

        expect(first).not.toBe(second);
        expect(first.getState().VectorEditor).not.toBe(
          second.getState().VectorEditor
        );

        first.dispatch({
          type: "VECTOR_EDITOR_UPDATE",
          payload: {
            sequenceData: {
              name: "first-sequence",
              sequence: "ATGC",
              size: 4
            }
          },
          meta: {
            editorName: "FirstEditor",
            mergeStateDeep: true,
            disregardUndo: true
          }
        });

        expect(
          first.getState().VectorEditor.FirstEditor.sequenceData.name
        ).toBe("first-sequence");
        expect(second.getState().VectorEditor.FirstEditor).toBeUndefined();

        second.dispatch({
          type: "VECTOR_EDITOR_UPDATE",
          payload: {
            sequenceData: {
              name: "second-sequence",
              sequence: "GCTA",
              size: 4
            }
          },
          meta: {
            editorName: "SecondEditor",
            mergeStateDeep: true,
            disregardUndo: true
          }
        });

        expect(
          second.getState().VectorEditor.SecondEditor.sequenceData.name
        ).toBe("second-sequence");
        expect(first.getState().VectorEditor.SecondEditor).toBeUndefined();
      }
    );
  });
});
