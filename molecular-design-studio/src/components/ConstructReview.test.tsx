import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ResultCandidate } from "../agent/responseTypes";
import { ConstructReview } from "./ConstructReview";
import { getConstructReview } from "./constructReviewModel";

function candidateWithReview(): ResultCandidate {
  return {
    title: "Gibson candidate",
    summary: null,
    forwardPrimer: "AAAACCCCGGGG",
    reversePrimer: "TTTTGGGGCCCC",
    tmForward: 61,
    tmReverse: 61,
    gcForward: 50,
    gcReverse: 50,
    fullLengthForward: 40,
    fullLengthReverse: 40,
    insertLength: 300,
    tmDelta: 0,
    crossDimer: false,
    annealTemp: 58,
    extensionSec: 30,
    raw: {
      construct_review: {
        method: "gibson",
        status: "passed",
        summary: "左右 junction 已通过自动复核。",
        insert: { length: 300 },
        junctions: [
          {
            side: "left",
            label: "Left junction",
            overlap: "AACCGGTTAACCGGTTAACC",
            assembledPreview: "AACCGGTTAACCGGTTAACCATGGC",
          },
          {
            side: "right",
            label: "Right junction",
            overlap: "GGCCAATTGGCCAATTGGCC",
            assembledPreview: "TTAGGCGGCCAATTGGCCAATTGGCC",
          },
        ],
        primerArchitecture: [
          {
            name: "Forward",
            tail: "AACCGGTTAACCGGTTAACC",
            core: "ATGGCC",
            tailPurpose: "左载体 junction",
          },
        ],
        backboneLinearization: {
          available: true,
          status: "passed",
          method: "inverse_pcr",
          vectorTopology: "circular",
          vectorLength: 4_686,
          editMode: "replace",
          editStart: 100,
          editEnd: 106,
          removedLength: 6,
          ampliconLength: 4_680,
          ampliconDigest: "sha256:backbone0123456789",
          forwardPrimer: "GGGAAACCCGGGAAACCCGG",
          reversePrimer: "CCCTTTGGGCCCTTTGGGCC",
          forwardCore: "GGGAAACCCGGGAAACCCGG",
          reverseCore: "CCCTTTGGGCCCTTTGGGCC",
          forwardBinding: { start: 106, end: 128, wrapsOrigin: false },
          reverseBinding: { start: 78, end: 100, wrapsOrigin: false },
          tmForward: 60.5,
          tmReverse: 60.2,
          gcForward: 55,
          gcReverse: 55,
          instructions: ["先用 backbone 引物做 inverse PCR。"],
        },
        expectedConstruct: {
          available: true,
          length: 4_980,
          vectorLength: 4_686,
          replacedLength: 6,
          editMode: "replace",
          editStart: 100,
          editEnd: 106,
          sequenceDigest: "sha256:abcdef0123456789",
        },
        checks: [
          {
            key: "junction_identity",
            label: "Junction 一致性",
            status: "passed",
            detail: "左右 junction 与载体边界一致。",
          },
        ],
      },
    },
  };
}

function candidateWithGoldenGateReview(): ResultCandidate {
  const candidate = candidateWithReview();
  return {
    ...candidate,
    title: "Golden Gate candidate",
    raw: {
      construct_review: {
        method: "golden_gate",
        status: "review",
        summary: "已按两个片段和 BsaI 规划 Golden Gate 组装。",
        insert: { length: 600, fragmentCount: 2 },
        fragmentCount: 2,
        fragments: [
          { name: "Fragment 1", length: 300 },
          { name: "Fragment 2", length: 300 },
        ],
        junctions: [
          { side: "left", label: "Vector → Fragment 1", overlap: "AATG", assembledPreview: "AATG" },
          { side: "middle", label: "Fragment 1 → Fragment 2", overlap: "GCTT", assembledPreview: "GCTT" },
          { side: "right", label: "Fragment 2 → Vector", overlap: "CGAG", assembledPreview: "CGAG" },
        ],
        primerArchitecture: [
          { name: "Fragment 1 Forward", tail: "GGTCTCAATG", core: "ATGC", tailPurpose: "左侧 overhang AATG" },
        ],
        expectedConstruct: { available: false, fragmentCount: 2 },
        checks: [
          { key: "type_iis_internal_sites", label: "片段内部 Type IIS 位点", status: "passed", detail: "未发现内部位点。" },
        ],
      },
    },
  };
}

describe("ConstructReview", () => {
  it("normalizes deterministic construct review data", () => {
    const review = getConstructReview(candidateWithReview());
    expect(review?.status).toBe("passed");
    expect(review?.expectedConstruct.length).toBe(4_980);
    expect(review?.junctions).toHaveLength(2);
    expect(review?.primers[0]?.tail).toBe("AACCGGTTAACCGGTTAACC");
    expect(review?.backboneLinearization?.ampliconLength).toBe(4_680);
  });

  it("renders the assembly gate, junctions, and detailed checks", () => {
    render(<ConstructReview candidate={candidateWithReview()} />);

    expect(screen.getByText("预期构建体")).not.toBeNull();
    expect(screen.getByText("可进入确认")).not.toBeNull();
    expect(screen.getByText("构建体 4,980 bp")).not.toBeNull();
    expect(screen.getByText("替换 [100, 106)")).not.toBeNull();
    expect(screen.getByText("Left junction")).not.toBeNull();
    expect(screen.getByText("载体线性化")).not.toBeNull();
    expect(screen.getByText("4,680 bp backbone")).not.toBeNull();
    expect(screen.getByText("骨架正向引物")).not.toBeNull();

    fireEvent.click(screen.getByText("查看引物结构与自动检查"));
    expect(screen.getByText("Junction 一致性")).not.toBeNull();
    expect(screen.getByText("sha256:abcdef0123456789")).not.toBeNull();
  });

  it("stays hidden for non-cloning results", () => {
    const candidate = { ...candidateWithReview(), raw: {} };
    const { container } = render(<ConstructReview candidate={candidate} />);
    expect(container.childElementCount).toBe(0);
  });

  it("renders Golden Gate overhang review data", () => {
    const review = getConstructReview(candidateWithGoldenGateReview());
    expect(review?.method).toBe("golden_gate");
    expect(review?.junctions).toHaveLength(3);

    render(<ConstructReview candidate={candidateWithGoldenGateReview()} />);

    expect(screen.getByText("Golden Gate 组装复核")).not.toBeNull();
    expect(screen.getByText("需要复核")).not.toBeNull();
    expect(screen.getAllByText("4 bp 突出端")).toHaveLength(3);
    expect(screen.getByText("片段内部 Type IIS 位点")).not.toBeNull();
  });
});
