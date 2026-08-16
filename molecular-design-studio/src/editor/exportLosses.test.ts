import { describe, it, expect } from "vitest";
import type { SequenceDocument, SequenceFeature } from "../types";
import { getExportLosses } from "./exportLosses";

function feature(
  name: string,
  type: string,
  start: number,
  end: number,
): SequenceFeature {
  return { id: `f-${name}`, name, type, start, end, strand: 1, qualifiers: {} };
}

function makeDoc(overrides: Partial<SequenceDocument> = {}): SequenceDocument {
  return {
    name: "pUC19",
    sequence: "A".repeat(100),
    circular: false,
    features: [],
    ...overrides,
  };
}

describe("getExportLosses", () => {
  it("returns no losses for GenBank (canonical model)", () => {
    const doc = makeDoc({
      circular: true,
      accession: "M77789.2",
      version: "2",
      features: [feature("ampR", "CDS", 0, 10)],
    });
    expect(getExportLosses(doc, "genbank")).toEqual([]);
  });

  it("flags features dropped by FASTA", () => {
    const doc = makeDoc({
      features: [feature("ampR", "CDS", 0, 10)],
    });
    const losses = getExportLosses(doc, "fasta");
    expect(losses.some((l) => l.field === "features")).toBe(true);
    expect(losses.find((l) => l.field === "features")!.description).toContain(
      "1 个特征注解",
    );
  });

  it("flags topology loss for circular documents in FASTA", () => {
    const losses = getExportLosses(makeDoc({ circular: true }), "fasta");
    expect(losses.some((l) => l.field === "topology")).toBe(true);
  });

  it("flags accession/version loss in FASTA", () => {
    const losses = getExportLosses(
      makeDoc({ accession: "M77789.2", version: "2" }),
      "fasta",
    );
    expect(losses.some((l) => l.field === "accession")).toBe(true);
    expect(losses.find((l) => l.field === "accession")!.description).toContain(
      "M77789.2",
    );
  });

  it("flags accession/version loss in SnapGene but not features", () => {
    const doc = makeDoc({
      accession: "M77789.2",
      version: "2",
      features: [feature("ampR", "CDS", 0, 10)],
    });
    const losses = getExportLosses(doc, "snapgene");
    expect(losses.some((l) => l.field === "accession")).toBe(true);
    expect(losses.some((l) => l.field === "features")).toBe(false);
  });

  it("is silent for a bare sequence exported to FASTA", () => {
    expect(getExportLosses(makeDoc(), "fasta")).toEqual([]);
    expect(getExportLosses(makeDoc(), "snapgene")).toEqual([]);
  });
});
