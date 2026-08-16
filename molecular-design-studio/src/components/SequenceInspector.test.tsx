import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SequenceDocument, SequenceFeature, SequenceSelection } from "../types";
import { SequenceInspector } from "./SequenceInspector";

const doc: SequenceDocument = {
  name: "Insert",
  sequence: "ATGAAACCCGGG",
  circular: false,
  features: [],
};

const selection: SequenceSelection = {
  start: 0,
  end: 6,
  length: 6,
  wrapsOrigin: false,
  sequence: "ATGAAA",
};

const callbacks = {
  onUpdateFeature: vi.fn(),
  onDeleteFeature: vi.fn(),
  onAddFeature: vi.fn(),
  onExtractSelection: vi.fn(),
};

describe("SequenceInspector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("creates an annotation from the current selection", () => {
    render(<SequenceInspector doc={doc} selection={selection} feature={null} {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "添加注释" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Promoter" } });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));

    expect(callbacks.onAddFeature).toHaveBeenCalledWith({
      name: "Promoter",
      type: "misc_feature",
      color: "#4f7fa8",
    });
  });

  it("shows persisted primer metadata", () => {
    const feature: SequenceFeature = {
      id: "primer-1",
      name: "Forward primer",
      type: "primer",
      start: 0,
      end: 6,
      strand: 1,
      qualifiers: {
        sequence: ["GGGGATGAAA"],
        binding_sequence: ["ATGAAA"],
        tm: ["61.2"],
        gc_percent: ["50"],
        direction: ["forward"],
      },
    };
    render(<SequenceInspector doc={doc} selection={selection} feature={feature} {...callbacks} />);

    expect(screen.getByText("引物详情")).toBeDefined();
    expect(screen.getByText("GGGGATGAAA")).toBeDefined();
    expect(screen.getByText("61.2 C")).toBeDefined();
  });

  it("translates reverse-strand features in their biological orientation", async () => {
    const reverseSelection = { ...selection, sequence: "TTTCAT" };
    const feature: SequenceFeature = {
      id: "cds-1",
      name: "Reverse CDS",
      type: "CDS",
      start: 0,
      end: 6,
      strand: -1,
      qualifiers: {},
    };
    render(<SequenceInspector doc={doc} selection={reverseSelection} feature={feature} {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "翻译" }));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("MK"));
  });
});
