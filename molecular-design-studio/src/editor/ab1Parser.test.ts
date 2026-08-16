import { describe, expect, it, vi, beforeEach } from "vitest";
import { parseAb1File, reverseAb1Trace } from "./ab1Parser";

const mockAb1ToJson = vi.fn();

vi.mock("@teselagen/bio-parsers", () => ({
  ab1ToJson: (...args: unknown[]) => mockAb1ToJson(...args),
}));

beforeEach(() => {
  mockAb1ToJson.mockReset();
});

function makeParsedTrace(overrides: Record<string, unknown> = {}) {
  return {
    parsedSequence: {
      name: "read1",
      sequence: "ACGTACGT",
      chromatogramData: {
        baseCalls: ["A", "C", "G", "T", "A", "C", "G", "T"],
        basePos: [50, 80, 110, 140, 170, 200, 230, 260],
        qualNums: [40, 39, 41, 38, 40, 42, 37, 40],
        baseTraces: [
          { aTrace: [1, 2, 3], tTrace: [0, 0, 0], gTrace: [0, 0, 0], cTrace: [0, 0, 0] },
          { aTrace: [0, 0, 0], tTrace: [0, 0, 0], gTrace: [0, 0, 0], cTrace: [1, 2, 3] },
          { aTrace: [0, 0, 0], tTrace: [0, 0, 0], gTrace: [1, 2, 3], cTrace: [0, 0, 0] },
          { aTrace: [0, 0, 0], tTrace: [1, 2, 3], gTrace: [0, 0, 0], cTrace: [0, 0, 0] },
          { aTrace: [1, 2, 3], tTrace: [0, 0, 0], gTrace: [0, 0, 0], cTrace: [0, 0, 0] },
          { aTrace: [0, 0, 0], tTrace: [0, 0, 0], gTrace: [0, 0, 0], cTrace: [1, 2, 3] },
          { aTrace: [0, 0, 0], tTrace: [0, 0, 0], gTrace: [1, 2, 3], cTrace: [0, 0, 0] },
          { aTrace: [0, 0, 0], tTrace: [1, 2, 3], gTrace: [0, 0, 0], cTrace: [0, 0, 0] },
        ],
      },
    },
    success: true,
    messages: [],
    ...overrides,
  };
}

describe("parseAb1File", () => {
  it("normalizes basecalls, peak positions, quality scores, and trace windows", async () => {
    mockAb1ToJson.mockResolvedValue([makeParsedTrace()]);
    const trace = await parseAb1File(new ArrayBuffer(8));
    expect(trace.name).toBe("read1");
    expect(trace.sequence).toBe("ACGTACGT");
    expect(trace.baseCalls).toEqual(["A", "C", "G", "T", "A", "C", "G", "T"]);
    expect(trace.basePos).toEqual([50, 80, 110, 140, 170, 200, 230, 260]);
    expect(trace.qualNums).toEqual([40, 39, 41, 38, 40, 42, 37, 40]);
    expect(trace.baseTraces).toHaveLength(8);
    expect(trace.traceLength).toBe(24);
  });

  it("drops quality scores when the file omits them", async () => {
    mockAb1ToJson.mockResolvedValue([
      makeParsedTrace({
        parsedSequence: {
          name: "read1",
          sequence: "ACGT",
          chromatogramData: {
            baseCalls: ["A", "C", "G", "T"],
            basePos: [50, 80, 110, 140],
            baseTraces: [
              { aTrace: [1], tTrace: [0], gTrace: [0], cTrace: [0] },
              { aTrace: [0], tTrace: [0], gTrace: [0], cTrace: [1] },
              { aTrace: [0], tTrace: [0], gTrace: [1], cTrace: [0] },
              { aTrace: [0], tTrace: [1], gTrace: [0], cTrace: [0] },
            ],
          },
        },
      }),
    ]);
    const trace = await parseAb1File(new ArrayBuffer(8));
    expect(trace.qualNums).toBeUndefined();
  });

  it("falls back to a generic read name when the file has no name", async () => {
    mockAb1ToJson.mockResolvedValue([
      makeParsedTrace({
        parsedSequence: {
          sequence: "ACGT",
          chromatogramData: {
            baseCalls: ["A", "C", "G", "T"],
            basePos: [50, 80, 110, 140],
            baseTraces: [
              { aTrace: [1], tTrace: [0], gTrace: [0], cTrace: [0] },
              { aTrace: [0], tTrace: [0], gTrace: [0], cTrace: [1] },
              { aTrace: [0], tTrace: [0], gTrace: [1], cTrace: [0] },
              { aTrace: [0], tTrace: [1], gTrace: [0], cTrace: [0] },
            ],
          },
        },
      }),
    ]);
    const trace = await parseAb1File(new ArrayBuffer(8));
    expect(trace.name).toBe("Sequencing read");
  });

  it("rejects non-ABI input with a readable error", async () => {
    mockAb1ToJson.mockRejectedValue(new Error("bad magic"));
    await expect(parseAb1File(new ArrayBuffer(8))).rejects.toThrow("Not a valid ABI trace file");
  });

  it("rejects files that parse but carry no basecalls", async () => {
    mockAb1ToJson.mockResolvedValue([
      {
        parsedSequence: { name: "empty", sequence: "", chromatogramData: { baseCalls: [], basePos: [] } },
        success: true,
        messages: [],
      },
    ]);
    await expect(parseAb1File(new ArrayBuffer(8))).rejects.toThrow("contains no basecalls");
  });

  it("rejects files the parser flags as unsuccessful", async () => {
    mockAb1ToJson.mockResolvedValue([
      {
        parsedSequence: undefined,
        success: false,
        messages: ["nope"],
      },
    ]);
    await expect(parseAb1File(new ArrayBuffer(8))).rejects.toThrow("Not a valid ABI trace file");
  });
});

describe("reverseAb1Trace", () => {
  it("reverse-complements basecalls and mirrors the trace windows", async () => {
    mockAb1ToJson.mockResolvedValue([makeParsedTrace()]);
    const trace = await parseAb1File(new ArrayBuffer(8));
    const reversed = reverseAb1Trace(trace);
    // ACGTACGT is a reverse-complement palindrome, so its reverse complement
    // reads the same left-to-right.
    expect(reversed.sequence).toBe("ACGTACGT");
    expect(reversed.baseCalls).toEqual(["A", "C", "G", "T", "A", "C", "G", "T"]);
    // First window of the reversed trace = flipped channels of the last window
    // (index 7 is a T call, so the reversed A channel carries the peak).
    expect(reversed.baseTraces[0]!.aTrace).toEqual([3, 2, 1]);
    expect(reversed.baseTraces[0]!.tTrace).toEqual([0, 0, 0]);
    expect(reversed.baseTraces[0]!.gTrace).toEqual([0, 0, 0]);
    expect(reversed.baseTraces[0]!.cTrace).toEqual([0, 0, 0]);
    expect(reversed.qualNums).toEqual([40, 37, 42, 40, 38, 41, 39, 40]);
    expect(reversed.basePos).toEqual([260, 230, 200, 170, 140, 110, 80, 50]);
  });
});
