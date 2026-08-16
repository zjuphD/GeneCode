import { describe, expect, it, vi } from "vitest";
import type { SequenceDocument, SequenceFeature } from "../types";
import {
  appendDocumentHistory,
  createDocumentHistoryEntry,
  MAX_DOCUMENT_HISTORY,
  diffDocuments,
  applyDocumentDelta,
  toPersistedHistoryEntry,
  fromPersistedHistoryEntry,
} from "./documentHistory";

const makeDoc = (sequence = "ATCG"): SequenceDocument => ({
  name: "test",
  sequence,
  circular: false,
  features: [],
});

describe("documentHistory", () => {
  it("does not create an entry for an unchanged document", () => {
    expect(
      createDocumentHistoryEntry(makeDoc(), makeDoc(), "No change", "manual"),
    ).toBeNull();
  });

  it("stores independent before and after snapshots", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const before = makeDoc("ATCG");
    const after = makeDoc("AAAA");
    const entry = createDocumentHistoryEntry(before, after, "Edit", "manual", 10)!;

    after.sequence = "CCCC";
    expect(entry.before.sequence).toBe("ATCG");
    expect(entry.after.sequence).toBe("AAAA");
    expect(entry.label).toBe("Edit");
    expect(entry.source).toBe("manual");
  });

  it("diffDocuments returns null for identical documents", () => {
    const doc = makeDoc("ATCG");
    expect(diffDocuments(doc, { ...doc })).toBeNull();
  });

  it("diff/apply round-trips a point mutation", () => {
    const before = makeDoc("AACCGGTT");
    const after = { ...before, sequence: "AACCGGAA" };
    const delta = diffDocuments(before, after)!;
    expect(delta.sequence).toEqual({ prefixLen: 6, suffixLen: 0, middle: "AA" });
    expect(applyDocumentDelta(before, delta)).toEqual(after);
  });

  it("diff/apply round-trips an insertion in the middle", () => {
    const before = makeDoc("AACCGGTT");
    const after = { ...before, sequence: "AACCXXXGGTT" };
    const delta = diffDocuments(before, after)!;
    expect(delta.sequence).toEqual({ prefixLen: 4, suffixLen: 4, middle: "XXX" });
    expect(applyDocumentDelta(before, delta).sequence).toBe("AACCXXXGGTT");
  });

  it("diff/apply round-trips feature add/update/remove", () => {
    const gene: SequenceFeature = {
      id: "g1",
      name: "lacZ",
      type: "gene",
      start: 2,
      end: 6,
      strand: 1,
      qualifiers: {},
    };
    const before = makeDoc("AACCGGTT");
    before.features = [gene];
    const updated = { ...gene, name: "lacZ alpha" };
    const after: SequenceDocument = {
      ...before,
      features: [updated, { ...gene, id: "g2", name: "newGene" }],
    };
    const delta = diffDocuments(before, after)!;
    expect(delta.featureOps).toEqual([
      { kind: "update", feature: updated },
      { kind: "add", feature: expect.objectContaining({ id: "g2" }) },
    ]);
    expect(delta.featureOrder).toEqual(["g1", "g2"]);
    expect(applyDocumentDelta(before, delta)).toEqual(after);
  });

  it("diff/apply round-trips accession and version changes", () => {
    const before = { ...makeDoc("AACCGGTT"), accession: "M77789", version: "1" };
    const after = { ...before, accession: "M77789.2", version: "2" };
    const delta = diffDocuments(before, after)!;
    expect(delta.accession).toBe("M77789.2");
    expect(delta.version).toBe("2");
    expect(applyDocumentDelta(before, delta)).toEqual(after);
  });

  it("applyDocumentDelta tolerates malformed delta bounds without corrupting", () => {
    const before = makeDoc("AACCGGTT");
    const delta = { sequence: { prefixLen: 999, suffixLen: 999, middle: "X" } };
    const reconstructed = applyDocumentDelta(before, delta);
    expect(reconstructed.sequence.length).toBeLessThanOrEqual(before.sequence.length + 1);
    expect(reconstructed.sequence).toContain("X");
  });

  it("diff/apply round-trips feature removal and topology change", () => {
    const feature: SequenceFeature = {
      id: "ori",
      name: "ori",
      type: "rep_origin",
      start: 0,
      end: 4,
      strand: -1,
      qualifiers: {},
    };
    const before = makeDoc("AACCGGTT");
    before.features = [feature];
    const after = { ...before, features: [], circular: true };
    const delta = diffDocuments(before, after)!;
    expect(delta.featureOps).toEqual([{ kind: "remove", id: "ori" }]);
    expect(delta.circular).toBe(true);
    expect(applyDocumentDelta(before, delta)).toEqual(after);
  });

  it("persisted entry compaction round-trips a real history entry", () => {
    const before = makeDoc("AACCGGTT");
    const after = {
      ...before,
      sequence: "AACCGGTTTT",
      features: [
        { id: "f1", name: "gene", type: "gene", start: 2, end: 6, strand: 1, qualifiers: {} } as SequenceFeature,
      ],
    };
    const entry = createDocumentHistoryEntry(before, after, "Add feature", "annotation", 10)!;
    const persisted = toPersistedHistoryEntry(entry);
    // The persisted form stores ONE full doc + delta, not two full snapshots.
    expect(persisted.delta.sequence).toBeDefined();
    expect(persisted.delta.featureOps).toBeDefined();
    const restored = fromPersistedHistoryEntry(persisted);
    expect(restored.after).toEqual(after);
    expect(restored.before).toEqual(before);
    expect(restored.beforeHash).toBe(entry.beforeHash);
    expect(restored.afterHash).toBe(entry.afterHash);
  });

  it("keeps only the most recent history entries", () => {
    const history = Array.from({ length: MAX_DOCUMENT_HISTORY }, (_, index) =>
      createDocumentHistoryEntry(
        makeDoc(`A${index}`),
        makeDoc(`T${index}`),
        `Edit ${index}`,
        "manual",
        index,
      )!,
    );
    const next = createDocumentHistoryEntry(
      makeDoc("AAAA"),
      makeDoc("TTTT"),
      "Latest",
      "agent",
      100,
    );

    const appended = appendDocumentHistory(history, next);
    expect(appended).toHaveLength(MAX_DOCUMENT_HISTORY);
    expect(appended[0]!.label).toBe("Edit 1");
    expect(appended[appended.length - 1]!.label).toBe("Latest");
  });
});
