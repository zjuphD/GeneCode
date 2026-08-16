import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import type { ResultCandidate } from "../agent/responseTypes";
import type { SequenceDocument } from "../types";
import { canWritePrimerFeatures } from "./candidateWriteback";
import { CandidateCards } from "./CandidateCards";

const insertDoc: SequenceDocument = {
  name: "Insert",
  sequence: "AACCGGTT",
  circular: false,
  features: [],
};

const candidate = {
  coordinateSystem: "zero_based_half_open",
  bindingTarget: "insert",
  bindingTargetLength: 8,
  bindingStartForward: 0,
  bindingEndForward: 4,
  bindingStartReverse: 4,
  bindingEndReverse: 8,
  forwardCore: "AACC",
  reverseCore: "AACC",
} as ResultCandidate;

describe("canWritePrimerFeatures", () => {
  it("accepts coordinates only when the open document matches the insert", () => {
    expect(canWritePrimerFeatures(candidate, insertDoc)).toBe(true);
  });

  it("rejects write-back to a different open molecule", () => {
    expect(canWritePrimerFeatures(candidate, { ...insertDoc, sequence: "TTTTTTTT" })).toBe(false);
  });

  it("rejects legacy or ambiguous coordinate metadata", () => {
    expect(canWritePrimerFeatures({ ...candidate, coordinateSystem: null }, insertDoc)).toBe(false);
    expect(canWritePrimerFeatures({ ...candidate, bindingTarget: null }, insertDoc)).toBe(false);
  });

  it("rejects out-of-range coordinates", () => {
    expect(canWritePrimerFeatures({ ...candidate, bindingEndReverse: 9 }, insertDoc)).toBe(false);
  });

  it("saves primers with sequence and design metadata", () => {
    const onAddFeature = vi.fn();
    const completeCandidate = {
      ...candidate,
      title: "Candidate 1",
      summary: "Balanced primer pair",
      forwardPrimer: "GGGGAACC",
      reversePrimer: "CCCCAACC",
      tmForward: 61.2,
      tmReverse: 60.8,
      gcForward: 50,
      gcReverse: 50,
      sequenceRows: [],
      metrics: [],
      insertLength: 8,
      annealTemp: 58,
      extensionSec: 30,
      tmDelta: 0.4,
      fullLengthForward: 8,
      fullLengthReverse: 8,
      crossDimer: false,
    } as ResultCandidate;

    render(createElement(CandidateCards, {
      candidates: [completeCandidate],
      document: insertDoc,
      onAddFeature,
    }));
    fireEvent.click(screen.getByRole("button", { name: "将引物保存到打开的插入片段" }));

    expect(onAddFeature).toHaveBeenCalledTimes(2);
    expect(onAddFeature.mock.calls[0]?.[0]).toMatchObject({
      type: "primer",
      strand: 1,
      qualifiers: {
        direction: ["forward"],
        sequence: ["GGGGAACC"],
        binding_sequence: ["AACC"],
        tm: ["61.2"],
        gc_percent: ["50"],
      },
    });
    expect(onAddFeature.mock.calls[1]?.[0]).toMatchObject({
      strand: -1,
      qualifiers: { direction: ["reverse"], sequence: ["CCCCAACC"] },
    });
  });

  it("shows every primer pair for a multi-fragment assembly", () => {
    const multiFragmentCandidate = {
      title: "Multi-fragment Golden Gate candidate 1",
      summary: "Two ordered fragments",
      forwardPrimer: "A",
      reversePrimer: "T",
      tmForward: 60,
      tmReverse: 60,
      gcForward: 50,
      gcReverse: 50,
      fullLengthForward: 30,
      fullLengthReverse: 30,
      insertLength: 600,
      tmDelta: 0,
      crossDimer: false,
      raw: {
        method: "golden_gate",
        assembly_method: "Golden Gate / Type IIS · Multi-fragment",
        fragment_primers: [
          { fragmentName: "Promoter", f: "GGTCTCAATGAAA", r: "GGTCTCCGAGTTT", forwardOverhang: "AATG", reverseOverhang: "GCTT", tm_f: 60, tm_r: 59, gc_f: 50, gc_r: 52, full_length_f: 30, full_length_r: 31, quality: { cross_dimer: false } },
          { fragmentName: "ORF", f: "GGTCTC GCTTCCC", r: "GGTCTC CGAGAAA", forwardOverhang: "GCTT", reverseOverhang: "CGAG", tm_f: 61, tm_r: 60, gc_f: 48, gc_r: 50, full_length_f: 29, full_length_r: 30, quality: { cross_dimer: false } },
        ],
        construct_review: {
          method: "golden_gate",
          status: "passed",
          fragmentCount: 2,
          insert: { length: 600, fragmentCount: 2 },
          junctions: [],
          primerArchitecture: [],
          expectedConstruct: { available: false },
          checks: [],
        },
      },
    } as unknown as ResultCandidate;

    render(createElement(CandidateCards, { candidates: [multiFragmentCandidate] }));

    expect(screen.getByRole("region", { name: "多片段引物清单" })).not.toBeNull();
    expect(screen.getByText("Promoter")).not.toBeNull();
    expect(screen.getByText("ORF")).not.toBeNull();
    expect(screen.getByText("GCTT → CGAG")).not.toBeNull();
    expect(screen.getByText("每行对应一条片段 PCR；连接边界是 5′ assembly tail，订购时使用完整序列。")).not.toBeNull();
    expect(screen.queryByText("Forward primer")).toBeNull();
  });

  it("switches to and flashes the focused candidate", () => {
    const candidates = [
      { title: "Candidate A", forwardPrimer: "AAAACCCC", reversePrimer: "TTTTGGGG" },
      { title: "Candidate B", forwardPrimer: "GGGGCCCC", reversePrimer: "AAAATTTT" },
    ].map((candidate) => ({
      ...candidate,
      summary: null,
      tmForward: null,
      tmReverse: null,
      gcForward: null,
      gcReverse: null,
      fullLengthForward: null,
      fullLengthReverse: null,
      insertLength: null,
      tmDelta: null,
      crossDimer: null,
      annealTemp: null,
      extensionSec: null,
      sequenceRows: [],
      metrics: [],
    })) as unknown as ResultCandidate[];

    const { container, rerender } = render(createElement(CandidateCards, { candidates }));
    expect(container.querySelector(".agent-candidate__header")!.textContent).toContain("Candidate A");

    rerender(createElement(CandidateCards, { candidates, focusedIndex: 1, focusToken: 1 }));
    expect(container.querySelector(".agent-candidate__header")!.textContent).toContain("Candidate B");
    expect(container.querySelector(".agent-candidate--focused")).not.toBeNull();
  });

  it("ignores out-of-range focus requests", () => {
    const candidates = [{
      title: "Candidate A",
      summary: null,
      forwardPrimer: null,
      reversePrimer: null,
      tmForward: null,
      tmReverse: null,
      gcForward: null,
      gcReverse: null,
      fullLengthForward: null,
      fullLengthReverse: null,
      insertLength: null,
      tmDelta: null,
      crossDimer: null,
      annealTemp: null,
      extensionSec: null,
      sequenceRows: [],
      metrics: [],
    }] as unknown as ResultCandidate[];

    const { container } = render(createElement(CandidateCards, { candidates, focusedIndex: 5, focusToken: 1 }));
    expect(container.querySelector(".agent-candidate__header")!.textContent).toContain("Candidate A");
    expect(container.querySelector(".agent-candidate--focused")).toBeNull();
  });
});
