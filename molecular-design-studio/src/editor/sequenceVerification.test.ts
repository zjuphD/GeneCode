import { describe, expect, it } from "vitest";
import { normalizeVerificationSequence, verifySequence } from "./sequenceVerification";
import { reverseComplement } from "./sequenceActions";

describe("sequence verification", () => {
  it("normalizes pasted sequence text", () => {
    expect(normalizeVerificationSequence("1 atgc-u.\n2")).toBe("ATGCT");
  });

  it("places a read within a longer reference", () => {
    const result = verifySequence("AAAACCCCGGGGTTTT", "CCCGGGG");
    expect(result).toMatchObject({
      orientation: "forward",
      referenceStart: 5,
      referenceEnd: 12,
      matches: 7,
      substitutions: 0,
      insertions: 0,
      deletions: 0,
    });
    expect(result.identityPercent).toBe(100);
  });

  it("automatically detects reverse-complement reads", () => {
    const reference = "AAAACCCCATGCGTACGATTTT";
    const read = reverseComplement("ATGCGTACGA");
    const result = verifySequence(reference, read);
    expect(result.orientation).toBe("reverse");
    expect(result.referenceStart).toBe(8);
    expect(result.identityPercent).toBe(100);
  });

  it("reports substitutions, insertions, and deletions", () => {
    const substitution = verifySequence("AAAACCCCGGGG", "AAAATCCCGGGG");
    expect(substitution.substitutions).toBe(1);
    expect(substitution.changes[0]).toMatchObject({ kind: "substitution", referencePosition: 4 });

    const insertion = verifySequence("ATGACCTGGA", "ATGACCATGGA");
    expect(insertion.insertions).toBe(1);

    const deletion = verifySequence("ATGACCTGGA", "ATGACTGGA");
    expect(deletion.deletions).toBe(1);
  });

  it("aligns reads that cross a circular origin", () => {
    const result = verifySequence("AAAACCCCGGGG", "GGGGAAAA", true);
    expect(result.identityPercent).toBe(100);
    expect(result.wrapsOrigin).toBe(true);
    expect(result.referenceStart).toBe(8);
    expect(result.referenceEnd).toBe(4);
  });
});
