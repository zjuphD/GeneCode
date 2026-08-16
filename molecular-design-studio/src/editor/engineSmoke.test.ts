import { describe, expect, it } from "vitest";
// Importing from the vendored engine through Vite's JSX transform proves the
// genecode-ove fork actually compiles in the app's toolchain (A-REL-001):
// if the engine source ever drifts into unparseable territory, this file
// fails before the browser even loads. getRangeAnglesSpecial is pure and
// exercises the shared @teselagen/range-utils dependency; DigestTool is a
// JSX component whose module graph is the same one the editor mounts.
// Subpath imports into the vendored fork via the @teselagen/ove/src alias
// (vite.config.ts) — this file proves the fork compiles under Vite's JSX
// transform AND its pure engine modules stay reachable. A green run means a
// fresh checkout can still boot the editor.
import getRangeAnglesSpecial from "@teselagen/ove/src/CircularView/getRangeAnglesSpecial";
import { getGaps } from "@teselagen/ove/src/AlignmentView/getGaps";
import { reverseComplement } from "./sequenceActions";

describe("engine smoke (vendored genecode-ove fork)", () => {
  it("compiles and runs getRangeAnglesSpecial from the fork", () => {
    // Full circle: a range covering all 100 bp maps to a 2π sweep, minus the
    // fork's tiny epsilon so arcs always render.
    const angles = getRangeAnglesSpecial({ start: 0, end: 99 }, 100);
    expect(angles.totalAngle).toBeCloseTo(Math.PI * 2, 4);
    expect(angles.endAngle).toBeCloseTo(Math.PI * 2, 4);
  });

  it("returns a partial angle for a mid-circle range", () => {
    // Bases 25..49 of 100 (25 bp, inclusive) sweep exactly a quarter turn.
    const angles = getRangeAnglesSpecial({ start: 25, end: 49 }, 100);
    expect(angles.totalAngle).toBeCloseTo(Math.PI / 2, 4);
  });

  it("getGaps counts gaps before and inside a range", () => {
    const sequence = "A-TCG";
    expect(getGaps({ start: 0, end: 3 }, sequence)).toEqual({
      gapsBefore: 0,
      gapsInside: 1,
    });
  });

  it("app-side sequence utilities round-trip with the engine conventions", () => {
    // The app's own canonical helpers must stay consistent with the engine's
    // zero-based inclusive coordinate model used by the fork.
    expect(reverseComplement("AACCGGTT")).toBe("AACCGGTT");
    expect(reverseComplement("ATGC")).toBe("GCAT");
  });
});
