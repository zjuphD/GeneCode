/**
 * SandboxDiffDialog — side-by-side diff between the original document and the
 * Agent copy opened as a new file.
 *
 * Shows the before (original) and after (copy) sequences in paired columns
 * with differing regions highlighted (red for removed, green for added), plus
 * change statistics and next/previous navigation between diff regions so the
 * user can confirm the sandbox edit before exporting.
 */

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import type { SequenceDocument } from "../types";
import { diffSequences, buildDiffRows, type DiffRow } from "../agent/sequenceDiff";

export interface SandboxDiffProps {
  original: SequenceDocument;
  copy: SequenceDocument;
  onClose: () => void;
}

function rowClass(kind: DiffRow["left"] extends undefined ? never : DiffRow["left"] extends { kind: infer K } ? K : never): string {
  const map: Record<string, string> = {
    equal: "",
    insert: " sandbox-diff__seq--insert",
    delete: " sandbox-diff__seq--delete",
    before: " sandbox-diff__seq--before",
    after: " sandbox-diff__seq--after",
  };
  return map[kind] ?? "";
}

function SeqCell({
  text,
  kind,
  empty,
}: {
  text: string;
  kind: string;
  empty: boolean;
}) {
  const classes = `sandbox-diff__seq${empty ? " sandbox-diff__seq--empty" : ""}${kind ? rowClass(kind as never) : ""}`;
  return (
    <code className={classes} aria-hidden={empty}>
      {empty ? "" : text}
    </code>
  );
}

export function SandboxDiffDialog({ original, copy, onClose }: SandboxDiffProps) {
  const [focusedRegion, setFocusedRegion] = useState(0);
  const regionRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const dialogRef = useRef<HTMLDivElement>(null);

  const diff = useMemo(
    () => diffSequences(original.sequence, copy.sequence),
    [original.sequence, copy.sequence],
  );
  const rows = useMemo(() => buildDiffRows(diff), [diff]);

  // Collect row indices where a changed region begins (for navigation).
  const regionRowIndexes = useMemo(() => {
    const indexes: number[] = [];
    let inRegion = false;
    rows.forEach((row, index) => {
      const changed =
        (row.left && row.left.kind !== "equal") ||
        (row.right && row.right.kind !== "equal");
      if (changed && !inRegion) {
        indexes.push(index);
        inRegion = true;
      } else if (!changed) {
        inRegion = false;
      }
    });
    return indexes;
  }, [rows]);

  const scrollToRegion = (index: number) => {
    if (regionRowIndexes.length === 0) return;
    const target = regionRowIndexes[index] ?? regionRowIndexes[0]!;
    const el = regionRefs.current.get(target);
    // jsdom (and some SSR environments) do not implement scrollIntoView.
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  };

  // On open, land the user directly on the change: give the dialog focus and
  // scroll the FIRST changed region into view instead of showing the top of
  // the sequence. For a long construct the edit may be far from base 1, so
  // without this the user would still have to hunt for the diff they came to
  // confirm. Runs once when the dialog mounts; the manual prev/next buttons
  // keep working afterward.
  // A-A11Y-001: capture the trigger BEFORE the dialog takes focus (the focus
  // layout effect below must run second so the trigger is remembered); Escape
  // closes the dialog and focus returns to the trigger on close. The trigger is
  // captured once on mount — a callback-identity dep would re-run and capture
  // the dialog's own focused element instead.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useLayoutEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  useLayoutEffect(() => {
    dialogRef.current?.focus();
    if (regionRowIndexes.length > 0) scrollToRegion(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goToRegion = (direction: 1 | -1) => {
    if (regionRowIndexes.length === 0) return;
    setFocusedRegion((current) => {
      const next = (current + direction + regionRowIndexes.length) % regionRowIndexes.length;
      // Scroll after state settles via a microtask.
      requestAnimationFrame(() => scrollToRegion(next));
      return next;
    });
  };

  const regionCount = regionRowIndexes.length;
  const focusedLabel = regionCount > 0 ? `${focusedRegion + 1}/${regionCount}` : "0/0";

  return createPortal(
    <div className="sandbox-diff-overlay" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="sandbox-diff"
        role="dialog"
        aria-modal="true"
        aria-label="沙盒差异比较"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="sandbox-diff__header">
          <div className="sandbox-diff__title">
            <strong>沙盒改动确认</strong>
            <span className="sandbox-diff__subtitle">
              {original.name} → {copy.name} · 原文件未改动
            </span>
          </div>
          <button
            type="button"
            className="sandbox-diff__close"
            onClick={onClose}
            aria-label="关闭差异比较"
            title="Close"
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="sandbox-diff__stats" aria-label="差异统计">
          <span className="sandbox-diff__stat sandbox-diff__stat--before">
            {diff.beforeLength.toLocaleString()} bp → {diff.afterLength.toLocaleString()} bp
          </span>
          <span className="sandbox-diff__stat">{diff.changedRegions} 处改动</span>
          {diff.insertedBp > 0 && (
            <span className="sandbox-diff__stat sandbox-diff__stat--insert">+{diff.insertedBp} bp</span>
          )}
          {diff.deletedBp > 0 && (
            <span className="sandbox-diff__stat sandbox-diff__stat--delete">−{diff.deletedBp} bp</span>
          )}
          <div className="sandbox-diff__nav">
            <button
              type="button"
              onClick={() => goToRegion(-1)}
              disabled={regionCount === 0}
              aria-label="上一个变更区域"
              title="Previous change"
            >
              <ArrowLeft aria-hidden="true" />
            </button>
            <span className="sandbox-diff__nav-count" aria-live="polite">{focusedLabel}</span>
            <button
              type="button"
              onClick={() => goToRegion(1)}
              disabled={regionCount === 0}
              aria-label="下一个变更区域"
              title="Next change"
            >
              <ArrowRight aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="sandbox-diff__columns">
          <div className="sandbox-diff__column">
            <div className="sandbox-diff__column-label sandbox-diff__column-label--original">
              原序列 <span>{original.name}</span>
            </div>
          </div>
          <div className="sandbox-diff__column">
            <div className="sandbox-diff__column-label sandbox-diff__column-label--copy">
              副本 <span>{copy.name}</span>
            </div>
          </div>
        </div>

        <div className="sandbox-diff__scroll">
          <div className="sandbox-diff__scroll-inner">
            {rows.map((row, index) => {
              const changed =
                (row.left && row.left.kind !== "equal") ||
                (row.right && row.right.kind !== "equal");
              const isRegionStart = regionRowIndexes.includes(index);
              return (
                <div
                  key={index}
                  ref={(node) => {
                    if (node && isRegionStart) regionRefs.current.set(index, node);
                    if (!node) regionRefs.current.delete(index);
                  }}
                  className={`sandbox-diff__row${changed ? " sandbox-diff__row--changed" : ""}`}
                >
                  <code className={`sandbox-diff__num${isRegionStart ? " sandbox-diff__num--start" : ""}`}>
                    {index + 1}
                  </code>
                  <div className="sandbox-diff__cell">
                    <SeqCell
                      text={row.left?.text ?? ""}
                      kind={row.left?.kind ?? ""}
                      empty={!row.left}
                    />
                  </div>
                  <div className="sandbox-diff__cell">
                    <SeqCell
                      text={row.right?.text ?? ""}
                      kind={row.right?.kind ?? ""}
                      empty={!row.right}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <footer className="sandbox-diff__footer">
          <p>
            红色为删除/替换前的片段，绿色为插入/替换后的片段。确认无误后可导出该副本。
          </p>
          <button type="button" className="sandbox-diff__done" onClick={onClose}>
            知道了
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

export default SandboxDiffDialog;
