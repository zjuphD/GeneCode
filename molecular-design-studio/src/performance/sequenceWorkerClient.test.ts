import { describe, expect, it } from "vitest";
import { analyzeSequenceInWorker } from "./sequenceWorkerClient";

describe("sequence analysis worker client", () => {
  it("keeps a deterministic fallback when module workers are unavailable", async () => {
    const result = await analyzeSequenceInWorker("AAAAGAATTCTTT");
    expect(result.usedWorker).toBe(false);
    expect(result.stats.length).toBe(13);
    expect(result.restrictionSites).toEqual([
      { enzyme: "EcoRI", motif: "GAATTC", positions: [4] },
    ]);
  });
});
