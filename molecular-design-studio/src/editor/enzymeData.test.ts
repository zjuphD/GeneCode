import { describe, it, expect } from "vitest";
import {
  TYPE_IIS_SITES,
  GOLDEN_GATE_ENZYMES,
  COMMON_CLONING_ENZYMES,
  COMMON_TYPE_IIS_ENZYMES,
  DEFAULT_GOLDEN_GATE_ENZYME,
  getTypeIisEnzyme,
  canonicalEnzymeName,
} from "./enzymeData";

describe("enzymeData (A-ALG-002 single source of truth)", () => {
  it("exposes the six Type IIS recognition sites", () => {
    expect(TYPE_IIS_SITES).toEqual({
      BsaI: "GGTCTC",
      BsmBI: "CGTCTC",
      Esp3I: "CGTCTC",
      SapI: "GCTCTTC",
      BbsI: "GAAGAC",
      AarI: "CACCTGC",
    });
  });

  it("golden gate group covers all Type IIS entries", () => {
    expect([...GOLDEN_GATE_ENZYMES].sort()).toEqual(
      ["AarI", "BbsI", "BsaI", "BsmBI", "Esp3I", "SapI"].sort(),
    );
    for (const name of GOLDEN_GATE_ENZYMES) {
      expect(getTypeIisEnzyme(name)).toBeDefined();
    }
  });

  it("carries cut positions for double-strand digestion", () => {
    const bsai = getTypeIisEnzyme("BsaI")!;
    expect(bsai.cutsTop).toEqual([7]);
    expect(bsai.cutsBottom).toEqual([11]);
    expect(bsai.overhangLength).toBe(4);
    expect(bsai.aliases).toContain("Eco31I");

    const bbsi = getTypeIisEnzyme("BbsI")!;
    expect(bbsi.cutsTop).toEqual([8]);
    expect(bbsi.cutsBottom).toEqual([12]);

    const aari = getTypeIisEnzyme("AarI")!;
    expect(aari.cutsTop).toEqual([12]);
    expect(aari.cutsBottom).toEqual([16]);
  });

  it("resolves aliases to their canonical enzyme", () => {
    expect(canonicalEnzymeName("Esp3I")).toBe("BsmBI");
    expect(canonicalEnzymeName("BsaI")).toBe("BsaI");
  });

  it("common cloning group matches the engine menu", () => {
    expect(COMMON_CLONING_ENZYMES).toContain("EcoRI");
    expect(COMMON_CLONING_ENZYMES).toContain("XhoI");
    expect(COMMON_CLONING_ENZYMES.length).toBe(13);
  });

  it("setup-panel enzyme subset and default are stable", () => {
    expect([...COMMON_TYPE_IIS_ENZYMES]).toEqual(["BsaI", "BsmBI", "Esp3I", "SapI"]);
    expect(DEFAULT_GOLDEN_GATE_ENZYME).toBe("BsaI");
  });
});
