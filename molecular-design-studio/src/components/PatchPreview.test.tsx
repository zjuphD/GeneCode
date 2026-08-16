import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PatchPreviewPanel from "./PatchPreview";
import type { PatchPreview } from "../agent/patchTypes";

function makePreview(overrides: Partial<PatchPreview> = {}): PatchPreview {
  return {
    patchId: "p1",
    title: "Test Patch",
    summary: "A test",
    baseHash: "fnv1a64-v1:abc",
    proposedHash: "fnv1a64-v1:def",
    beforeLength: 100,
    afterLength: 104,
    operations: [
      {
        operationId: "op1",
        kind: "insert",
        coordinates: "@10",
        reason: "add bases",
        lengthDelta: 4,
      },
    ],
    affectedFeatures: [],
    warnings: [],
    errors: [],
    proposedDocument: null,
    ...overrides,
  };
}

describe("PatchPreviewPanel", () => {
  it("renders title and summary", () => {
    render(
      <PatchPreviewPanel
        preview={makePreview()}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText("Test Patch")).toBeDefined();
    expect(screen.getByText("A test")).toBeDefined();
  });

  it("renders operation rows", () => {
    render(
      <PatchPreviewPanel
        preview={makePreview()}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText("insert")).toBeDefined();
    expect(screen.getByText(/add bases/)).toBeDefined();
  });

  it("renders before/after length", () => {
    render(
      <PatchPreviewPanel
        preview={makePreview()}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText(/100 bp/)).toBeDefined();
    expect(screen.getByText(/104 bp/)).toBeDefined();
  });

  it("Apply is enabled when no errors and no warnings", () => {
    render(
      <PatchPreviewPanel
        preview={makePreview()}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    const applyBtn = screen.getByText("应用到载体");
    expect(applyBtn).not.toHaveProperty("disabled", true);
  });

  it("Apply is disabled when there are errors", () => {
    render(
      <PatchPreviewPanel
        preview={makePreview({ errors: ["something broke"] })}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    const applyBtn = screen.getByText("应用到载体") as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
  });

  it("Apply is disabled when warnings exist but not acknowledged", () => {
    render(
      <PatchPreviewPanel
        preview={makePreview({ warnings: ["feature expanded"] })}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    const applyBtn = screen.getByText("应用到载体") as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
  });

  it("Apply is enabled when warnings are acknowledged", () => {
    render(
      <PatchPreviewPanel
        preview={makePreview({ warnings: ["feature expanded"] })}
        warningsAcknowledged={true}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    const applyBtn = screen.getByText("应用到载体") as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(false);
  });

  it("calls onApply when Apply is clicked", () => {
    const onApply = vi.fn();
    render(
      <PatchPreviewPanel
        preview={makePreview()}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={onApply}
        onReject={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("应用到载体"));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("calls onReject when Reject is clicked", () => {
    const onReject = vi.fn();
    render(
      <PatchPreviewPanel
        preview={makePreview()}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={onReject}
      />,
    );
    fireEvent.click(screen.getByText("拒绝"));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("renders error messages", () => {
    render(
      <PatchPreviewPanel
        preview={makePreview({ errors: ["bad hash", "invalid op"] })}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText("bad hash")).toBeDefined();
    expect(screen.getByText("invalid op")).toBeDefined();
  });

  it("renders warning messages and acknowledgement checkbox", () => {
    render(
      <PatchPreviewPanel
        preview={makePreview({ warnings: ["clipped feature"] })}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText("clipped feature")).toBeDefined();
    expect(screen.getByText(/我已了解/)).toBeDefined();
  });

  it("renders affected features", () => {
    render(
      <PatchPreviewPanel
        preview={makePreview({
          affectedFeatures: [
            {
              featureId: "f1",
              featureName: "lacZ",
              action: "transformed",
              detail: "shifted right by 4bp",
            },
          ],
        })}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText("lacZ")).toBeDefined();
    expect(screen.getByText(/shifted right/)).toBeDefined();
  });

  it("does not render the copy-to-new-file button when the handler is absent", () => {
    render(
      <PatchPreviewPanel
        preview={makePreview()}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.queryByText("复制为新文件并应用")).toBeNull();
  });

  it("renders the copy-to-new-file button and its original-untouched note", () => {
    render(
      <PatchPreviewPanel
        preview={makePreview()}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
        onApplyAsNewFile={vi.fn()}
      />,
    );
    expect(screen.getByText("复制为新文件并应用")).toBeDefined();
    expect(screen.getByText(/原文件保持不变/)).toBeDefined();
  });

  it("calls onApplyAsNewFile when the copy button is clicked", () => {
    const onApplyAsNewFile = vi.fn();
    render(
      <PatchPreviewPanel
        preview={makePreview()}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
        onApplyAsNewFile={onApplyAsNewFile}
      />,
    );
    fireEvent.click(screen.getByText("复制为新文件并应用"));
    expect(onApplyAsNewFile).toHaveBeenCalledTimes(1);
  });

  it("disables the copy button when the preview has errors", () => {
    render(
      <PatchPreviewPanel
        preview={makePreview({ errors: ["something broke"] })}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
        onApplyAsNewFile={vi.fn()}
      />,
    );
    const copyBtn = screen.getByText("复制为新文件并应用") as HTMLButtonElement;
    expect(copyBtn.disabled).toBe(true);
  });

  it("disables the copy button until warnings are acknowledged", () => {
    render(
      <PatchPreviewPanel
        preview={makePreview({ warnings: ["feature expanded"] })}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
        onApplyAsNewFile={vi.fn()}
      />,
    );
    const copyBtn = screen.getByText("复制为新文件并应用") as HTMLButtonElement;
    expect(copyBtn.disabled).toBe(true);
  });

  // ── Diff track visualization ──────────────────────────────

  function previewWithOps(operations: PatchPreview["operations"]) {
    return makePreview({
      beforeLength: 100,
      operations,
    });
  }

  it("renders the proposed diff track with kind-specific blocks", () => {
    render(
      <PatchPreviewPanel
        preview={previewWithOps([
          {
            operationId: "op1",
            kind: "insert",
            coordinates: "@50",
            reason: "add MCS",
            lengthDelta: 4,
            position: 50,
          },
          {
            operationId: "op2",
            kind: "delete",
            coordinates: "[10, 20)",
            reason: "remove linker",
            lengthDelta: -10,
            start: 10,
            end: 20,
          },
        ])}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Proposed diff 示意图：各操作在原始序列上的位置")).toBeDefined();
    expect(screen.getByText("插入 +4 bp")).toBeDefined();
    expect(screen.getByText("删除 10 bp")).toBeDefined();
    const blocks = document.querySelectorAll(".patch-preview__diff-block");
    expect(blocks.length).toBe(2);
    expect(blocks[0]!.className).toContain("patch-preview__diff-block--insert");
    expect(blocks[1]!.className).toContain("patch-preview__diff-block--delete");
  });

  it("renders the diff legend", () => {
    const { container } = render(
      <PatchPreviewPanel
        preview={previewWithOps([{
          operationId: "op1",
          kind: "replace",
          coordinates: "[30, 35)",
          reason: "swap",
          lengthDelta: 2,
          start: 30,
          end: 35,
        }])}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText("替换 +2 bp")).toBeDefined();
    // The legend is decorative (aria-hidden), so assert its text via the DOM.
    const legend = container.querySelector(".patch-preview__diff-legend");
    expect(legend).not.toBeNull();
    expect(legend!.textContent).toContain("插入");
    expect(legend!.textContent).toContain("删除");
    expect(legend!.textContent).toContain("替换");
    expect(legend!.textContent).toContain("特征");
  });

  it("reveals blocks one by one as revealedCount grows, ghosting the rest", () => {
    const { container, rerender } = render(
      <PatchPreviewPanel
        preview={previewWithOps([
          {
            operationId: "op1",
            kind: "insert",
            coordinates: "@50",
            reason: "add MCS",
            lengthDelta: 4,
            position: 50,
          },
          {
            operationId: "op2",
            kind: "delete",
            coordinates: "[10, 20)",
            reason: "remove linker",
            lengthDelta: -10,
            start: 10,
            end: 20,
          },
        ])}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
        revealedCount={1}
      />,
    );
    const blocks = container.querySelectorAll(".patch-preview__diff-block");
    expect(blocks.length).toBe(2);
    // First marker lit with the pop animation class; second is a ghost.
    expect(blocks[0]!.className).toContain("patch-preview__diff-block--revealed");
    expect(blocks[1]!.className).toContain("patch-preview__diff-block--ghost");
    expect(container.querySelector(".patch-preview__diff-item--ghost")).not.toBeNull();

    // Playback finishes: both blocks light up, progress badge disappears.
    rerender(
      <PatchPreviewPanel
        preview={previewWithOps([
          {
            operationId: "op1",
            kind: "insert",
            coordinates: "@50",
            reason: "add MCS",
            lengthDelta: 4,
            position: 50,
          },
          {
            operationId: "op2",
            kind: "delete",
            coordinates: "[10, 20)",
            reason: "remove linker",
            lengthDelta: -10,
            start: 10,
            end: 20,
          },
        ])}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
        revealedCount={2}
      />,
    );
    const blocksAfter = container.querySelectorAll(".patch-preview__diff-block");
    expect(blocksAfter[0]!.className).toContain("patch-preview__diff-block--revealed");
    expect(blocksAfter[1]!.className).toContain("patch-preview__diff-block--revealed");
    expect(container.querySelector(".patch-preview__diff-progress")).toBeNull();
  });

  it("lights every block by default when revealedCount is omitted", () => {
    const { container } = render(
      <PatchPreviewPanel
        preview={previewWithOps([{
          operationId: "op1",
          kind: "insert",
          coordinates: "@50",
          reason: "add MCS",
          lengthDelta: 4,
          position: 50,
        }])}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    const blocks = container.querySelectorAll(".patch-preview__diff-block");
    expect(blocks.length).toBe(1);
    expect(blocks[0]!.className).toContain("patch-preview__diff-block--revealed");
    expect(container.querySelector(".patch-preview__diff-progress")).toBeNull();
  });

  it("shows a before→after tooltip when hovering a replace block", () => {
    const { container } = render(
      <PatchPreviewPanel
        preview={previewWithOps([{
          operationId: "op1",
          kind: "replace",
          coordinates: "[30, 35)",
          reason: "swap codon",
          lengthDelta: 2,
          start: 30,
          end: 35,
          beforeSequence: "ATGCC",
          afterSequence: "GGATCC",
        }])}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();
    const block = container.querySelector(".patch-preview__diff-block") as HTMLElement;
    fireEvent.mouseEnter(block);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("替换前");
    expect(tooltip.textContent).toContain("ATGCC");
    expect(tooltip.textContent).toContain("替换后");
    expect(tooltip.textContent).toContain("GGATCC");
    expect(tooltip.textContent).toContain("swap codon");
    fireEvent.mouseLeave(block);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows the inserted sequence for an insert block on hover", () => {
    const { container } = render(
      <PatchPreviewPanel
        preview={previewWithOps([{
          operationId: "op1",
          kind: "insert",
          coordinates: "@50",
          reason: "add MCS",
          lengthDelta: 4,
          position: 50,
          afterSequence: "GGATCC",
        }])}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    const block = container.querySelector(".patch-preview__diff-block") as HTMLElement;
    fireEvent.mouseEnter(block);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("插入");
    expect(tooltip.textContent).toContain("GGATCC");
    expect(tooltip.textContent).toContain("位置 51");
  });

  it("renders a GC bio badge for an insert with sequence detail", () => {
    render(
      <PatchPreviewPanel
        preview={makePreview({
          operations: [{
            operationId: "op1",
            kind: "insert",
            coordinates: "@50",
            reason: "add MCS",
            lengthDelta: 4,
            position: 50,
            afterSequence: "ATGC",
          }],
        })}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    const chip = screen.getByTitle(/GC 含量 50%/);
    expect(chip.textContent).toContain("插入 GC 50%");
    expect(chip.className).toContain("patch-preview__bio-chip--ok");
  });

  it("warns on extreme GC and shows feature-type badges", () => {
    render(
      <PatchPreviewPanel
        preview={makePreview({
          operations: [
            {
              operationId: "op1",
              kind: "insert",
              coordinates: "@50",
              reason: "add GC-rich linker",
              lengthDelta: 4,
              position: 50,
              afterSequence: "GCCC",
            },
            {
              operationId: "op2",
              kind: "add_feature",
              coordinates: "[40, 60)",
              reason: "mark CDS",
              lengthDelta: 0,
              start: 40,
              end: 60,
              featureName: "GFP",
              featureType: "CDS",
            },
          ],
        })}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    const warnChip = screen.getByTitle(/GC 含量 100% 超出常用区间/);
    expect(warnChip.className).toContain("patch-preview__bio-chip--warn");
    expect(screen.getByText("新增 · CDS")).toBeDefined();
  });

  it("shows no badge row when operations carry no biology detail", () => {
    render(
      <PatchPreviewPanel
        preview={makePreview({
          operations: [{
            operationId: "op1",
            kind: "insert",
            coordinates: "@50",
            reason: "add MCS",
            lengthDelta: 4,
            position: 50,
          }],
        })}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(document.querySelectorAll(".patch-preview__bio-chip").length).toBe(0);
  });

  it("renders translation-consequence badges for a replace with a stop codon", () => {
    render(
      <PatchPreviewPanel
        preview={makePreview({
          operations: [{
            operationId: "op1",
            kind: "replace",
            coordinates: "[10, 16)",
            reason: "swap codon",
            lengthDelta: 0,
            start: 10,
            end: 16,
            beforeSequence: "ATGCAA",
            afterSequence: "ATGTAA",
          }],
        })}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText("引入终止密码子")).toBeDefined();
    // The stop badge's own title mentions the premature termination; the
    // codon-change badge also carries CAA(Q)→TAA(*), so scope precisely.
    expect(screen.getByTitle(/CAA\(Q\).*将提前终止翻译/)).toBeDefined();
    expect(screen.getByTitle(/将提前终止翻译/)).toBeDefined();
  });

  it("renders a frameshift-risk badge for a non-multiple-of-3 replace", () => {
    render(
      <PatchPreviewPanel
        preview={makePreview({
          operations: [{
            operationId: "op1",
            kind: "replace",
            coordinates: "[10, 19)",
            reason: "change length",
            lengthDelta: -4,
            start: 10,
            end: 19,
            beforeSequence: "ATGCCCGGG",
            afterSequence: "ATGCC",
          }],
        })}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    const chip = screen.getByText("移码风险");
    expect(chip.className).toContain("patch-preview__bio-chip--warn");
  });

  it("does not render the diff track when no operations resolve to geometry", () => {
    render(
      <PatchPreviewPanel
        preview={makePreview({
          beforeLength: 100,
          operations: [{
            operationId: "x1",
            kind: "remove_feature",
            coordinates: "missing",
            reason: "cleanup",
            lengthDelta: 0,
          }],
        })}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Proposed diff 示意图：各操作在原始序列上的位置")).toBeNull();
    // The operation table still shows the unresolved row
    expect(screen.getByText("remove_feature")).toBeDefined();
  });

  it("highlights the focused operation row and no others", () => {
    const { container } = render(
      <PatchPreviewPanel
        preview={previewWithOps([
          {
            operationId: "op1",
            kind: "insert",
            coordinates: "@50",
            reason: "add MCS",
            lengthDelta: 4,
            position: 50,
          },
          {
            operationId: "op2",
            kind: "delete",
            coordinates: "[10, 20)",
            reason: "remove linker",
            lengthDelta: -10,
            start: 10,
            end: 20,
          },
        ])}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
        focusedOperationId="op2"
      />,
    );
    const rows = container.querySelectorAll(".patch-preview__ops tbody tr");
    expect(rows.length).toBe(2);
    expect(rows[0]!.className).not.toContain("patch-preview__ops-row--focused");
    expect(rows[1]!.className).toContain("patch-preview__ops-row--focused");
    expect(rows[1]!.getAttribute("data-focused")).toBe("true");
  });

  it("does not focus any row when focusedOperationId is absent", () => {
    const { container } = render(
      <PatchPreviewPanel
        preview={previewWithOps([{
          operationId: "op1",
          kind: "insert",
          coordinates: "@50",
          reason: "add MCS",
          lengthDelta: 4,
          position: 50,
        }])}
        warningsAcknowledged={false}
        onAcknowledgeWarnings={vi.fn()}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(container.querySelector(".patch-preview__ops-row--focused")).toBeNull();
  });
});
