/**
 * translationConsequences — reading-frame consequences of a replace operation.
 *
 * Given the replaced fragment (before) and its replacement (after), this pure
 * module answers three biological questions surfaced as hint badges:
 * - 移码风险 (frameshift risk): the length change is not a multiple of 3, so any
 *   downstream coding sequence shifts out of frame.
 * - 密码子变化 (codon changes): aligned 3-mer comparison assuming the replaced
 *   region starts at a codon boundary (the common case for codon-level edits).
 * - 引入终止密码子 (introduced stop): a codon that translated to an amino acid
 *   now translates to a stop (TAA/TAG/TGA).
 *
 * Pure and serializable — no React, no document access.
 */

import { translateSequence } from "../editor/sequenceActions";

export interface CodonChange {
  /** 1-based codon position within the replaced region. */
  index: number;
  /** Original codon (DNA triple). */
  before: string;
  /** Replacement codon (DNA triple). */
  after: string;
  /** Single-letter amino acid of the original codon. */
  beforeAa: string;
  /** Single-letter amino acid of the replacement codon. */
  afterAa: string;
}

export interface TranslationConsequence {
  /** The replaced region's length delta (after − before). */
  lengthDelta: number;
  /** True when |lengthDelta| is not a multiple of 3 → downstream frameshift. */
  frameshiftRisk: boolean;
  /** Aligned codon-by-codon changes inside the replaced region. */
  codonChanges: CodonChange[];
  /** First position (1-based) where a stop codon was introduced, if any. */
  introducedStopIndex: number | null;
  /** Introduced stop details (codon + amino acid context) when present. */
  introducedStop: {
    index: number;
    before: string;
    after: string;
    beforeAa: string;
    afterAa: string;
  } | null;
  /** Short translations of the region in the assumed frame. */
  beforeTranslation: string;
  afterTranslation: string;
}

const STOP_CODONS = new Set(["TAA", "TAG", "TGA"]);

/** > this fraction of non-ACGT(U) bases makes translation unreliable → skip. */
const MAX_AMBIGUITY_RATIO = 0.3;

/**
 * True when more than MAX_AMBIGUITY_RATIO of the sequence is not a standard
 * base. U is normalized to T (RNA) so U-rich RNA sequences still translate.
 */
export function isAmbiguityRich(sequence: string): boolean {
  if (sequence.length === 0) return false;
  const normalized = sequence.toUpperCase().replace(/U/g, "T");
  const unambiguous = [...normalized].filter((base) =>
    base === "A" || base === "T" || base === "G" || base === "C").length;
  return unambiguous / normalized.length < 1 - MAX_AMBIGUITY_RATIO;
}

/** Chunk a sequence into complete 3-mers from position 0; trailing <3 bases are dropped. */
function codons(sequence: string): string[] {
  const out: string[] = [];
  for (let index = 0; index + 2 < sequence.length; index += 3) {
    out.push(sequence.slice(index, index + 3));
  }
  return out;
}

function aaOf(codon: string): string {
  return translateSequence(codon, 0);
}

/**
 * Analyze translation consequences of replacing `before` with `after`.
 * Codon alignment assumes the region starts at a codon boundary (frame 0 of
 * the region) — the typical case for codon-level mutagenesis. Ambiguity-rich
 * sequences yield an empty consequence set (no misleading badges).
 */
export function analyzeReplaceTranslation(
  before: string,
  after: string,
): TranslationConsequence {
  const beforeSeq = before.toUpperCase();
  const afterSeq = after.toUpperCase();

  const lengthDelta = afterSeq.length - beforeSeq.length;
  const frameshiftRisk = lengthDelta % 3 !== 0;

  if (
    beforeSeq.length === 0 ||
    afterSeq.length === 0 ||
    isAmbiguityRich(beforeSeq) ||
    isAmbiguityRich(afterSeq)
  ) {
    return {
      lengthDelta,
      frameshiftRisk,
      codonChanges: [],
      introducedStopIndex: null,
      introducedStop: null,
      beforeTranslation: "",
      afterTranslation: "",
    };
  }

  const beforeCodons = codons(beforeSeq);
  const afterCodons = codons(afterSeq);

  const codonChanges: CodonChange[] = [];
  let introducedStopIndex: number | null = null;
  let introducedStop: TranslationConsequence["introducedStop"] = null;

  // Scan EVERY replacement codon, not just the shared prefix: a longer
  // replacement can append codons beyond the original region (e.g.
  // "ATG"→"ATGTAA"), and a stop there is newly introduced even though no
  // before-codon existed at that position to compare with.
  for (let index = 0; index < afterCodons.length; index += 1) {
    const afterCodon = afterCodons[index]!;
    const beforeCodon = beforeCodons[index];
    const afterAa = aaOf(afterCodon);
    const beforeAa = beforeCodon !== undefined ? aaOf(beforeCodon) : "";

    if (beforeCodon !== undefined && beforeCodon !== afterCodon) {
      codonChanges.push({
        index: index + 1,
        before: beforeCodon,
        after: afterCodon,
        beforeAa,
        afterAa,
      });
    }
    if (
      STOP_CODONS.has(afterCodon) &&
      (beforeCodon === undefined || !STOP_CODONS.has(beforeCodon)) &&
      introducedStopIndex === null
    ) {
      introducedStopIndex = index + 1;
      introducedStop = {
        index: index + 1,
        before: beforeCodon ?? "—",
        after: afterCodon,
        beforeAa,
        afterAa: "*",
      };
    }
  }

  return {
    lengthDelta,
    frameshiftRisk,
    codonChanges,
    introducedStopIndex,
    introducedStop,
    beforeTranslation: translateSequence(beforeSeq, 0),
    afterTranslation: translateSequence(afterSeq, 0),
  };
}
