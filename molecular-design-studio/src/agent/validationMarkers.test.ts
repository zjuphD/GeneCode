/**
 * Tests for the validation-result → sequence-coordinate marker resolver.
 */

import { describe, it, expect } from "vitest";
import { buildValidationMarkers } from "./validationMarkers";
import type { ResultCandidate } from "./responseTypes";

const SEQUENCE = "ATGCCGTAAGCGGCTAGCTAGCGATCGATCGTAGCTAG";
//                0         1         2         3
//                012345678901234567890123456789012345

function makeCandidate(overrides: Partial<ResultCandidate> = {}): ResultCandidate {
  return {
    title: "candidate",
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
    workspace: null,
    metrics: [],
    raw: {},
    ...overrides,
  };
}

describe("buildValidationMarkers", () => {
  it("returns no markers for empty validation results", () => {
    expect(buildValidationMarkers({
      validationResults: [],
      candidates: [],
      sequence: SEQUENCE,
      workspace: "rtqpcr",
    })).toHaveLength(0);
  });

  it("uses candidate binding positions for RT-qPCR primers", () => {
    const result = {
      f: "ATGCCGTAA",
      r: "GCTAGC",
      specificityCheck: { status: "Pass", summary: "specific" },
    };
    const candidate = makeCandidate({
      workspace: "rtqpcr",
      forwardPrimer: "ATGCCGTAA",
      reversePrimer: "GCTAGC",
      bindingStartForward: 0,
      bindingEndForward: 9,
      bindingStartReverse: 26,
      bindingEndReverse: 32,
      raw: { f: "ATGCCGTAA", r: "GCTAGC" },
    });
    const markers = buildValidationMarkers({
      validationResults: [result],
      candidates: [candidate],
      sequence: SEQUENCE,
      workspace: "rtqpcr",
    });
    expect(markers).toHaveLength(2);
    const fwd = markers.find((marker) => marker.label === "Forward primer");
    const rev = markers.find((marker) => marker.label === "Reverse primer");
    expect(fwd).toMatchObject({ start: 0, end: 9, tone: "pass" });
    expect(rev).toMatchObject({ start: 26, end: 32, tone: "pass" });
  });

  it("locates primers by sequence when no binding positions exist", () => {
    const result = {
      f: "ATGCCGTAA",
      r: "GCTAGC",
      specificityCheck: { status: "Warning", summary: "one off-target" },
    };
    const candidate = makeCandidate({
      workspace: "rtqpcr",
      forwardPrimer: "ATGCCGTAA",
      reversePrimer: "GCTAGC",
      raw: { f: "ATGCCGTAA", r: "GCTAGC" },
    });
    const markers = buildValidationMarkers({
      validationResults: [result],
      candidates: [candidate],
      sequence: SEQUENCE,
      workspace: "rtqpcr",
    });
    expect(markers).toHaveLength(2);
    const fwd = markers.find((marker) => marker.label === "Forward primer");
    const rev = markers.find((marker) => marker.label === "Reverse primer");
    expect(fwd).toMatchObject({ start: 0, end: 9, tone: "warning" });
    // "GCTAGC" first occurs at index 12 in the fixture sequence
    expect(rev).toMatchObject({ start: 12, end: 18 });
  });

  it("maps sgRNA guide sequence and fails closed with no coordinate", () => {
    const result = {
      seq: "GCTAGCTAGC",
      pam: "AGG",
      cut: 17,
      direction: "forward",
      genomeOfftargetCheck: { status: "High", summary: "two off-targets" },
    };
    const candidate = makeCandidate({
      workspace: "sgrna",
      raw: { seq: "GCTAGCTAGC", pam: "AGG" },
    });
    const markers = buildValidationMarkers({
      validationResults: [result],
      candidates: [candidate],
      sequence: SEQUENCE,
      workspace: "sgrna",
    });
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      label: "sgRNA guide",
      // "GCTAGCTAGC" first occurs at index 12 in the fixture sequence
      start: 12,
      end: 22,
      tone: "fail",
    });
  });

  it("skips candidates whose sequences are not present in the document", () => {
    const result = {
      f: "TTTTTTTTTT",
      r: "CCCCCCCCCC",
      specificityCheck: { status: "Pass" },
    };
    const candidate = makeCandidate({
      workspace: "rtqpcr",
      forwardPrimer: "TTTTTTTTTT",
      reversePrimer: "CCCCCCCCCC",
      raw: { f: "TTTTTTTTTT", r: "CCCCCCCCCC" },
    });
    const markers = buildValidationMarkers({
      validationResults: [result],
      candidates: [candidate],
      sequence: SEQUENCE,
      workspace: "rtqpcr",
    });
    expect(markers).toHaveLength(0);
  });

  it("maps siRNA target coordinates from the check result", () => {
    const result = {
      sense: "CGTAA",
      target_start: 4,
      target_end: 9,
      transcriptomeOfftargetCheck: { status: "Low", summary: "clean" },
    };
    const candidate = makeCandidate({
      workspace: "sirna",
      raw: { sense: "CGTAA" },
    });
    const markers = buildValidationMarkers({
      validationResults: [result],
      candidates: [candidate],
      sequence: SEQUENCE,
      workspace: "sirna",
    });
    expect(markers).toHaveLength(2);
    expect(markers.some((marker) => marker.label === "siRNA target region"
      && marker.start === 3
      && marker.end === 9)).toBe(true);
  });

  it("keeps one marker when only the status line is available", () => {
    const result = {
      f: "ATGCCGTAA",
      r: "GCTAGC",
      specificityCheck: { status: "Pass" },
    };
    const candidate = makeCandidate({
      workspace: "rtqpcr",
      forwardPrimer: "ATGCCGTAA",
      raw: { f: "ATGCCGTAA" },
    });
    const markers = buildValidationMarkers({
      validationResults: [result],
      candidates: [candidate],
      sequence: SEQUENCE,
      workspace: "rtqpcr",
    });
    expect(markers.length).toBeGreaterThan(0);
  });

  it("deduplicates repeated coordinates from the same result", () => {
    const result = {
      f: "ATGCCGTAA",
      r: "GCTAGC",
      specificityCheck: { status: "Pass" },
    };
    const candidate = makeCandidate({
      workspace: "rtqpcr",
      forwardPrimer: "ATGCCGTAA",
      reversePrimer: "GCTAGC",
      bindingStartForward: 0,
      bindingEndForward: 9,
      bindingStartReverse: 26,
      bindingEndReverse: 32,
      raw: { f: "ATGCCGTAA", r: "GCTAGC" },
    });
    const markers = buildValidationMarkers({
      validationResults: [result],
      candidates: [candidate],
      sequence: SEQUENCE,
      workspace: "rtqpcr",
    });
    const fwdCount = markers.filter((marker) => marker.label === "Forward primer").length;
    expect(fwdCount).toBe(1);
  });

  it("ignores markers out of document bounds", () => {
    const result = {
      f: "TTTTTTTTTT",
      specificityCheck: { status: "Pass" },
    };
    const candidate = makeCandidate({
      workspace: "rtqpcr",
      forwardPrimer: "TTTTTTTTTT",
      bindingStartForward: 100,
      bindingEndForward: 109,
      raw: { f: "TTTTTTTTTT" },
    });
    const markers = buildValidationMarkers({
      validationResults: [result],
      candidates: [candidate],
      sequence: SEQUENCE,
      workspace: "rtqpcr",
    });
    expect(markers).toHaveLength(0);
  });
});
