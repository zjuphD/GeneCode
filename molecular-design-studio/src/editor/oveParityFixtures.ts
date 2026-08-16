import type {
  SequenceDocument,
  SequenceFeature,
  SequenceSelection,
  Strand,
} from "../types";
import { reverseComplement, translateSequence } from "./sequenceActions";

/** A deterministic primer record used by the OVE parity harness. */
export interface OveParityPrimer {
  readonly id: string;
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly strand: Strand;
  /** Primer oligo sequence, 5' to 3'. */
  readonly sequence: string;
  readonly role: "forward" | "reverse";
}

/** A restriction site using canonical zero-based half-open coordinates. */
export interface OveParityCutSite {
  readonly enzyme: string;
  readonly motif: string;
  readonly start: number;
  readonly end: number;
  /** Zero-based boundary at which the enzyme cuts. */
  readonly cutPosition: number;
  readonly unique: boolean;
}

export interface OveParitySegment {
  readonly start: number;
  readonly end: number;
}

/** A feature that crosses the circular origin and is represented as segments. */
export interface OveParityWrappedFeature {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly wrapsOrigin: true;
  readonly segments: readonly OveParitySegment[];
  readonly sequence: string;
}

export interface OveParitySelection extends SequenceSelection {
  readonly label: string;
}

export interface OveParityTranslationExpectation {
  readonly featureId: string;
  readonly strand: Strand;
  readonly expectedProtein: string;
}

export interface OveParityVirtualizationProfile {
  readonly rowBases: number;
  readonly expectedRows: number;
  readonly featureCount: number;
}

/** One canonical document plus the sidecar data needed by an OVE parity test. */
export interface OveParityFixture {
  readonly id: string;
  readonly doc: SequenceDocument;
  readonly primers: readonly OveParityPrimer[];
  readonly cutSites: readonly OveParityCutSite[];
  readonly selections: readonly OveParitySelection[];
  readonly wrappedFeatures: readonly OveParityWrappedFeature[];
  readonly translations: readonly OveParityTranslationExpectation[];
  readonly ambiguousPositions: readonly number[];
  readonly virtualization?: OveParityVirtualizationProfile;
}

export interface OveParityFixtureSet {
  readonly circular2700: OveParityFixture;
  readonly annotated10000: OveParityFixture;
  readonly originSpanning: OveParityFixture;
  readonly translations: OveParityFixture;
  readonly ambiguousBases: OveParityFixture;
  readonly largeVirtualization: OveParityFixture;
}

interface SequencePatch {
  readonly start: number;
  readonly sequence: string;
}

const DNA_PATTERN = "ACGT";

function repeatPattern(length: number, pattern = DNA_PATTERN): string {
  if (!Number.isInteger(length) || length < 0) {
    throw new Error(`Sequence length must be a non-negative integer: ${length}`);
  }
  if (!pattern) throw new Error("Sequence pattern must not be empty");
  return pattern.repeat(Math.ceil(length / pattern.length)).slice(0, length);
}

function patchSequence(length: number, patches: readonly SequencePatch[]): string {
  const sequence = repeatPattern(length).split("");
  const occupied = new Set<number>();
  for (const patch of patches) {
    if (!Number.isInteger(patch.start) || patch.start < 0) {
      throw new Error(`Invalid patch start: ${patch.start}`);
    }
    if (patch.start + patch.sequence.length > length) {
      throw new Error(`Patch exceeds sequence length at ${patch.start}`);
    }
    for (let offset = 0; offset < patch.sequence.length; offset += 1) {
      const position = patch.start + offset;
      if (occupied.has(position)) throw new Error(`Overlapping patch at ${position}`);
      occupied.add(position);
      sequence[position] = patch.sequence[offset]!;
    }
  }
  return sequence.join("").toUpperCase();
}

function makeFeature(
  id: string,
  name: string,
  type: string,
  start: number,
  end: number,
  strand: Strand,
  qualifiers: Record<string, string[]> = {},
  color?: string,
): SequenceFeature {
  return { id, name, type, start, end, strand, qualifiers, color };
}

function makeCutSite(
  enzyme: string,
  motif: string,
  start: number,
  cutOffset: number,
): OveParityCutSite {
  return {
    enzyme,
    motif,
    start,
    end: start + motif.length,
    cutPosition: start + cutOffset,
    unique: true,
  };
}

function makePrimer(
  id: string,
  name: string,
  start: number,
  sequence: string,
  strand: Strand,
): OveParityPrimer {
  return {
    id,
    name,
    start,
    end: start + sequence.length,
    strand,
    sequence,
    role: strand === 1 ? "forward" : "reverse",
  };
}

function circularSlice(sequence: string, start: number, end: number): string {
  if (start <= end) return sequence.slice(start, end);
  return sequence.slice(start) + sequence.slice(0, end);
}

function makeWrappedFeature(
  sequence: string,
  id: string,
  name: string,
  type: string,
  start: number,
  end: number,
): OveParityWrappedFeature {
  const segments: OveParitySegment[] = [
    { start, end: sequence.length },
    { start: 0, end },
  ];
  return {
    id,
    name,
    type,
    start,
    end,
    wrapsOrigin: true,
    segments,
    sequence: circularSlice(sequence, start, end),
  };
}

function makeWrappedSelection(
  sequence: string,
  label: string,
  start: number,
  end: number,
): OveParitySelection {
  const selected = circularSlice(sequence, start, end);
  return {
    label,
    start,
    end,
    length: selected.length,
    wrapsOrigin: start > end,
    sequence: selected,
  };
}

const M13_FORWARD = "GTAAAACGACGGCCAGT";
const M13_REVERSE = "CAGGAAACAGCTATGAC";
const T7_PROMOTER = "TAATACGACTCACTATAGGG";
const FORWARD_CDS = "ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG";
const REVERSE_CDS = "ATGAAACCCGGGTTTTAA";

function makeCircular2700Fixture(): OveParityFixture {
  const sequence = patchSequence(2700, [
    { start: 80, sequence: M13_FORWARD },
    { start: 120, sequence: "GAATTC" },
    { start: 180, sequence: T7_PROMOTER },
    { start: 520, sequence: "GGATCC" },
    { start: 1000, sequence: "ATG" + "GCT".repeat(30) + "TAA" },
    { start: 1820, sequence: "GGTACC" },
    { start: 2500, sequence: reverseComplement(M13_REVERSE) },
    { start: 2530, sequence: "CTGCAG" },
  ]);
  const ampRCdsEnd = 1000 + 3 + 90 + 3;
  const doc: SequenceDocument = {
    name: "OVE parity pUC-2700",
    accession: "OVE-PARITY-2700",
    version: "1",
    sequence,
    circular: true,
    features: [
      makeFeature("p27-source", "pUC-2700 backbone", "source", 0, 2700, 1, { organism: ["synthetic construct"] }),
      makeFeature("p27-mcs", "Multiple cloning site", "misc_feature", 100, 200, 1, { label: ["MCS"] }),
      makeFeature("p27-m13-f", "M13 forward binding", "primer_bind", 80, 80 + M13_FORWARD.length, 1),
      makeFeature("p27-t7", "T7 promoter", "promoter", 180, 180 + T7_PROMOTER.length, 1),
      makeFeature(
        "p27-amp-cds",
        "AmpR-like CDS",
        "CDS",
        1000,
        ampRCdsEnd,
        1,
        { codon_start: ["1"], translation: ["MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA*"] },
      ),
      makeFeature("p27-colE1", "ColE1 origin", "rep_origin", 1500, 1800, 1),
      makeFeature("p27-m13-r", "M13 reverse binding", "primer_bind", 2500, 2500 + M13_REVERSE.length, -1),
      makeFeature("p27-terminator", "Synthetic terminator", "terminator", 2100, 2240, 1),
    ],
  };
  const originStart = 2650;
  const originEnd = 50;
  return {
    id: "circular-2700",
    doc,
    primers: [
      makePrimer("p27-primer-f", "M13 forward", 80, M13_FORWARD, 1),
      makePrimer("p27-primer-r", "M13 reverse", 2500, M13_REVERSE, -1),
    ],
    cutSites: [
      makeCutSite("EcoRI", "GAATTC", 120, 1),
      makeCutSite("BamHI", "GGATCC", 520, 1),
      makeCutSite("KpnI", "GGTACC", 1820, 5),
      makeCutSite("PstI", "CTGCAG", 2530, 5),
    ],
    selections: [makeWrappedSelection(sequence, "Origin-spanning selection", originStart, originEnd)],
    wrappedFeatures: [makeWrappedFeature(sequence, "p27-wrap", "Origin-spanning tag", "misc_feature", originStart, originEnd)],
    translations: [],
    ambiguousPositions: [],
  };
}

function makeAnnotated10000Fixture(): OveParityFixture {
  const forwardCds = "ATG" + "GCC".repeat(20) + "TAA";
  const reverseCoding = "ATG" + "AAA".repeat(18) + "TAA";
  const reverseCdsTop = reverseComplement(reverseCoding);
  const sequence = patchSequence(10000, [
    { start: 1500, sequence: "GAATTC" },
    { start: 2100, sequence: forwardCds },
    { start: 3500, sequence: "GGATCC" },
    { start: 4200, sequence: reverseCdsTop },
    { start: 7000, sequence: "CTCGAG" },
    { start: 9500, sequence: "GCGGCCGC" },
  ]);
  const doc: SequenceDocument = {
    name: "OVE parity annotated plasmid 10 kb",
    accession: "OVE-PARITY-10000",
    version: "1",
    sequence,
    circular: true,
    features: [
      makeFeature("p10-source", "10 kb synthetic backbone", "source", 0, 10000, 1),
      makeFeature("p10-ori", "High-copy origin", "rep_origin", 500, 1400, 1),
      makeFeature("p10-promoter", "Inducible promoter", "promoter", 1800, 2000, 1),
      makeFeature(
        "p10-reporter",
        "Reporter CDS",
        "CDS",
        2100,
        2100 + forwardCds.length,
        1,
        { codon_start: ["1"], translation: [translateSequence(forwardCds)] },
      ),
      makeFeature(
        "p10-reverse-cds",
        "Reverse marker CDS",
        "CDS",
        4200,
        4200 + reverseCdsTop.length,
        -1,
        { codon_start: ["1"], translation: [translateSequence(reverseCoding)] },
      ),
      makeFeature("p10-terminator", "Transcription terminator", "terminator", 5000, 5300, 1),
      makeFeature("p10-enhancer", "Enhancer", "regulatory", 6500, 6900, 1),
      makeFeature("p10-selection", "Mammalian selection marker", "gene", 7600, 8300, 1),
      makeFeature("p10-poly-a", "Polyadenylation signal", "misc_feature", 9000, 9400, 1),
    ],
  };
  return {
    id: "annotated-10000",
    doc,
    primers: [
      makePrimer("p10-primer-f", "Reporter forward", 2060, sequence.slice(2060, 2080), 1),
      makePrimer("p10-primer-r", "Reporter reverse", 2160, reverseComplement(sequence.slice(2160, 2180)), -1),
    ],
    cutSites: [
      makeCutSite("EcoRI", "GAATTC", 1500, 1),
      makeCutSite("BamHI", "GGATCC", 3500, 1),
      makeCutSite("XhoI", "CTCGAG", 7000, 1),
      makeCutSite("NotI", "GCGGCCGC", 9500, 6),
    ],
    selections: [
      {
        label: "Reporter CDS",
        start: 2100,
        end: 2100 + forwardCds.length,
        length: forwardCds.length,
        wrapsOrigin: false,
        sequence: sequence.slice(2100, 2100 + forwardCds.length),
      },
    ],
    wrappedFeatures: [],
    translations: [
      { featureId: "p10-reporter", strand: 1, expectedProtein: translateSequence(forwardCds) },
      { featureId: "p10-reverse-cds", strand: -1, expectedProtein: translateSequence(reverseCoding) },
    ],
    ambiguousPositions: [],
  };
}

function makeTranslationFixture(): OveParityFixture {
  const sequence = patchSequence(360, [
    { start: 24, sequence: FORWARD_CDS },
    { start: 200, sequence: reverseComplement(REVERSE_CDS) },
  ]);
  const doc: SequenceDocument = {
    name: "OVE parity translation strands",
    sequence,
    circular: false,
    features: [
      makeFeature("translation-source", "Translation test sequence", "source", 0, 360, 1),
      makeFeature(
        "cds-forward",
        "Forward CDS",
        "CDS",
        24,
        24 + FORWARD_CDS.length,
        1,
        { codon_start: ["1"], translation: ["MAIVMGR*KGAR*"] },
      ),
      makeFeature(
        "cds-reverse",
        "Reverse CDS",
        "CDS",
        200,
        200 + REVERSE_CDS.length,
        -1,
        { codon_start: ["1"], translation: ["MKPGF*"] },
      ),
    ],
  };
  return {
    id: "translation-strands",
    doc,
    primers: [],
    cutSites: [],
    selections: [],
    wrappedFeatures: [],
    translations: [
      { featureId: "cds-forward", strand: 1, expectedProtein: "MAIVMGR*KGAR*" },
      { featureId: "cds-reverse", strand: -1, expectedProtein: "MKPGF*" },
    ],
    ambiguousPositions: [],
  };
}

function makeAmbiguousBaseFixture(): OveParityFixture {
  const ambiguousBlock = "RYSWKMBDHV";
  const sequence = patchSequence(160, [
    { start: 10, sequence: "NNNN" },
    { start: 45, sequence: ambiguousBlock },
    { start: 120, sequence: "N" },
  ]);
  const positions = [10, 11, 12, 13, ...Array.from({ length: ambiguousBlock.length }, (_, i) => 45 + i), 120];
  return {
    id: "ambiguous-bases",
    doc: {
      name: "OVE parity ambiguous bases",
      sequence,
      circular: false,
      features: [makeFeature("ambiguous-region", "IUPAC ambiguous region", "misc_feature", 10, 55, 1)],
    },
    primers: [],
    cutSites: [],
    selections: [],
    wrappedFeatures: [],
    translations: [],
    ambiguousPositions: positions,
  };
}

function makeLargeVirtualizationFixture(): OveParityFixture {
  const length = 250_000;
  const featureCount = 250;
  const features: SequenceFeature[] = [
    makeFeature("large-source", "250 kb virtualization source", "source", 0, length, 1),
  ];
  for (let index = 0; index < featureCount; index += 1) {
    const start = index * 1000 + 100;
    features.push(makeFeature(
      `large-feature-${String(index + 1).padStart(3, "0")}`,
      `Synthetic feature ${index + 1}`,
      index % 3 === 0 ? "CDS" : "misc_feature",
      start,
      start + 240,
      index % 2 === 0 ? 1 : -1,
      { source_index: [String(index + 1)] },
    ));
  }
  return {
    id: "large-virtualization-250kb",
    doc: {
      name: "OVE parity large virtualization sequence",
      sequence: repeatPattern(length, "ACGTGCAATGCA"),
      circular: true,
      features,
    },
    primers: [],
    cutSites: [],
    selections: [],
    wrappedFeatures: [],
    translations: [],
    ambiguousPositions: [],
    virtualization: {
      rowBases: 80,
      expectedRows: Math.ceil(length / 80),
      featureCount: features.length,
    },
  };
}

/** Build fresh fixture objects so tests never share mutable document state. */
export function createOveParityFixtures(): OveParityFixtureSet {
  const circular2700 = makeCircular2700Fixture();
  return {
    circular2700,
    annotated10000: makeAnnotated10000Fixture(),
    originSpanning: {
      ...circular2700,
      id: "origin-spanning",
    },
    translations: makeTranslationFixture(),
    ambiguousBases: makeAmbiguousBaseFixture(),
    largeVirtualization: makeLargeVirtualizationFixture(),
  };
}

export const OVE_PARITY_FIXTURES = createOveParityFixtures();
export const circular2700Fixture = OVE_PARITY_FIXTURES.circular2700;
export const annotated10000Fixture = OVE_PARITY_FIXTURES.annotated10000;
export const originSpanningFixture = OVE_PARITY_FIXTURES.originSpanning;
export const translationFixture = OVE_PARITY_FIXTURES.translations;
export const ambiguousBaseFixture = OVE_PARITY_FIXTURES.ambiguousBases;
export const largeVirtualizationFixture = OVE_PARITY_FIXTURES.largeVirtualization;
