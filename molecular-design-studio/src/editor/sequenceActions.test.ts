import { describe, expect, it } from "vitest";
import type { SequenceDocument, SequenceSelection } from "../types";
import {
  extractSelectionDocument,
  gcPercent,
  reverseComplement,
  translateSequence,
} from "./sequenceActions";

const makeSelection = (
  overrides: Partial<SequenceSelection> = {},
): SequenceSelection => ({
  start: 3,
  end: 9,
  length: 6,
  wrapsOrigin: false,
  sequence: "ATGGCC",
  ...overrides,
});

describe("sequenceActions", () => {
  it("reverse complements ambiguous DNA bases", () => {
    expect(reverseComplement("ATGCRY")).toBe("RYGCAT");
  });

  it("translates DNA and RNA in the requested frame", () => {
    expect(translateSequence("ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG")).toBe(
      "MAIVMGR*KGAR*",
    );
    expect(translateSequence("AUGGCC")).toBe("MA");
    expect(translateSequence("AATGGCC", 1)).toBe("MA");
  });

  it("calculates GC percentage", () => {
    expect(gcPercent("GGAT")).toBe(50);
    expect(gcPercent("")).toBe(0);
  });

  it("extracts a linear selection and rebases contained features", () => {
    const doc: SequenceDocument = {
      name: "vector",
      sequence: "AAAATGGCCCCC",
      circular: true,
      features: [
        {
          id: "inside",
          name: "CDS",
          type: "CDS",
          start: 4,
          end: 8,
          strand: 1,
          qualifiers: {},
        },
        {
          id: "outside",
          name: "outside",
          type: "misc_feature",
          start: 0,
          end: 2,
          strand: 1,
          qualifiers: {},
        },
      ],
    };

    const extracted = extractSelectionDocument(doc, makeSelection());
    expect(extracted.sequence).toBe("ATGGCC");
    expect(extracted.circular).toBe(false);
    expect(extracted.features).toHaveLength(1);
    expect(extracted.features[0]).toMatchObject({ start: 1, end: 5 });
  });

  it("rebases features from both sides of a circular origin selection", () => {
    const doc: SequenceDocument = {
      name: "circle",
      sequence: "AAAACCCCGGGG",
      circular: true,
      features: [
        { id: "tail", name: "tail", type: "misc", start: 9, end: 12, strand: 1, qualifiers: {} },
        { id: "head", name: "head", type: "misc", start: 0, end: 2, strand: 1, qualifiers: {} },
      ],
    };
    const selection = makeSelection({
      start: 8,
      end: 3,
      length: 7,
      wrapsOrigin: true,
      sequence: "GGGGAAA",
    });

    const extracted = extractSelectionDocument(doc, selection);
    expect(extracted.features).toEqual([
      expect.objectContaining({ id: "tail", start: 1, end: 4 }),
      expect.objectContaining({ id: "head", start: 4, end: 6 }),
    ]);
  });
});
