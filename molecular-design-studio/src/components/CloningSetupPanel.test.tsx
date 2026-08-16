import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CloningSetupPanel } from "./CloningSetupPanel";

describe("CloningSetupPanel", () => {
  it("submits ordered Gibson fragments as structured inputs", () => {
    const onSubmit = vi.fn();
    render(<CloningSetupPanel busy={false} available onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("片段 1 序列"), { target: { value: "ATGCATGC" } });
    fireEvent.change(screen.getByLabelText("片段 2 序列"), { target: { value: "GGCCTTAA" } });
    fireEvent.change(screen.getByLabelText("载体左侧同源臂"), { target: { value: "AAAACCCC" } });
    fireEvent.change(screen.getByLabelText("载体右侧同源臂"), { target: { value: "GGGGTTTT" } });
    fireEvent.click(screen.getByRole("button", { name: "生成克隆计划" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.stringContaining("multi-fragment Gibson cloning"),
      expect.objectContaining({
        method: "gibson",
        fragments: [
          { name: "Fragment 1", sequence: "ATGCATGC" },
          { name: "Fragment 2", sequence: "GGCCTTAA" },
        ],
        leftHomology: "AAAACCCC",
        rightHomology: "GGGGTTTT",
      }),
      "Structured setup: Gibson / homologous recombination · 2 fragments",
    );
  });

  it("validates Golden Gate internal overhang count", () => {
    const onSubmit = vi.fn();
    render(<CloningSetupPanel busy={false} available onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("组装方法"), { target: { value: "golden_gate" } });
    fireEvent.change(screen.getByLabelText("片段 1 序列"), { target: { value: "ATGCATGC" } });
    fireEvent.change(screen.getByLabelText("片段 2 序列"), { target: { value: "GGCCTTAA" } });
    fireEvent.change(screen.getByLabelText("载体左侧边界"), { target: { value: "AATG" } });
    fireEvent.change(screen.getByLabelText("内部突出端"), { target: { value: "GCTT, CGAG" } });
    fireEvent.change(screen.getByLabelText("载体右侧边界"), { target: { value: "TCCA" } });
    fireEvent.click(screen.getByRole("button", { name: "生成克隆计划" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("需要 1 个内部突出端");
  });

  it("submits Golden Gate overhangs in fragment order", () => {
    const onSubmit = vi.fn();
    render(<CloningSetupPanel busy={false} available onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("组装方法"), { target: { value: "golden_gate" } });
    fireEvent.change(screen.getByLabelText("片段 1 序列"), { target: { value: "ATGCATGC" } });
    fireEvent.change(screen.getByLabelText("片段 2 序列"), { target: { value: "GGCCTTAA" } });
    fireEvent.change(screen.getByLabelText("载体左侧边界"), { target: { value: "aatg" } });
    fireEvent.change(screen.getByLabelText("内部突出端"), { target: { value: "gctt" } });
    fireEvent.change(screen.getByLabelText("载体右侧边界"), { target: { value: "cgag" } });
    fireEvent.click(screen.getByRole("button", { name: "生成克隆计划" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.stringContaining("Golden Gate cloning"),
      expect.objectContaining({
        method: "golden_gate",
        typeIisEnzyme: "BsaI",
        leftOverhang: "aatg",
        fragmentOverhangs: ["GCTT"],
        rightOverhang: "cgag",
        goldenGateClampLength: 4,
      }),
      "Structured setup: Golden Gate / BsaI · 2 fragments",
    );
  });

  it("loads an insert directly from the local sequence library", () => {
    const onSubmit = vi.fn();
    render(
      <CloningSetupPanel
        busy={false}
        available
        onSubmit={onSubmit}
        activeProjectId="vector"
        sequenceLibrary={[
          { id: "vector", name: "pUC19", sequence: "VECTOR", circular: true, featureCount: 4 },
          { id: "insert", name: "EGFP", sequence: "ATGCATGC", circular: false, featureCount: 1 },
        ]}
      />,
    );

    fireEvent.change(screen.getByLabelText("片段 1 来源"), { target: { value: "insert" } });
    fireEvent.change(screen.getByLabelText("片段 2 序列"), { target: { value: "GGCCTTAA" } });
    fireEvent.click(screen.getByRole("button", { name: "生成克隆计划" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.stringContaining("multi-fragment Gibson cloning"),
      expect.objectContaining({
        fragments: [
          { name: "EGFP", sequence: "ATGCATGC" },
          { name: "Fragment 2", sequence: "GGCCTTAA" },
        ],
      }),
      expect.any(String),
    );
    expect(screen.queryByRole("option", { name: /pUC19/ })).toBeNull();
  });
});
