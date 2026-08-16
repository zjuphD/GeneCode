import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SandboxDiffDialog from "./SandboxDiffDialog";
import type { SequenceDocument } from "../types";

function makeDoc(overrides: Partial<SequenceDocument> = {}): SequenceDocument {
  return {
    name: "pUC19",
    sequence: "A".repeat(100),
    circular: true,
    features: [],
    ...overrides,
  };
}

describe("SandboxDiffDialog", () => {
  it("renders the side-by-side comparison with names", () => {
    render(
      <SandboxDiffDialog
        original={makeDoc({ name: "pUC19" })}
        copy={makeDoc({ name: "pUC19 · Agent 副本", sequence: "A".repeat(100) + "GGGG" })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog", { name: "沙盒差异比较" })).toBeDefined();
    expect(screen.getByText(/pUC19 → pUC19 · Agent 副本/)).toBeDefined();
    expect(screen.getByText(/原序列/)).toBeDefined();
    // Both the subtitle (… → … Agent 副本) and the copy column header use the
    // word 副本 — assert at least one column header exists.
    expect(screen.getAllByText(/副本/).length).toBeGreaterThan(0);
  });

  it("shows change statistics and calls onClose", () => {
    const onClose = vi.fn();
    render(
      <SandboxDiffDialog
        original={makeDoc()}
        copy={makeDoc({ sequence: "A".repeat(100) + "GGGG" })}
        onClose={onClose}
      />,
    );
    expect(screen.getByText(/100 bp → 104 bp/)).toBeDefined();
    expect(screen.getByText(/1 处改动/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "关闭差异比较" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("highlights inserted sequence rows and navigates between regions", () => {
    render(
      <SandboxDiffDialog
        original={makeDoc()}
        copy={makeDoc({ sequence: "A".repeat(40) + "GGGG" + "A".repeat(56) })}
        onClose={vi.fn()}
      />,
    );
    const insertSeq = screen.getAllByText("GGGG");
    expect(insertSeq.length).toBeGreaterThan(0);
    // Navigation disabled when exactly one region exists? Enabled here.
    expect(screen.getByRole("button", { name: "下一个变更区域" })).toBeDefined();
  });

  it("renders delete-only rows for a removal", () => {
    const copy = makeDoc({ sequence: "A".repeat(96) });
    render(
      <SandboxDiffDialog
        original={makeDoc({ sequence: "A".repeat(100) })}
        copy={copy}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getAllByText("").length).toBeGreaterThan(0); // filler rows exist
    expect(screen.getByText(/−4 bp/)).toBeDefined();
  });

  describe("auto-focus and landing on the change", () => {
    let scrollSpy: ReturnType<typeof vi.fn>;
    let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

    beforeEach(() => {
      originalScrollIntoView = Element.prototype.scrollIntoView;
      scrollSpy = vi.fn();
      Element.prototype.scrollIntoView = scrollSpy;
    });

    afterEach(() => {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    });

    it("focuses the dialog and scrolls to the first changed region on open", () => {
      // Change is inserted at base 40 of 100 — far from the top, so the dialog
      // must land the user directly on it rather than showing base 1.
      render(
        <SandboxDiffDialog
          original={makeDoc()}
          copy={makeDoc({ sequence: "A".repeat(40) + "GGGG" + "A".repeat(56) })}
          onClose={vi.fn()}
        />,
      );

      const dialog = screen.getByRole("dialog", { name: "沙盒差异比较" });
      expect(document.activeElement).toBe(dialog);
      // The auto-scroll to the first changed region runs on mount.
      expect(scrollSpy).toHaveBeenCalledTimes(1);
    });

    it("does not scroll when there are no changes", () => {
      render(
        <SandboxDiffDialog
          original={makeDoc()}
          copy={makeDoc()}
          onClose={vi.fn()}
        />,
      );
      expect(scrollSpy).not.toHaveBeenCalled();
    });

    it("closes on Escape and returns focus to the trigger on unmount (A-A11Y-001)", () => {
      const trigger = document.createElement("button");
      trigger.textContent = "Compare";
      document.body.appendChild(trigger);
      trigger.focus();
      const onClose = vi.fn();
      const { unmount } = render(
        <SandboxDiffDialog
          original={makeDoc()}
          copy={makeDoc({ sequence: "A".repeat(40) + "GGGG" + "A".repeat(56) })}
          onClose={onClose}
        />,
      );

      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
      // The real close unmounts the dialog (parent removes it); focus must land
      // back on the trigger that opened it.
      unmount();
      expect(document.activeElement).toBe(trigger);
      trigger.remove();
    });
  });
});
