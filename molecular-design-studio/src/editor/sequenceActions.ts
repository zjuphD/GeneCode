import type {
  SequenceDocument,
  SequenceFeature,
  SequenceSelection,
} from "../types";

const COMPLEMENT: Record<string, string> = {
  A: "T",
  T: "A",
  U: "A",
  G: "C",
  C: "G",
  R: "Y",
  Y: "R",
  S: "S",
  W: "W",
  K: "M",
  M: "K",
  B: "V",
  D: "H",
  H: "D",
  V: "B",
  N: "N",
};

const CODON_TABLE: Record<string, string> = {
  TTT: "F", TTC: "F", TTA: "L", TTG: "L",
  TCT: "S", TCC: "S", TCA: "S", TCG: "S",
  TAT: "Y", TAC: "Y", TAA: "*", TAG: "*",
  TGT: "C", TGC: "C", TGA: "*", TGG: "W",
  CTT: "L", CTC: "L", CTA: "L", CTG: "L",
  CCT: "P", CCC: "P", CCA: "P", CCG: "P",
  CAT: "H", CAC: "H", CAA: "Q", CAG: "Q",
  CGT: "R", CGC: "R", CGA: "R", CGG: "R",
  ATT: "I", ATC: "I", ATA: "I", ATG: "M",
  ACT: "T", ACC: "T", ACA: "T", ACG: "T",
  AAT: "N", AAC: "N", AAA: "K", AAG: "K",
  AGT: "S", AGC: "S", AGA: "R", AGG: "R",
  GTT: "V", GTC: "V", GTA: "V", GTG: "V",
  GCT: "A", GCC: "A", GCA: "A", GCG: "A",
  GAT: "D", GAC: "D", GAA: "E", GAG: "E",
  GGT: "G", GGC: "G", GGA: "G", GGG: "G",
};

export function reverseComplement(sequence: string): string {
  return sequence
    .toUpperCase()
    .split("")
    .reverse()
    .map((base) => COMPLEMENT[base] ?? "N")
    .join("");
}

export function translateSequence(sequence: string, frame = 0): string {
  const normalized = sequence.toUpperCase().replace(/U/g, "T");
  let translation = "";
  for (let index = frame; index + 2 < normalized.length; index += 3) {
    translation += CODON_TABLE[normalized.slice(index, index + 3)] ?? "X";
  }
  return translation;
}

export function gcPercent(sequence: string): number {
  const normalized = sequence.toUpperCase();
  if (!normalized.length) return 0;
  const gc = [...normalized].filter((base) => base === "G" || base === "C").length;
  return (gc / normalized.length) * 100;
}

function copyFeature(feature: SequenceFeature): SequenceFeature {
  return {
    ...feature,
    qualifiers: Object.fromEntries(
      Object.entries(feature.qualifiers).map(([key, values]) => [key, [...values]]),
    ),
  };
}

function extractFeatures(
  doc: SequenceDocument,
  selection: SequenceSelection,
): SequenceFeature[] {
  if (!selection.wrapsOrigin) {
    return doc.features
      .filter((feature) => feature.start >= selection.start && feature.end <= selection.end)
      .map((feature) => ({
        ...copyFeature(feature),
        start: feature.start - selection.start,
        end: feature.end - selection.start,
      }));
  }

  const tailLength = doc.sequence.length - selection.start;
  return doc.features.flatMap((feature) => {
    if (feature.start >= selection.start && feature.end <= doc.sequence.length) {
      return [{
        ...copyFeature(feature),
        start: feature.start - selection.start,
        end: feature.end - selection.start,
      }];
    }
    if (feature.start >= 0 && feature.end <= selection.end) {
      return [{
        ...copyFeature(feature),
        start: tailLength + feature.start,
        end: tailLength + feature.end,
      }];
    }
    return [];
  });
}

export function extractSelectionDocument(
  doc: SequenceDocument,
  selection: SequenceSelection,
  name = `${doc.name} selection`,
): SequenceDocument {
  return {
    name,
    sequence: selection.sequence,
    circular: false,
    features: extractFeatures(doc, selection),
  };
}
