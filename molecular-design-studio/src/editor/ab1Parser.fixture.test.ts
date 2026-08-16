import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseAb1File } from "./ab1Parser";

// The narrow node:fs / node:path declarations live in src/types/ambient.d.ts
// (this project intentionally has no @types/node).

/**
 * Integration test against the real committed fixture
 * (scripts/make_minimal_ab1.py -> src/fixtures/synthetic_trace.ab1).
 *
 * Unlike ab1Parser.test.ts (which mocks @teselagen/bio-parsers), this test
 * feeds the actual ABI bytes through the real ab1ToJson parser, so any drift
 * in the byte layout (header size, directory entry fields, count-as-bytes
 * quirk) or a bio-parsers upgrade surfaces here instead of only failing in
 * manual node checks.
 */
// Vitest runs from the project root (molecular-design-studio/).
const fixturePath = resolve(process.cwd(), "src/fixtures/synthetic_trace.ab1");

describe("parseAb1File on the real fixture", () => {
  it("parses the synthetic .ab1 into a full trace", async () => {
    const bytes = readFileSync(fixturePath);
    const file = new File([bytes], "synthetic_trace.ab1", {
      type: "application/octet-stream",
    });
    const trace = await parseAb1File(file);

    // 57 basecalls taken from the pUC19 MCS (HindIII -> EcoRI).
    expect(trace.baseCalls).toHaveLength(57);
    expect(trace.sequence).toBe(
      "AAGCTTGCATGCCTGCAGGTCGACTCTAGAGGATCCCCGGGTACCGAGCTCGAATTC",
    );
    expect(trace.baseTraces).toHaveLength(57);
    expect(trace.basePos).toHaveLength(57);
    expect(trace.qualNums).toHaveLength(57);
    expect(trace.traceLength).toBeGreaterThan(0);
  });

  it("renders a dominant dye channel matching every called base", async () => {
    const bytes = readFileSync(fixturePath);
    const file = new File([bytes], "synthetic_trace.ab1", {
      type: "application/octet-stream",
    });
    const trace = await parseAb1File(file);

    const baseToChannel = { A: "aTrace", T: "tTrace", G: "gTrace", C: "cTrace" } as const;
    const channels = ["aTrace", "tTrace", "gTrace", "cTrace"] as const;
    let matches = 0;
    trace.baseTraces.forEach((window, index) => {
      const sums = channels.map((channel) =>
        window[channel].reduce((total, value) => total + Math.abs(value), 0),
      );
      const dominant = channels[sums.indexOf(Math.max(...sums))];
      if (dominant === baseToChannel[trace.baseCalls[index] as keyof typeof baseToChannel]) {
        matches += 1;
      }
    });
    expect(matches).toBe(trace.baseCalls.length);
  });
});
