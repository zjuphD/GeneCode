import type { ResultCandidate } from "../agent/responseTypes";
import type { SequenceDocument } from "../types";

function reverseComplement(sequence: string): string {
  const complement: Record<string, string> = { A: "T", T: "A", G: "C", C: "G", N: "N" };
  return sequence
    .toUpperCase()
    .split("")
    .reverse()
    .map((base) => complement[base] ?? "N")
    .join("");
}

function isValidRange(start: number | null | undefined, end: number | null | undefined, length: number): boolean {
  return Number.isInteger(start) && Number.isInteger(end) && start! >= 0 && end! > start! && end! <= length;
}

export function canWritePrimerFeatures(candidate: ResultCandidate, doc: SequenceDocument | null): boolean {
  if (!doc || candidate.coordinateSystem !== "zero_based_half_open" || candidate.bindingTarget !== "insert") {
    return false;
  }
  const sequence = doc.sequence.toUpperCase();
  if (candidate.bindingTargetLength !== sequence.length) return false;
  if (!isValidRange(candidate.bindingStartForward, candidate.bindingEndForward, sequence.length)) return false;
  if (!isValidRange(candidate.bindingStartReverse, candidate.bindingEndReverse, sequence.length)) return false;
  if (!candidate.forwardCore || !candidate.reverseCore) return false;

  const forwardTemplate = sequence.slice(candidate.bindingStartForward!, candidate.bindingEndForward!);
  const reverseTemplate = sequence.slice(candidate.bindingStartReverse!, candidate.bindingEndReverse!);
  return forwardTemplate === candidate.forwardCore.toUpperCase()
    && reverseComplement(reverseTemplate) === candidate.reverseCore.toUpperCase();
}
