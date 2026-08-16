import { describe, expect, it } from "vitest";
import type { SequenceDocument } from "../types";
import {
  findTypeIisCutSites,
  simulateAssembly,
  simulateGibson,
  simulateGoldenGate,
} from "./assembly";

function makeVector(sequence = "GGGGCCCCAAAATTTTGGGGCCCC", circular = true): SequenceDocument {
  return {
    name: "Vector",
    sequence,
    circular,
    features: [
      { id: "v1", name: "ampR", type: "gene", start: 2, end: 6, strand: 1, qualifiers: {} },
      { id: "v2", name: "ori", type: "rep_origin", start: 10, end: 14, strand: -1, qualifiers: {} },
    ],
  };
}

function makeInsert(sequence = "ACGTACGTACGT", name = "Insert"): SequenceDocument {
  return {
    name,
    sequence,
    circular: false,
    features: [
      { id: "i1", name: "gfp", type: "CDS", start: 1, end: 5, strand: 1, qualifiers: {} },
    ],
  };
}

describe("simulateGibson", () => {
  it("joins linear vector and insert without duplicating bases", () => {
    const vector = makeVector("GGGGCCCCAAAATTTT", false);
    const insert = makeInsert("ACGTACGT");
    // insertAt 0 = front insertion on a linear vector
    const result = simulateGibson(vector, insert, 0);
    expect(result.ok).toBe(true);
    expect(result.construct?.sequence).toBe("ACGTACGTGGGGCCCCAAAATTTT");
    expect(result.construct?.circular).toBe(false);
    expect(result.construct?.name).toContain("Insert");
  });

  it("inserts into a circular vector by rotating at the cut point", () => {
    const vector = makeVector("GGGGCCCCAAAATTTT", true); // 16 bp
    const insert = makeInsert("TT");
    // Cut at position 4. The linearized molecule starts at the cut
    // (CCCCAAAATTTTGGGG); the insert lands at the cut junction (the end of the
    // linearized vector), which is the same circular molecule as any rotation.
    const result = simulateGibson(vector, insert, 4);
    expect(result.ok).toBe(true);
    expect(result.construct?.sequence).toBe("CCCCAAAATTTTGGGGTT");
  });

  it("auto-derives homology arms from the vector ends", () => {
    const vector = makeVector("GGGGCCCCAAAATTTT", false);
    const insert = makeInsert("ACGT");
    const result = simulateGibson(vector, insert, 0);
    const left = result.junctions.find((j) => j.side === "left");
    const right = result.junctions.find((j) => j.side === "right");
    expect(left?.overlap).toBe("GGGGCCCCAAAATTTT"); // last 20 → whole 16 bp linear
    expect(right?.overlap).toBe("GGGGCCCCAAAATTTT"); // first 20 → whole 16 bp linear
  });

  it("warns when a user arm does not match the vector end", () => {
    const vector = makeVector("GGGGCCCCAAAATTTT", false);
    const insert = makeInsert("ACGT");
    const result = simulateGibson(vector, insert, 0, {
      leftArm: "TTTTAAAAACCCCCCCC",
      rightArm: "GGGG",
    });
    const match = result.checks.find((check) => check.key === "left-match");
    expect(match?.status).toBe("warning");
    expect(result.construct?.sequence).toBe("ACGTGGGGCCCCAAAATTTT");
  });

  it("offsets insert features and flags a constructed insert region", () => {
    const vector = makeVector("GGGGCCCC", false);
    const insert = makeInsert("ACGTACGT");
    // insertAt 8 = append at the end of the 8-bp linear vector
    const result = simulateGibson(vector, insert, 8);
    const insertFeature = result.construct?.features.find((f) => f.name === "Insert: Insert");
    expect(insertFeature).toBeDefined();
    expect(insertFeature?.start).toBe(8);
    expect(insertFeature?.end).toBe(16);
    const gfp = result.construct?.features.find((f) => f.id === "i1");
    expect(gfp?.start).toBe(9);
    expect(gfp?.end).toBe(13);
  });

  it("splices the insert at a mid-sequence position on a linear vector", () => {
    const vector = makeVector("GGGGCCCCAAAATTTT", false);
    const insert = makeInsert("TT");
    const result = simulateGibson(vector, insert, 8);
    expect(result.ok).toBe(true);
    expect(result.construct?.sequence).toBe("GGGGCCCC" + "TT" + "AAAATTTT");
    const insertFeature = result.construct?.features.find((f) => f.name.startsWith("Insert:"));
    expect(insertFeature?.start).toBe(8);
    expect(insertFeature?.end).toBe(10);
  });

  it("drops vector features crossing the cut and warns", () => {
    // ori spans 10–14; cutting at 12 splits it
    const vector = makeVector("GGGGCCCCAAAATTTTGGGGCCCC", true); // 24 bp
    const insert = makeInsert("TT");
    const result = simulateGibson(vector, insert, 12);
    const dropped = result.construct?.features.some((f) => f.id === "v2");
    expect(dropped).toBe(false);
    expect(result.checks.some((check) => check.key === "features-cross-cut")).toBe(true);
  });

  it("maps features fully before the cut to the molecule tail on circular vectors", () => {
    // ampR [2,6) is entirely before cut 12 → appears at the tail [14,18)
    // instead of being dropped.
    const vector = makeVector("GGGGCCCCAAAATTTTGGGGCCCC", true); // 24 bp
    const insert = makeInsert("TT");
    const result = simulateGibson(vector, insert, 12);
    const amp = result.construct?.features.find((f) => f.id === "v1");
    expect(amp?.start).toBe(14);
    expect(amp?.end).toBe(18);
  });

  it("rejects an empty insert", () => {
    const result = simulateGibson(makeVector("GGGG", false), makeInsert(""), 0);
    expect(result.ok).toBe(false);
    expect(result.construct).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("simulateGoldenGate", () => {
  it("derives strand-aware Type IIS cuts and a remapped strict construct", () => {
    // Reverse-oriented BsaI at 10..16 cuts before its motif (top=5); the
    // forward-oriented site at 24..30 cuts after its motif (top=31). This is
    // the outward-facing pair used to excise the middle fragment.
    const sequence = "AAAAA" + "AAAAA" + "GAGACC" + "AAAAAAAA" + "GGTCTC" + "TTTTT";
    const vector = makeVector(sequence, false);
    const sites = findTypeIisCutSites(sequence, "BsaI");
    expect(sites.map((site) => [site.orientation, site.cutTop])).toEqual([
      [-1, 5],
      [1, 31],
    ]);
    const result = simulateGoldenGate(vector, makeInsert("CCCC"), 15, {
      enzyme: "BsaI",
      leftOverhang: "AAAA",
      rightOverhang: "TTTT",
      strict: true,
    });
    expect(result.ok).toBe(true);
    expect(result.goldenGateGraph?.validated).toBe(true);
    expect(result.construct?.sequence).toBe("AAAAACCCCTTTT");
    expect(result.goldenGateGraph?.fragments.map((fragment) => fragment.source)).toEqual([
      "vector",
      "insert",
    ]);
    expect(result.construct?.features.some((feature) => feature.name === "Insert: Insert")).toBe(true);
  });

  it("blocks strict mode when the vector does not contain a real cut pair", () => {
    const result = simulateGoldenGate(makeVector("GGGGCCCC", false), makeInsert("ACGT"), 0, {
      enzyme: "BsaI",
      leftOverhang: "AATG",
      rightOverhang: "TCCA",
      strict: true,
    });
    expect(result.ok).toBe(false);
    expect(result.construct).toBeNull();
    expect(result.errors[0]).toContain("requires exactly two recognition sites");
  });

  it("keeps same-direction Type IIS sites review-only", () => {
    const vector = makeVector("AAAAAAAAAAGGTCTCAAAAAAAAAAAAGGTCTCCCCCCCCCCCC", false);
    const result = simulateGoldenGate(vector, makeInsert("CCCC"), 20, {
      enzyme: "BsaI",
      leftOverhang: "AAAA",
      rightOverhang: "TTTT",
      strict: true,
    });
    expect(result.ok).toBe(false);
    expect(result.construct).toBeNull();
    expect(result.errors[0]).toContain("outward-facing");
  });

  it("joins with the given overhangs and reports complementary junctions", () => {
    const vector = makeVector("GGGGCCCCAAAATTTT", false);
    const insert = makeInsert("ACGTACGT");
    const result = simulateGoldenGate(vector, insert, 0, {
      enzyme: "BsaI",
      leftOverhang: "AATG",
      rightOverhang: "TCCA",
    });
    expect(result.ok).toBe(true);
    expect(result.construct?.sequence).toBe("ACGTACGTGGGGCCCCAAAATTTT");
    const left = result.junctions.find((j) => j.side === "left");
    expect(left?.overlap).toContain("AATG");
    expect(left?.overlap).toContain("CATT"); // rc(AATG)
  });

  it("warns about internal BsaI sites in the insert", () => {
    const vector = makeVector("GGGG", false);
    const insert = makeInsert("AAGGTCTCAATT");
    const result = simulateGoldenGate(vector, insert, 0, {
      enzyme: "BsaI",
      leftOverhang: "AATG",
      rightOverhang: "TCCA",
    });
    const check = result.checks.find((c) => c.key === "gg-internal-site");
    expect(check?.status).toBe("warning");
    expect(check?.detail).toContain("1 internal");
  });

  it("fails the check when a known enzyme's overhang length is wrong", () => {
    const result = simulateGoldenGate(makeVector("GGGG", false), makeInsert("ACGT"), 0, {
      enzyme: "SapI", // SapI exposes a 3 bp overhang, not a BsaI-style 4 bp end.
      leftOverhang: "AATG",
      rightOverhang: "TCCA",
    });
    const left = result.checks.find((check) => check.key === "left-enzyme-length");
    const right = result.checks.find((check) => check.key === "right-enzyme-length");
    expect(left?.status).toBe("failed");
    expect(right?.status).toBe("failed");
    expect(left?.detail).toContain("SapI exposes a 3 bp overhang");
    // The simulator still returns the sequence preview; the failed check is
    // the explicit safety gate consumed by the wizard before any application.
    expect(result.ok).toBe(true);
  });

  it("shifts downstream vector features past a mid-vector insert (A-BIO-003)", () => {
    // Linear vector with a feature [7,9); inserting 4 bp at position 3 must
    // move that feature to [11,13) instead of leaving stale coordinates.
    const vector: SequenceDocument = {
      name: "lin",
      sequence: "AAAAAAAAAAAAAAAAAA",
      circular: false,
      features: [{ id: "v3", name: "marker", type: "gene", start: 7, end: 9, strand: 1, qualifiers: {} }],
    };
    const insert = makeInsert("TTTT");
    const result = simulateGibson(vector, insert, 3);
    const marker = result.construct?.features.find((f) => f.id === "v3");
    expect(marker?.start).toBe(11);
    expect(marker?.end).toBe(13);
  });

  it("remaps a multi-segment feature coherently through a linear insert (A-BIO-004)", () => {
    const vector = makeVector("GGGGCCCCAAAATTTTGGGGCCCC", false);
    const wrapped: SequenceDocument = {
      name: "Vector",
      sequence: vector.sequence,
      circular: false,
      features: [
        {
          id: "join",
          name: "joinFeature",
          type: "gene",
          start: 2,
          end: 6,
          strand: 1,
          qualifiers: {},
          // Two pieces: one before the insert, one after.
          segments: [
            { start: 2, end: 6 },
            { start: 10, end: 14 },
          ],
        },
      ],
    };
    // Insert the 12 bp insert at position 8: piece [2,6) is before the cut
    // (unchanged), piece [10,14) is after the cut and shifts by 12.
    const result = simulateGibson(wrapped, makeInsert(), 8);
    expect(result.ok).toBe(true);
    const construct = result.construct!;
    const feature = construct.features.find((f) => f.id === "join");
    expect(feature).toBeDefined();
    expect(feature!.segments).toEqual([
      { start: 2, end: 6 },
      { start: 22, end: 26 },
    ]);
    expect(feature!.start).toBe(2);
    expect(feature!.end).toBe(26);
  });

  it("grows a feature spanning the insertion point to contain the insert (A-BIO-003)", () => {
    const vector: SequenceDocument = {
      name: "lin2",
      sequence: "AAAAAAAACCCCGGGG",
      circular: false,
      features: [{ id: "v4", name: "span", type: "gene", start: 4, end: 12, strand: 1, qualifiers: {} }],
    };
    const insert = makeInsert("TT");
    const result = simulateGibson(vector, insert, 8);
    const span = result.construct?.features.find((f) => f.id === "v4");
    expect(span?.start).toBe(4);
    expect(span?.end).toBe(14); // 12 + 2 insert bases
  });

  it("counts tandem internal BsaI sites individually (A-BIO-003)", () => {
    const vector = makeVector("GGGG", false);
    const insert = makeInsert("AAGGTCTCGGTCTCAATT");
    const result = simulateGoldenGate(vector, insert, 0, {
      enzyme: "BsaI",
      leftOverhang: "AATG",
      rightOverhang: "TCCA",
    });
    const check = result.checks.find((c) => c.key === "gg-internal-site");
    expect(check?.status).toBe("warning");
    expect(check?.detail).toContain("2 internal");
  });

  it("flags a missing overhang as failed", () => {
    const result = simulateGoldenGate(makeVector("GGGG", false), makeInsert("ACGT"), 0, {
      enzyme: "BsaI",
      leftOverhang: "AATG",
      rightOverhang: "",
    });
    expect(result.checks.some((c) => c.key === "right-missing" && c.status === "failed")).toBe(true);
    // Construct still assembles (missing overhang is a warning-level validation)
    expect(result.ok).toBe(true);
  });

  it("warns on self-complementary overhangs", () => {
    const result = simulateGoldenGate(makeVector("GGGG", false), makeInsert("ACGT"), 0, {
      enzyme: "BsaI",
      leftOverhang: "GCGC", // reverse-complement palindrome → self-complementary
      rightOverhang: "AATG",
    });
    expect(result.checks.some((c) => c.key === "left-selfcomp" && c.status === "warning")).toBe(true);
  });

  it("skips internal-site checks for unknown enzymes with an info note", () => {
    const result = simulateGoldenGate(makeVector("GGGG", false), makeInsert("ACGT"), 0, {
      enzyme: "FokI",
      leftOverhang: "AATG",
      rightOverhang: "TCCA",
    });
    expect(result.checks.some((c) => c.key === "gg-enzyme-unknown" && c.status === "info")).toBe(true);
    expect(result.checks.some((c) => c.key === "gg-internal-site")).toBe(false);
  });
});

describe("simulateAssembly", () => {
  it("dispatches to the selected method", () => {
    const gibson = simulateAssembly({
      vector: makeVector("GGGG", false),
      insert: makeInsert("ACGT"),
      method: "gibson",
    });
    expect(gibson.ok).toBe(true);
    const gg = simulateAssembly({
      vector: makeVector("GGGG", false),
      insert: makeInsert("ACGT"),
      method: "golden_gate",
      goldenGate: { enzyme: "BsaI", leftOverhang: "AATG", rightOverhang: "TCCA" },
    });
    expect(gg.ok).toBe(true);
  });

  it("clamps an out-of-range insertAt", () => {
    const result = simulateAssembly({
      vector: makeVector("GGGGCCCC", true),
      insert: makeInsert("TT"),
      method: "gibson",
      insertAt: 9999,
    });
    expect(result.ok).toBe(true);
    expect(result.construct?.sequence.length).toBe(10);
  });
});
