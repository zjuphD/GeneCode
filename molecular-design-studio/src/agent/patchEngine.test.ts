import { describe, it, expect } from "vitest";
import { validatePatch, applyPatch, parseAndValidatePatch } from "./patchEngine";
import { fingerprintDocument } from "./fingerprint";
import type { SequenceDocument, SequenceFeature } from "../types";
import type { SequencePatch } from "./patchTypes";

// ── Helpers ─────────────────────────────────────────────────

function makeDoc(overrides: Partial<SequenceDocument> = {}): SequenceDocument {
  return {
    name: "test_seq",
    sequence: "ATCGATCGATCGATCG",
    circular: false,
    features: [],
    ...overrides,
  };
}

function makeFeature(
  overrides: Partial<SequenceFeature> = {},
): SequenceFeature {
  return {
    id: "feat-1",
    name: "test_feature",
    type: "misc_feature",
    start: 0,
    end: 4,
    strand: 1,
    qualifiers: {},
    ...overrides,
  };
}

function makePatch(
  doc: SequenceDocument,
  operations: SequencePatch["operations"],
  overrides: Partial<SequencePatch> = {},
): SequencePatch {
  return {
    schemaVersion: 1,
    id: "patch-1",
    title: "Test patch",
    summary: "A test patch",
    baseHash: fingerprintDocument(doc),
    operations,
    ...overrides,
  };
}

// ── Stable fingerprint ──────────────────────────────────────

describe("fingerprint", () => {
  it("identical documents hash identically", () => {
    const a = makeDoc();
    const b = makeDoc();
    expect(fingerprintDocument(a)).toBe(fingerprintDocument(b));
  });

  it("sequence change changes hash", () => {
    const a = makeDoc({ sequence: "AAAA" });
    const b = makeDoc({ sequence: "TTTT" });
    expect(fingerprintDocument(a)).not.toBe(fingerprintDocument(b));
  });

  it("feature change changes hash", () => {
    const a = makeDoc({ features: [makeFeature({ name: "A" })] });
    const b = makeDoc({ features: [makeFeature({ name: "B" })] });
    expect(fingerprintDocument(a)).not.toBe(fingerprintDocument(b));
  });
});

// ── Every operation kind ────────────────────────────────────

describe("validatePatch: operation kinds", () => {
  it("accepts a valid insert", () => {
    const doc = makeDoc();
    const patch = makePatch(doc, [
      { kind: "insert", id: "op1", reason: "test", position: 4, sequence: "TTTT" },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.sequence).toBe("ATCGTTTTATCGATCGATCG");
      expect(result.document.sequence.length).toBe(20);
    }
  });

  it("accepts a valid delete", () => {
    const doc = makeDoc({ sequence: "AAAATTTTGGGGCCCC" });
    const patch = makePatch(doc, [
      {
        kind: "delete",
        id: "op1",
        reason: "test",
        start: 4,
        end: 8,
        expectedSequence: "TTTT",
      },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.sequence).toBe("AAAAGGGGCCCC");
    }
  });

  it("accepts a valid replace", () => {
    const doc = makeDoc({ sequence: "AAAATTTTGGGGCCCC" });
    const patch = makePatch(doc, [
      {
        kind: "replace",
        id: "op1",
        reason: "test",
        start: 4,
        end: 8,
        expectedSequence: "TTTT",
        sequence: "CCCC",
      },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.sequence).toBe("AAAACCCCGGGGCCCC");
    }
  });

  it("accepts a valid add_feature", () => {
    const doc = makeDoc();
    const feat = makeFeature({ id: "new-feat", start: 0, end: 4 });
    const patch = makePatch(doc, [
      { kind: "add_feature", id: "op1", reason: "test", feature: feat },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.features).toHaveLength(1);
      expect(result.document.features[0]!.id).toBe("new-feat");
    }
  });

  it("accepts a valid remove_feature", () => {
    const doc = makeDoc({ features: [makeFeature({ id: "feat-1" })] });
    const patch = makePatch(doc, [
      { kind: "remove_feature", id: "op1", reason: "test", featureId: "feat-1" },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.features).toHaveLength(0);
    }
  });
});

// ── Sequential operations ───────────────────────────────────

describe("validatePatch: sequential operations", () => {
  it("adjusts coordinates for sequential inserts", () => {
    const doc = makeDoc({ sequence: "AAAAAAAA" });
    const patch = makePatch(doc, [
      { kind: "insert", id: "op1", reason: "first", position: 2, sequence: "CC" },
      { kind: "insert", id: "op2", reason: "second", position: 6, sequence: "GG" },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.sequence).toBe("AACCAAGGAAAA");
    }
  });
});

// ── Case-insensitive expected-sequence guard ─────────────────

describe("validatePatch: expectedSequence guard", () => {
  it("accepts case-insensitive match", () => {
    const doc = makeDoc({ sequence: "AAAATTTT" });
    const patch = makePatch(doc, [
      {
        kind: "delete",
        id: "op1",
        reason: "test",
        start: 0,
        end: 4,
        expectedSequence: "aaaa",
      },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(true);
  });

  it("rejects mismatched expectedSequence", () => {
    const doc = makeDoc({ sequence: "AAAATTTT" });
    const patch = makePatch(doc, [
      {
        kind: "delete",
        id: "op1",
        reason: "test",
        start: 0,
        end: 4,
        expectedSequence: "GGGG",
      },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("expectedSequence mismatch");
    }
  });
});

// ── IUPAC validation ────────────────────────────────────────

describe("validatePatch: IUPAC validation", () => {
  it("rejects non-IUPAC characters in insert", () => {
    const doc = makeDoc();
    const patch = makePatch(doc, [
      { kind: "insert", id: "op1", reason: "test", position: 0, sequence: "ATXG" },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("non-IUPAC");
    }
  });

  it("rejects non-IUPAC characters in replace", () => {
    const doc = makeDoc({ sequence: "AAAATTTT" });
    const patch = makePatch(doc, [
      {
        kind: "replace",
        id: "op1",
        reason: "test",
        start: 0,
        end: 4,
        expectedSequence: "AAAA",
        sequence: "XYZ!",
      },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(false);
  });

  it("accepts all standard IUPAC characters", () => {
    const doc = makeDoc();
    const patch = makePatch(doc, [
      { kind: "insert", id: "op1", reason: "test", position: 0, sequence: "ATGCRYSWKMBDHVN" },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(true);
  });
});

// ── Stale base hash ─────────────────────────────────────────

describe("validatePatch: stale base hash", () => {
  it("rejects patch with wrong baseHash", () => {
    const doc = makeDoc();
    const patch: SequencePatch = {
      schemaVersion: 1,
      id: "patch-1",
      title: "stale",
      summary: "wrong hash",
      baseHash: "fnv1a64-v1:0000000000000000",
      operations: [
        { kind: "insert", id: "op1", reason: "test", position: 0, sequence: "A" },
      ],
    };
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("baseHash");
    }
  });
});

// ── Duplicate operation IDs ─────────────────────────────────

describe("validatePatch: duplicate operation IDs", () => {
  it("rejects duplicate operation IDs", () => {
    const doc = makeDoc();
    const patch = makePatch(doc, [
      { kind: "insert", id: "dup", reason: "a", position: 0, sequence: "A" },
      { kind: "insert", id: "dup", reason: "b", position: 0, sequence: "T" },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("Duplicate operation IDs");
    }
  });
});

// ── Duplicate feature IDs ───────────────────────────────────

describe("validatePatch: duplicate feature IDs", () => {
  it("rejects adding a feature with an existing ID", () => {
    const doc = makeDoc({ features: [makeFeature({ id: "existing" })] });
    const patch = makePatch(doc, [
      {
        kind: "add_feature",
        id: "op1",
        reason: "test",
        feature: makeFeature({ id: "existing", start: 4, end: 8 }),
      },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("already exists");
    }
  });
});

// ── Atomic failure / no input mutation ───────────────────────

describe("validatePatch: atomic failure", () => {
  it("returns errors without producing a document", () => {
    const doc = makeDoc({ sequence: "AAAATTTT" });
    const patch = makePatch(doc, [
      {
        kind: "delete",
        id: "op1",
        reason: "fail",
        start: 0,
        end: 4,
        expectedSequence: "XXXX",
      },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("does not mutate the input document", () => {
    const original = makeDoc({ sequence: "AAAATTTTGGGG" });
    const doc = { ...original, features: [...original.features] };
    const patch = makePatch(doc, [
      { kind: "insert", id: "op1", reason: "test", position: 0, sequence: "CCCC" },
    ]);
    validatePatch({ patch, document: doc });
    expect(doc.sequence).toBe("AAAATTTTGGGG");
    expect(doc.features).toHaveLength(0);
  });
});

// ── Feature transformations ─────────────────────────────────

describe("validatePatch: feature transformations", () => {
  it("shifts feature right on insert before", () => {
    const doc = makeDoc({
      sequence: "AAAATTTT",
      features: [makeFeature({ id: "f1", start: 4, end: 8 })],
    });
    const patch = makePatch(doc, [
      { kind: "insert", id: "op1", reason: "test", position: 0, sequence: "CC" },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.features[0]!.start).toBe(6);
      expect(result.document.features[0]!.end).toBe(10);
    }
  });

  it("expands feature end on insert inside", () => {
    const doc = makeDoc({
      sequence: "AAAATTTT",
      features: [makeFeature({ id: "f1", start: 2, end: 6 })],
    });
    const patch = makePatch(doc, [
      { kind: "insert", id: "op1", reason: "test", position: 4, sequence: "CC" },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.features[0]!.start).toBe(2);
      expect(result.document.features[0]!.end).toBe(8);
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });

  it("removes feature on full deletion", () => {
    const doc = makeDoc({
      sequence: "AAAATTTT",
      features: [makeFeature({ id: "f1", start: 0, end: 4 })],
    });
    const patch = makePatch(doc, [
      {
        kind: "delete",
        id: "op1",
        reason: "test",
        start: 0,
        end: 4,
        expectedSequence: "AAAA",
      },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.features).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });

  it("clips feature start with exact coordinates", () => {
    // Feature [2, 8), deletion [0, 6) → surviving [6, 8) → new [0, 2)
    const doc = makeDoc({
      sequence: "AAAATTTTGGGG",
      features: [makeFeature({ id: "f1", start: 2, end: 8 })],
    });
    const patch = makePatch(doc, [
      {
        kind: "delete",
        id: "op1",
        reason: "test",
        start: 0,
        end: 6,
        expectedSequence: "AAAATT",
      },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.features[0]!.start).toBe(0);
      expect(result.document.features[0]!.end).toBe(2);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.affectedFeatures[0]!.action).toBe("transformed");
    }
  });

  it("clips feature end with exact coordinates", () => {
    // Feature [2, 8), deletion [5, 10) → surviving [2, 5) → stays [2, 5)
    const doc = makeDoc({
      sequence: "AAAATTTTGGGG",
      features: [makeFeature({ id: "f1", start: 2, end: 8 })],
    });
    const patch = makePatch(doc, [
      {
        kind: "delete",
        id: "op1",
        reason: "test",
        start: 5,
        end: 10,
        expectedSequence: "TTTGG",
      },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.features[0]!.start).toBe(2);
      expect(result.document.features[0]!.end).toBe(5);
    }
  });

  it("shrinks feature on deletion inside with exact coordinates", () => {
    // Feature [2, 10), deletion [4, 7) → [2, 7) after shift
    const doc = makeDoc({
      sequence: "AAAATTTTGGGGCCCC",
      features: [makeFeature({ id: "f1", start: 2, end: 10 })],
    });
    const patch = makePatch(doc, [
      {
        kind: "delete",
        id: "op1",
        reason: "test",
        start: 4,
        end: 7,
        expectedSequence: "TTT",
      },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.features[0]!.start).toBe(2);
      expect(result.document.features[0]!.end).toBe(7);
    }
  });

  it("transforms feature correctly through replace (delete-then-insert)", () => {
    // Feature [4, 8), replace [2, 6) with 6bp → delete shifts left, then insert shifts right
    const doc = makeDoc({
      sequence: "AAAATTTTGGGG",
      features: [makeFeature({ id: "f1", start: 4, end: 8 })],
    });
    const patch = makePatch(doc, [
      {
        kind: "replace",
        id: "op1",
        reason: "test",
        start: 2,
        end: 6,
        expectedSequence: "AATT",
        sequence: "CCCCCC",
      },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Delete [2,6): feature [4,8) clips end → [2,4) in deleted coords, then shifts
      // Insert 6bp at pos 2: feature shifts right by 6 → [8, 10)
      // Wait, let me trace: original [4,8), delete [2,6) len=4
      //   delStart=2 < f.start=4, delEnd=6 >= f.end=8? No, 6 < 8.
      //   So: delStart=2 <= f.start=4, delEnd=6 < f.end=8 → start clipping
      //   newStart=delStart=2, newEnd=f.end-delLen=8-4=4 → [2,4)
      // Then insert 6bp at pos 2: position=2 <= f.start=2 → shift right
      //   newStart=2+6=8, newEnd=4+6=10 → [8,10)
      expect(result.document.features[0]!.start).toBe(8);
      expect(result.document.features[0]!.end).toBe(10);
    }
  });
});

// ── Empty patch ─────────────────────────────────────────────

describe("validatePatch: empty patch", () => {
  it("rejects patch with no operations", () => {
    const doc = makeDoc();
    const patch = makePatch(doc, []);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("no operations");
    }
  });
});

// ── Unsupported schema version ──────────────────────────────

describe("validatePatch: schema version", () => {
  it("rejects unsupported schema version", () => {
    const doc = makeDoc();
    const patch: SequencePatch = {
      schemaVersion: 2 as 1,
      id: "p1",
      title: "bad",
      summary: "bad version",
      baseHash: fingerprintDocument(doc),
      operations: [],
    };
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("Unsupported schema version");
    }
  });
});

// ── Invalid coordinates ─────────────────────────────────────

describe("validatePatch: invalid coordinates", () => {
  it("rejects negative insert position", () => {
    const doc = makeDoc();
    const patch = makePatch(doc, [
      { kind: "insert", id: "op1", reason: "test", position: -1, sequence: "A" },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(false);
  });

  it("rejects insert position beyond sequence length", () => {
    const doc = makeDoc({ sequence: "AAAA" });
    const patch = makePatch(doc, [
      { kind: "insert", id: "op1", reason: "test", position: 10, sequence: "A" },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(false);
  });

  it("rejects delete with start >= end", () => {
    const doc = makeDoc({ sequence: "AAAA" });
    const patch = makePatch(doc, [
      {
        kind: "delete",
        id: "op1",
        reason: "test",
        start: 4,
        end: 2,
        expectedSequence: "AA",
      },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(false);
  });

  it("rejects empty insert sequence", () => {
    const doc = makeDoc();
    const patch = makePatch(doc, [
      { kind: "insert", id: "op1", reason: "test", position: 0, sequence: "" },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(false);
  });

  it("rejects empty replace sequence", () => {
    const doc = makeDoc({ sequence: "AAAA" });
    const patch = makePatch(doc, [
      {
        kind: "replace",
        id: "op1",
        reason: "test",
        start: 0,
        end: 2,
        expectedSequence: "AA",
        sequence: "",
      },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(false);
  });
});

// ── Normalization ───────────────────────────────────────────

describe("validatePatch: normalization", () => {
  it("uppercases inserted sequence", () => {
    const doc = makeDoc({ sequence: "AAAA" });
    const patch = makePatch(doc, [
      { kind: "insert", id: "op1", reason: "test", position: 0, sequence: "atcg" },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.sequence).toBe("ATCGAAAA");
    }
  });

  it("uppercases replacement sequence", () => {
    const doc = makeDoc({ sequence: "AAAATTTT" });
    const patch = makePatch(doc, [
      {
        kind: "replace",
        id: "op1",
        reason: "test",
        start: 0,
        end: 4,
        expectedSequence: "AAAA",
        sequence: "atcg",
      },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.sequence).toBe("ATCGTTTT");
    }
  });
});

// ── applyPatch ──────────────────────────────────────────────

describe("applyPatch", () => {
  it("returns same result as validatePatch for valid patch", () => {
    const doc = makeDoc();
    const patch = makePatch(doc, [
      { kind: "insert", id: "op1", reason: "test", position: 0, sequence: "TT" },
    ]);
    const vResult = validatePatch({ patch, document: doc });
    const aResult = applyPatch({ patch, document: doc });
    expect(vResult.ok).toBe(true);
    expect(aResult.ok).toBe(true);
    if (vResult.ok && aResult.ok) {
      expect(aResult.document.sequence).toBe(vResult.document.sequence);
    }
  });
});

// ── Missing feature for remove ──────────────────────────────

describe("validatePatch: missing feature", () => {
  it("rejects remove_feature for non-existent ID", () => {
    const doc = makeDoc();
    const patch = makePatch(doc, [
      { kind: "remove_feature", id: "op1", reason: "test", featureId: "nope" },
    ]);
    const result = validatePatch({ patch, document: doc });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("not found");
    }
  });
});

// ── Runtime schema boundary (parseAndValidatePatch) ─────────

describe("parseAndValidatePatch: malformed input", () => {
  const doc = makeDoc();

  it("rejects null input", () => {
    const result = parseAndValidatePatch(null, doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("non-null object");
    }
  });

  it("rejects undefined input", () => {
    const result = parseAndValidatePatch(undefined, doc);
    expect(result.ok).toBe(false);
  });

  it("rejects string input", () => {
    const result = parseAndValidatePatch("not a patch", doc);
    expect(result.ok).toBe(false);
  });

  it("rejects missing operations", () => {
    const result = parseAndValidatePatch({ schemaVersion: 1, id: "p1", title: "t", summary: "s", baseHash: "h" }, doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("non-empty array");
    }
  });

  it("rejects unknown operation kind", () => {
    const result = parseAndValidatePatch({
      schemaVersion: 1, id: "p1", title: "t", summary: "s", baseHash: "h",
      operations: [{ kind: "splice", id: "op1", reason: "test" }],
    }, doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("unsupported operation kind"))).toBe(true);
    }
  });

  it("rejects empty operation id", () => {
    const result = parseAndValidatePatch({
      schemaVersion: 1, id: "p1", title: "t", summary: "s", baseHash: "h",
      operations: [{ kind: "insert", id: "", reason: "test", position: 0, sequence: "A" }],
    }, doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("non-empty string"))).toBe(true);
    }
  });

  it("rejects empty operation reason", () => {
    const result = parseAndValidatePatch({
      schemaVersion: 1, id: "p1", title: "t", summary: "s", baseHash: "h",
      operations: [{ kind: "insert", id: "op1", reason: "", position: 0, sequence: "A" }],
    }, doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("reason"))).toBe(true);
    }
  });

  it("rejects null feature in add_feature", () => {
    const result = parseAndValidatePatch({
      schemaVersion: 1, id: "p1", title: "t", summary: "s", baseHash: "h",
      operations: [{ kind: "add_feature", id: "op1", reason: "test", feature: null }],
    }, doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("feature must be"))).toBe(true);
    }
  });

  it("rejects non-array qualifier values", () => {
    const result = parseAndValidatePatch({
      schemaVersion: 1, id: "p1", title: "t", summary: "s", baseHash: fingerprintDocument(doc),
      operations: [{
        kind: "add_feature", id: "op1", reason: "test",
        feature: { id: "f1", name: "F", type: "gene", start: 0, end: 4, strand: 1, qualifiers: { note: "bad" } },
      }],
    }, doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("qualifiers.note"))).toBe(true);
    }
  });

  it("rejects non-integer position in insert", () => {
    const result = parseAndValidatePatch({
      schemaVersion: 1, id: "p1", title: "t", summary: "s", baseHash: "h",
      operations: [{ kind: "insert", id: "op1", reason: "test", position: 1.5, sequence: "A" }],
    }, doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("integer"))).toBe(true);
    }
  });

  it("accepts a structurally valid patch and delegates to semantic validation", () => {
    const validInput = {
      schemaVersion: 1,
      id: "patch-1",
      title: "Test",
      summary: "A test patch",
      baseHash: fingerprintDocument(doc),
      operations: [
        { kind: "insert", id: "op1", reason: "add bases", position: 0, sequence: "AAAA" },
      ],
    };
    const result = parseAndValidatePatch(validInput, doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.ok).toBe(true);
      if (result.result.ok) {
        expect(result.result.document.sequence).toBe("AAAAATCGATCGATCGATCG");
      }
    }
  });
});
