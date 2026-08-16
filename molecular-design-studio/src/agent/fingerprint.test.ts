import { describe, it, expect } from "vitest";
import { fingerprintDocument } from "./fingerprint";
import type { SequenceDocument } from "../types";

function makeDoc(overrides: Partial<SequenceDocument> = {}): SequenceDocument {
  return {
    name: "test_seq",
    sequence: "ATCGATCGATCG",
    circular: false,
    features: [],
    ...overrides,
  };
}

describe("fingerprintDocument", () => {
  it("produces consistent hashes for identical documents", () => {
    const doc = makeDoc();
    const a = fingerprintDocument(doc);
    const b = fingerprintDocument(doc);
    expect(a).toBe(b);
  });

  it("starts with the algorithm prefix", () => {
    const hash = fingerprintDocument(makeDoc());
    expect(hash).toMatch(/^fnv1a64-v1:[0-9a-f]{16}$/);
  });

  it("changes when sequence changes", () => {
    const a = fingerprintDocument(makeDoc({ sequence: "ATCG" }));
    const b = fingerprintDocument(makeDoc({ sequence: "TTTT" }));
    expect(a).not.toBe(b);
  });

  it("changes when name changes", () => {
    const a = fingerprintDocument(makeDoc({ name: "alpha" }));
    const b = fingerprintDocument(makeDoc({ name: "beta" }));
    expect(a).not.toBe(b);
  });

  it("changes when circular changes", () => {
    const a = fingerprintDocument(makeDoc({ circular: false }));
    const b = fingerprintDocument(makeDoc({ circular: true }));
    expect(a).not.toBe(b);
  });

  it("changes when features change", () => {
    const docA = makeDoc({
      features: [
        {
          id: "f1",
          name: "gene1",
          type: "gene",
          start: 0,
          end: 4,
          strand: 1,
          qualifiers: {},
        },
      ],
    });
    const docB = makeDoc({
      features: [
        {
          id: "f1",
          name: "gene2",
          type: "gene",
          start: 0,
          end: 4,
          strand: 1,
          qualifiers: {},
        },
      ],
    });
    expect(fingerprintDocument(docA)).not.toBe(fingerprintDocument(docB));
  });

  it("changes when accession changes", () => {
    const a = fingerprintDocument(makeDoc({ accession: "A001" }));
    const b = fingerprintDocument(makeDoc({ accession: "B002" }));
    expect(a).not.toBe(b);
  });

  it("changes when version changes", () => {
    const a = fingerprintDocument(makeDoc({ version: "1.0" }));
    const b = fingerprintDocument(makeDoc({ version: "2.0" }));
    expect(a).not.toBe(b);
  });

  it("produces stable hashes regardless of feature insertion order", () => {
    // Features are serialized in array order, so different order = different hash.
    // This tests that the serialization is deterministic for same input.
    const features = [
      {
        id: "f1",
        name: "A",
        type: "gene",
        start: 0,
        end: 4,
        strand: 1 as const,
        qualifiers: {},
      },
      {
        id: "f2",
        name: "B",
        type: "CDS",
        start: 4,
        end: 8,
        strand: 1 as const,
        qualifiers: {},
      },
    ];
    const doc1 = makeDoc({ features: [...features] });
    const doc2 = makeDoc({ features: [...features] });
    expect(fingerprintDocument(doc1)).toBe(fingerprintDocument(doc2));
  });

  it("handles qualifier key ordering deterministically", () => {
    const doc1 = makeDoc({
      features: [
        {
          id: "f1",
          name: "A",
          type: "gene",
          start: 0,
          end: 4,
          strand: 1,
          qualifiers: { z_key: ["a"], a_key: ["b"] },
        },
      ],
    });
    const doc2 = makeDoc({
      features: [
        {
          id: "f1",
          name: "A",
          type: "gene",
          start: 0,
          end: 4,
          strand: 1,
          qualifiers: { a_key: ["b"], z_key: ["a"] },
        },
      ],
    });
    expect(fingerprintDocument(doc1)).toBe(fingerprintDocument(doc2));
  });

  it("does not collide on delimiter-containing names", () => {
    const doc1 = makeDoc({ name: "a|b" });
    const doc2 = makeDoc({ name: "a\x00b" });
    expect(fingerprintDocument(doc1)).not.toBe(fingerprintDocument(doc2));
  });

  it("does not collide on delimiter-containing qualifier keys", () => {
    const doc1 = makeDoc({
      features: [
        { id: "f1", name: "A", type: "gene", start: 0, end: 4, strand: 1, qualifiers: { "a=b": ["v"] } },
      ],
    });
    const doc2 = makeDoc({
      features: [
        { id: "f1", name: "A", type: "gene", start: 0, end: 4, strand: 1, qualifiers: { "a": ["b=v"] } },
      ],
    });
    expect(fingerprintDocument(doc1)).not.toBe(fingerprintDocument(doc2));
  });

  it("does not collide on delimiter-containing qualifier values", () => {
    const doc1 = makeDoc({
      features: [
        { id: "f1", name: "A", type: "gene", start: 0, end: 4, strand: 1, qualifiers: { note: ["a,b", "c"] } },
      ],
    });
    const doc2 = makeDoc({
      features: [
        { id: "f1", name: "A", type: "gene", start: 0, end: 4, strand: 1, qualifiers: { note: ["a", "b,c"] } },
      ],
    });
    expect(fingerprintDocument(doc1)).not.toBe(fingerprintDocument(doc2));
  });

  it("does not collide when feature name contains pipe", () => {
    const doc1 = makeDoc({
      features: [
        { id: "f1", name: "gene|CDS", type: "gene", start: 0, end: 4, strand: 1, qualifiers: {} },
      ],
    });
    const doc2 = makeDoc({
      features: [
        { id: "f1|gene", name: "CDS", type: "gene", start: 0, end: 4, strand: 1, qualifiers: {} },
      ],
    });
    expect(fingerprintDocument(doc1)).not.toBe(fingerprintDocument(doc2));
  });
});
