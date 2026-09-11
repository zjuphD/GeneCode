import { describe, expect, it, vi, type Mock } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CloningWizardDialog } from "./CloningWizardDialog";
import type { SequenceDocument, SequenceSelection } from "../types";

function makeVector(sequence = "GGGGCCCCAAAATTTT", circular = true): SequenceDocument {
  return {
    name: "pVector",
    sequence,
    circular,
    features: [
      { id: "v1", name: "ampR", type: "gene", start: 2, end: 6, strand: 1, qualifiers: {} },
    ],
  };
}

function makeSelection(): SequenceSelection {
  return {
    start: 2,
    end: 8,
    length: 6,
    wrapsOrigin: false,
    sequence: "GCCCAA",
  };
}

function renderWizard(overrides: { onCreate?: Mock<(doc: SequenceDocument) => void> } = {}) {
  const onCreate: Mock<(doc: SequenceDocument) => void> = overrides.onCreate ?? vi.fn();
  const onCancel = vi.fn();
  const view = render(
    <CloningWizardDialog
      vector={makeVector()}
      selection={makeSelection()}
      onCreate={onCreate}
      onCancel={onCancel}
    />,
  );
  return { onCreate, onCancel, unmount: view.unmount };
}

describe("CloningWizardDialog", () => {
  it("defaults to the selection as the insert source", () => {
    renderWizard();
    expect(screen.getByText("克隆到载体")).toBeDefined();
    expect(screen.getByText(/载体 pVector/)).toBeDefined();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("6 bp")).toBeDefined();
  });

  it("simulates a Gibson assembly and reports the construct length", () => {
    renderWizard();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/22 bp/)).toBeDefined(); // 16 + 6
    expect(within(dialog).getByText("模拟构建体")).toBeDefined();
  });

  it("creates the construct document on demand", () => {
    const { onCreate } = renderWizard();
    fireEvent.click(screen.getByText("创建构建体"));
    expect(onCreate).toHaveBeenCalledTimes(1);
    const construct = onCreate.mock.calls[0]?.[0] as SequenceDocument | undefined;
    // Selection starts at 2 → the vector is cut before base 3, so the insert
    // lands at the end of the linearized (rotated) vector.
    expect(construct?.sequence).toBe("GGCCCCAAAATTTTGGGCCCAA");
    expect(construct?.circular).toBe(true);
    expect(construct?.features.some((f) => f.name.startsWith("Insert:"))).toBe(true);
    expect(construct?.features.some((f) => f.id === "v1")).toBe(true);
  });

  it("switches to Golden Gate and validates overhangs", () => {
    const { onCreate } = renderWizard();
    fireEvent.change(screen.getByLabelText("组装方法"), { target: { value: "golden_gate" } });
    const dialog = screen.getByRole("dialog");
    // Missing overhangs surface as failed checks and block creation
    expect(within(dialog).getAllByText("需修正").length).toBeGreaterThan(0);
    expect((screen.getByText("仅预览（不可创建）") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("载体左侧突出"), { target: { value: "AATG" } });
    fireEvent.change(screen.getByLabelText("载体右侧突出"), { target: { value: "TCCA" } });
    expect(within(dialog).getByText(/AATG \/ CATT/)).toBeDefined(); // left + its rc
    const create = screen.getByText("仅预览（不可创建）") as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(create.title).toContain("仅供预览");
    fireEvent.click(create);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("blocks creation while the insert sequence is missing in paste mode", () => {
    renderWizard();
    fireEvent.click(screen.getByLabelText("粘贴序列"));
    const create = screen.getByText("创建构建体") as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(screen.getByText("添加插入片段")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("建议")).toBeNull();
  });

  it("closes on Escape and returns focus to the trigger (A-A11Y-001)", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Clone";
    document.body.appendChild(trigger);
    trigger.focus();
    const { onCancel, unmount } = renderWizard();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭克隆对话框" }));
    const workspaceEscape = vi.fn();
    window.addEventListener("keydown", workspaceEscape);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(workspaceEscape).not.toHaveBeenCalled();
    unmount();
    expect(document.activeElement).toBe(trigger);
    window.removeEventListener("keydown", workspaceEscape);
    trigger.remove();
  });

  it("keeps the default insertion point at the selection start", () => {
    renderWizard();
    const position = screen.getByLabelText(/插入位置/) as HTMLInputElement;
    expect(position.value).toBe("3"); // selection.start(2) + 1
  });

  it.each(["", "0", "18", "2.5"])("blocks invalid position %s without showing a misleading preview", (value) => {
    const { onCreate } = renderWizard();
    fireEvent.change(screen.getByLabelText(/插入位置/), { target: { value } });
    expect(screen.getByLabelText(/插入位置/).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("检查插入位置")).toBeDefined();
    const create = screen.getByRole("button", { name: "创建构建体" });
    expect((create as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(create);
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/插入位置/), { target: { value: "17" } });
    expect((create as HTMLButtonElement).disabled).toBe(false);
  });

  it("blocks mismatching Gibson arms and recovers after correction", () => {
    const { onCreate } = renderWizard();
    fireEvent.change(screen.getByLabelText(/插入位置/), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText(/左同源臂/), { target: { value: "AAAA" } });
    const create = screen.getByRole("button", { name: "创建构建体" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("不匹配");
    fireEvent.click(create);
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/左同源臂/), { target: { value: "CCCC" } });
    expect(create.disabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps keyboard navigation inside the dialog, including when creation is disabled", () => {
    renderWizard();
    const close = screen.getByRole("button", { name: "关闭克隆对话框" });
    const create = screen.getByRole("button", { name: "创建构建体" });
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(create);
    fireEvent.keyDown(create, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.click(screen.getByLabelText("粘贴序列"));
    close.focus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "取消" }));
  });
});
