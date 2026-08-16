import { describe, expect, it } from "vitest";
import type { SequenceDocument, SequenceFeature } from "../types";
import { reverseComplement, translateSequence } from "./sequenceActions";
import {
  OVE_PARITY_FIXTURES,
  createOveParityFixtures,
  type OveParityFixture,
} from "./oveParityFixtures";

const IUPAC_DNA = /^[ACGTURYSWKMBDHVN]+$/;

function expectDocumentCoordinates(doc: SequenceDocument): void {
  const ids = new Set<string>();
  for (const feature of doc.features) {
    expect(ids.has(feature.id), `duplicate feature id: ${feature.id}`).toBe(false);
    ids.add(feature.id);
    expect(Number.isInteger(feature.start)).toBe(true);
    expect(Number.isInteger(feature.end)).toBe(true);
    expect(feature.start).toBeGreaterThanOrEqual(0);
    expect(feature.end).toBeLessThanOrEqual(doc.sequence.length);
    expect(feature.end).toBeGreaterThan(feature.start);
    expect(feature.strand === 1 || feature.strand === -1).toBe(true);
    expect(doc.sequence.slice(feature.start, feature.end)).toHaveLength(feature.end - feature.start);
    for (const values of Object.values(feature.qualifiers)) {
      expect(values.every((value) => typeof value === "string")).toBe(true);
    }
  }
}

function expectFixtureDocumentsValid(fixture: OveParityFixture): void {
  expect(fixture.doc.sequence).toBe(fixture.doc.sequence.toUpperCase());
  expect(fixture.doc.sequence).toMatch(IUPAC_DNA);
  expectDocumentCoordinates(fixture.doc);

  for (const primer of fixture.primers) {
    expect(primer.start).toBeGreaterThanOrEqual(0);
    expect(primer.end).toBeLessThanOrEqual(fixture.doc.sequence.length);
    expect(primer.end - primer.start).toBe(primer.sequence.length);
    const topStrand = fixture.doc.sequence.slice(primer.start, primer.end);
    expect(primer.strand === 1 ? topStrand : reverseComplement(topStrand)).toBe(primer.sequence);
    expect(primer.role).toBe(primer.strand === 1 ? "forward" : "reverse");
  }

  for (const cutSite of fixture.cutSites) {
    expect(cutSite.start).toBeGreaterThanOrEqual(0);
    expect(cutSite.end).toBeLessThanOrEqual(fixture.doc.sequence.length);
    expect(cutSite.end - cutSite.start).toBe(cutSite.motif.length);
    expect(fixture.doc.sequence.slice(cutSite.start, cutSite.end)).toBe(cutSite.motif);
    expect(cutSite.cutPosition).toBeGreaterThanOrEqual(cutSite.start);
    expect(cutSite.cutPosition).toBeLessThanOrEqual(cutSite.end);
    if (cutSite.unique) {
      expect(fixture.doc.sequence.indexOf(cutSite.motif)).toBe(cutSite.start);
      expect(fixture.doc.sequence.indexOf(cutSite.motif, cutSite.start + 1)).toBe(-1);
    }
  }
}

describe("OVE parity fixtures", () => {
  it("builds the same canonical fixtures on every call", () => {
    const first = createOveParityFixtures();
    const second = createOveParityFixtures();
    expect(first).toEqual(second);
    expect(OVE_PARITY_FIXTURES).toEqual(first);
  });

  it("keeps every ordinary feature in canonical half-open bounds", () => {
    for (const fixture of Object.values(OVE_PARITY_FIXTURES)) {
      expectFixtureDocumentsValid(fixture);
    }
  });

  it("provides a 2.7 kb circular plasmid with features, primers, and unique cutsites", () => {
    const fixture = OVE_PARITY_FIXTURES.circular2700;
    expect(fixture.doc.sequence).toHaveLength(2700);
    expect(fixture.doc.circular).toBe(true);
    expect(fixture.doc.features.length).toBeGreaterThanOrEqual(6);
    expect(fixture.primers).toHaveLength(2);
    expect(fixture.cutSites.map((site) => site.enzyme)).toEqual(["EcoRI", "BamHI", "KpnI", "PstI"]);
    expect(fixture.doc.features.some((feature) => feature.type === "rep_origin")).toBe(true);
    expect(fixture.doc.features.some((feature) => feature.type === "CDS")).toBe(true);
  });

  it("provides a 10 kb annotated plasmid with multiple feature classes", () => {
    const fixture = OVE_PARITY_FIXTURES.annotated10000;
    expect(fixture.doc.sequence).toHaveLength(10_000);
    expect(fixture.doc.circular).toBe(true);
    expect(fixture.doc.features.length).toBeGreaterThanOrEqual(8);
    expect(new Set(fixture.doc.features.map((feature) => feature.type))).toEqual(
      new Set(["source", "rep_origin", "promoter", "CDS", "terminator", "regulatory", "gene", "misc_feature"]),
    );
    expect(fixture.cutSites).toHaveLength(4);
    expect(fixture.translations).toHaveLength(2);
  });

  it("preserves origin-spanning feature and selection invariants", () => {
    const fixture = OVE_PARITY_FIXTURES.originSpanning;
    const wrappedFeature = fixture.wrappedFeatures[0]!;
    const selection = fixture.selections[0]!;
    expect(wrappedFeature.wrapsOrigin).toBe(true);
    expect(wrappedFeature.start).toBeGreaterThan(wrappedFeature.end);
    expect(wrappedFeature.segments).toEqual([
      { start: 2650, end: 2700 },
      { start: 0, end: 50 },
    ]);
    expect(wrappedFeature.sequence).toBe(
      fixture.doc.sequence.slice(2650) + fixture.doc.sequence.slice(0, 50),
    );
    expect(wrappedFeature.sequence).toHaveLength(100);
    expect(selection.wrapsOrigin).toBe(true);
    expect(selection.start).toBe(2650);
    expect(selection.end).toBe(50);
    expect(selection.length).toBe((2700 - 2650) + 50);
    expect(selection.sequence).toBe(wrappedFeature.sequence);
  });

  it("translates forward and reverse CDS features in their biological orientation", () => {
    const fixture = OVE_PARITY_FIXTURES.translations;
    for (const expectation of fixture.translations) {
      const feature = fixture.doc.features.find((item) => item.id === expectation.featureId);
      expect(feature).toBeDefined();
      const featureSequence = fixture.doc.sequence.slice(feature!.start, feature!.end);
      const codingSequence = feature!.strand === 1 ? featureSequence : reverseComplement(featureSequence);
      expect(feature!.strand).toBe(expectation.strand);
      expect(translateSequence(codingSequence)).toBe(expectation.expectedProtein);
      expect(feature!.qualifiers.translation).toEqual([expectation.expectedProtein]);
    }
  });

  it("keeps ambiguous IUPAC bases at explicit positions", () => {
    const fixture = OVE_PARITY_FIXTURES.ambiguousBases;
    const actualPositions = [...fixture.doc.sequence]
      .map((base, position) => IUPAC_DNA.test(base) && !/[ACGTU]/.test(base) ? position : -1)
      .filter((position) => position >= 0);
    expect(actualPositions).toEqual(fixture.ambiguousPositions);
    expect(fixture.ambiguousPositions).toHaveLength(15);
    expect(fixture.doc.sequence.slice(10, 14)).toBe("NNNN");
    expect(fixture.doc.sequence.slice(45, 55)).toBe("RYSWKMBDHV");
  });

  it("provides a large deterministic sequence with virtualization metadata", () => {
    const fixture = OVE_PARITY_FIXTURES.largeVirtualization;
    expect(fixture.doc.sequence).toHaveLength(250_000);
    expect(fixture.doc.circular).toBe(true);
    expect(fixture.virtualization).toEqual({
      rowBases: 80,
      expectedRows: Math.ceil(250_000 / 80),
      featureCount: 251,
    });
    expect(fixture.doc.features).toHaveLength(fixture.virtualization!.featureCount);
    expect(fixture.doc.sequence.slice(0, 12)).toBe("ACGTGCAATGCA");
    expect(fixture.doc.sequence.slice(-12)).toBe("GCAATGCAACGT");
  });

  it("does not expose invalid ordinary feature coordinates in the 10 kb case", () => {
    const fixture = OVE_PARITY_FIXTURES.annotated10000;
    const invalid = fixture.doc.features.filter((feature: SequenceFeature) => (
      feature.start < 0 ||
      feature.end > fixture.doc.sequence.length ||
      feature.end <= feature.start
    ));
    expect(invalid).toEqual([]);
  });
});
