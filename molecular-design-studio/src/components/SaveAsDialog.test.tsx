import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SaveAsDialog, type SaveAsSelection } from "./SaveAsDialog";
import type { SequenceDocument } from "../types";

const doc: SequenceDocument = {
  name: "pUC19",
  sequence: "A".repeat(100),
  circular: true,
  accession: "M77789.2",
  features: [
    {
      id: "f1",
      name: "ampR",
      type: "CDS",
      start: 0,
      end: 10,
      strand: 1,
      qualifiers: {},
    },
    {
      id: "f2",
      name: "lacZ",
      type: "gene",
      start: 20,
      end: 40,
      strand: -1,
      qualifiers: { product: ["beta-galactosidase"] },
    },
  ],
};

function renderDialog(onConfirm = vi.fn(), onCancel = vi.fn()) {
  return render(
    <SaveAsDialog
      doc={doc}
      defaultName="pUC19.gb"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
}

describe("SaveAsDialog", () => {
  it("renders with the default file name and format options", () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "另存为" })).toBeDefined();
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
      "pUC19",
    );
    expect(screen.getByText("GenBank")).toBeDefined();
    expect(screen.getByText("FASTA")).toBeDefined();
    expect(screen.getByText("SnapGene (.dna)")).toBeDefined();
  });

  it("confirms with the chosen format appended to the file name", () => {
    const onConfirm = vi.fn();
    renderDialog(onConfirm);
    fireEvent.click(screen.getByLabelText("FASTA"));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    const selection = onConfirm.mock.calls[0]![0] as SaveAsSelection;
    expect(selection.filename).toBe("pUC19.fa");
    expect(selection.format).toBe("fasta");
  });

  it("shows the lossy warning for FASTA when features exist", () => {
    renderDialog();
    fireEvent.click(screen.getByLabelText("FASTA"));
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText(/该格式会丢失部分数据/)).toBeDefined();
    expect(screen.getByText(/特征注解/)).toBeDefined();
  });

  it("shows no warning for GenBank", () => {
    renderDialog();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("warns about accession loss for SnapGene .dna", () => {
    renderDialog();
    fireEvent.click(screen.getByLabelText("SnapGene (.dna)"));
    expect(screen.getByText(/SnapGene \.dna 中无对应字段/)).toBeDefined();
  });

  it("disables Save for an empty file name", () => {
    renderDialog();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "  " } });
    expect(
      (screen.getByRole("button", { name: "保存" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("cancels without confirming", () => {
    const onCancel = vi.fn();
    renderDialog(vi.fn(), onCancel);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
