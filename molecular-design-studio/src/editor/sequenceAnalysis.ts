import type { SequenceDocument, SequenceFeature, Strand } from "../types";
import { reverseComplement, translateSequence } from "./sequenceActions";

export interface SequenceStatistics {
  length: number;
  gcPercent: number;
  counts: Record<"A" | "T" | "G" | "C" | "other", number>;
}

export interface RestrictionSiteSummary {
  enzyme: string;
  motif: string;
  positions: number[];
}

const COMMON_FEATURES = [
  { name: "T7 promoter", type: "promoter", sequence: "TAATACGACTCACTATAGGG", color: "#4f7fa8" },
  { name: "T3 promoter", type: "promoter", sequence: "AATTAACCCTCACTAAAGGG", color: "#4f7fa8" },
  { name: "SP6 promoter", type: "promoter", sequence: "ATTTAGGTGACACTATAGA", color: "#4f7fa8" },
  { name: "lac operator", type: "regulatory", sequence: "AATTGTGAGCGGATAACAATT", color: "#8b6f9f" },
  { name: "M13 forward primer", type: "primer_bind", sequence: "GTAAAACGACGGCCAGT", color: "#5f8e78" },
  { name: "M13 reverse primer", type: "primer_bind", sequence: "CAGGAAACAGCTATGAC", color: "#a76565" },
] as const;

const RESTRICTION_ENZYMES = [
  ["EcoRI", "GAATTC"],
  ["BamHI", "GGATCC"],
  ["HindIII", "AAGCTT"],
  ["XhoI", "CTCGAG"],
  ["NotI", "GCGGCCGC"],
  ["NheI", "GCTAGC"],
  ["SpeI", "ACTAGT"],
  ["XbaI", "TCTAGA"],
  ["PstI", "CTGCAG"],
  ["SalI", "GTCGAC"],
  ["KpnI", "GGTACC"],
  ["SacI", "GAGCTC"],
] as const;

function safeId(prefix: string, start: number, strand: Strand): string {
  return `${prefix}_${strand === 1 ? "f" : "r"}_${start}_${Math.random().toString(36).slice(2, 7)}`;
}

function findAll(sequence: string, motif: string): number[] {
  const positions: number[] = [];
  let cursor = 0;
  while (cursor <= sequence.length - motif.length) {
    const index = sequence.indexOf(motif, cursor);
    if (index < 0) break;
    positions.push(index);
    cursor = index + 1;
  }
  return positions;
}

export function analyzeSequence(sequence: string): SequenceStatistics {
  const normalized = sequence.toUpperCase();
  const counts = { A: 0, T: 0, G: 0, C: 0, other: 0 };
  for (const base of normalized) {
    if (base === "A" || base === "G" || base === "C") counts[base] += 1;
    else if (base === "T" || base === "U") counts.T += 1;
    else counts.other += 1;
  }
  const canonical = counts.A + counts.T + counts.G + counts.C;
  return {
    length: normalized.length,
    gcPercent: canonical ? ((counts.G + counts.C) / canonical) * 100 : 0,
    counts,
  };
}

export function scanRestrictionSites(sequence: string): RestrictionSiteSummary[] {
  const normalized = sequence.toUpperCase().replace(/U/g, "T");
  return RESTRICTION_ENZYMES
    .map(([enzyme, motif]) => ({ enzyme, motif, positions: findAll(normalized, motif) }))
    .filter((item) => item.positions.length > 0);
}

export function findCommonFeatureAnnotations(doc: SequenceDocument): SequenceFeature[] {
  const sequence = doc.sequence.toUpperCase().replace(/U/g, "T");
  const found: SequenceFeature[] = [];

  for (const definition of COMMON_FEATURES) {
    for (const strand of [1, -1] as const) {
      const motif = strand === 1 ? definition.sequence : reverseComplement(definition.sequence);
      for (const start of findAll(sequence, motif)) {
        const end = start + motif.length;
        const duplicate = doc.features.some((feature) =>
          feature.start === start &&
          feature.end === end &&
          feature.strand === strand &&
          feature.name.toLowerCase() === definition.name.toLowerCase(),
        );
        if (duplicate) continue;
        found.push({
          id: safeId("auto", start, strand),
          name: definition.name,
          type: definition.type,
          start,
          end,
          strand,
          color: definition.color,
          qualifiers: {
            note: ["Matched bundled common-feature library"],
            match_sequence: [motif],
          },
        });
      }
    }
  }

  return found;
}

function findOrfsOnStrand(
  sequence: string,
  strand: Strand,
  originalLength: number,
  minAminoAcids: number,
): SequenceFeature[] {
  const features: SequenceFeature[] = [];
  const stopCodons = new Set(["TAA", "TAG", "TGA"]);

  for (let frame = 0; frame < 3; frame += 1) {
    for (let start = frame; start <= sequence.length - 3; start += 3) {
      if (sequence.slice(start, start + 3) !== "ATG") continue;
      for (let cursor = start + 3; cursor <= sequence.length - 3; cursor += 3) {
        if (!stopCodons.has(sequence.slice(cursor, cursor + 3))) continue;
        const end = cursor + 3;
        const aminoAcids = (end - start) / 3 - 1;
        if (aminoAcids >= minAminoAcids) {
          const featureStart = strand === 1 ? start : originalLength - end;
          const featureEnd = strand === 1 ? end : originalLength - start;
          const codingSequence = sequence.slice(start, end - 3);
          features.push({
            id: safeId("orf", featureStart, strand),
            name: `ORF ${featureStart + 1}-${featureEnd}`,
            type: "CDS",
            start: featureStart,
            end: featureEnd,
            strand,
            color: strand === 1 ? "#4f7fa8" : "#8b6f9f",
            qualifiers: {
              note: [`Predicted ${aminoAcids} aa open reading frame`],
              translation: [translateSequence(codingSequence)],
              codon_start: ["1"],
            },
          });
        }
        break;
      }
      if (features.length >= 200) return features;
    }
  }
  return features;
}

export function findOpenReadingFrames(
  doc: SequenceDocument,
  minAminoAcids = 30,
): SequenceFeature[] {
  const sequence = doc.sequence.toUpperCase().replace(/U/g, "T");
  const candidates = [
    ...findOrfsOnStrand(sequence, 1, sequence.length, minAminoAcids),
    ...findOrfsOnStrand(reverseComplement(sequence), -1, sequence.length, minAminoAcids),
  ];
  return candidates.filter((candidate) => !doc.features.some((feature) =>
    feature.type === "CDS" &&
    feature.start === candidate.start &&
    feature.end === candidate.end &&
    feature.strand === candidate.strand,
  ));
}

export function reverseComplementDocument(doc: SequenceDocument): SequenceDocument {
  const length = doc.sequence.length;
  return {
    ...doc,
    name: `${doc.name} reverse complement`,
    sequence: reverseComplement(doc.sequence),
    features: doc.features.map((feature) => ({
      ...feature,
      id: `${feature.id}_rc`,
      start: length - feature.end,
      end: length - feature.start,
      strand: feature.strand === 1 ? -1 : 1,
    })),
  };
}
