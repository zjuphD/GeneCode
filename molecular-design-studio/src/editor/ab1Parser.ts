import { ab1ToJson } from "@teselagen/bio-parsers";

/**
 * Canonical ABI/Sanger trace normalized from a raw .ab1 file.
 *
 * `ab1ToJson` returns per-base trace windows (`baseTraces`), the raw peak
 * positions (`basePos`), the basecalls, and (when present) Phred quality
 * scores. We keep the engine's own trace contract untouched so the data can be
 * handed straight to OVE's AlignmentView/RowView chromatogram renderer.
 */
export interface Ab1BaseTrace {
  aTrace: number[];
  tTrace: number[];
  gTrace: number[];
  cTrace: number[];
}

export interface Ab1TraceData {
  /** Read name derived from the file name when the ABI tag has no name. */
  name: string;
  /** Basecalls joined into a plain ACGTN string. */
  sequence: string;
  baseCalls: string[];
  /** Trace positions (in points) at which each basecall peaks. */
  basePos: number[];
  /** Per-base Phred quality scores; absent when the file omits them. */
  qualNums?: number[];
  /** One trace window per basecall, ready for OVE's chromatogram renderer. */
  baseTraces: Ab1BaseTrace[];
  /** Total number of trace data points (for UI display only). */
  traceLength: number;
}

const COMPLEMENT: Record<string, string> = {
  A: "T",
  T: "A",
  G: "C",
  C: "G",
  N: "N",
};

/**
 * Parse an .ab1/.abi Sanger trace file into canonical trace data.
 *
 * Accepts either a browser `File` or an `ArrayBuffer` (for tests). Throws a
 * human-readable error when the file is not a valid ABI trace or contains no
 * basecalls.
 */
export async function parseAb1File(file: File | ArrayBuffer): Promise<Ab1TraceData> {
  let result;
  try {
    const parsed = await ab1ToJson(file);
    result = parsed?.[0];
  } catch {
    throw new Error("Not a valid ABI trace file");
  }
  if (!result?.parsedSequence || !result.success) {
    throw new Error("Not a valid ABI trace file");
  }
  const { name, sequence, chromatogramData } = result.parsedSequence as {
    name?: string;
    sequence?: string;
    chromatogramData?: {
      baseCalls?: string[];
      basePos?: number[];
      qualNums?: number[];
      baseTraces?: Ab1BaseTrace[];
    };
  };
  const baseCalls = chromatogramData?.baseCalls ?? [];
  const baseTraces = chromatogramData?.baseTraces ?? [];
  if (!baseCalls.length || !sequence) {
    throw new Error("The ABI file contains no basecalls");
  }
  const basePos = chromatogramData?.basePos ?? [];
  const qualNums = chromatogramData?.qualNums?.length ? chromatogramData.qualNums : undefined;
  const traceLength = baseTraces.reduce(
    (total, trace) => total + Math.max(trace.aTrace.length, trace.tTrace.length, trace.gTrace.length, trace.cTrace.length),
    0,
  );
  return {
    name: name || "Sequencing read",
    sequence,
    baseCalls,
    basePos,
    qualNums,
    baseTraces,
    traceLength,
  };
}

/**
 * Reverse-complement a trace in place so the chromatogram lines up with a
 * reverse-oriented query in the alignment track (the verifier picks the
 * orientation with the best score automatically).
 */
export function reverseAb1Trace(trace: Ab1TraceData): Ab1TraceData {
  const reversedCalls = trace.baseCalls
    .map((base) => COMPLEMENT[base] ?? base)
    .reverse();
  const reversedTraces = [...trace.baseTraces].reverse().map((window) => ({
    // Reversing the read flips each channel's time axis and swaps the
    // complementary dye channels so the peaks still match the bases shown.
    aTrace: [...window.tTrace].reverse(),
    tTrace: [...window.aTrace].reverse(),
    gTrace: [...window.cTrace].reverse(),
    cTrace: [...window.gTrace].reverse(),
  }));
  return {
    ...trace,
    sequence: reversedCalls.join(""),
    baseCalls: reversedCalls,
    basePos: [...trace.basePos].reverse(),
    qualNums: trace.qualNums ? [...trace.qualNums].reverse() : undefined,
    baseTraces: reversedTraces,
  };
}
