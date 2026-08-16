/**
 * Application-level Save As (A-FILE-001).
 *
 * The browser build has no native save dialog, so previously "Save As" just
 * wrote a .gb file with no way to pick a format — and a .dna/.fa import would
 * silently be re-saved as GenBank. This dialog asks for the format up front
 * and shows exactly what the chosen format drops (lossy export warning).
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, FileDown, X } from "lucide-react";
import type { SequenceDocument } from "../types";
import { getExportLosses } from "../editor/exportLosses";
import type { SequenceFileFormat } from "../editor/fileFormats";

interface SaveAsOption {
  format: SequenceFileFormat;
  label: string;
  extension: string;
}

const OPTIONS: SaveAsOption[] = [
  { format: "genbank", label: "GenBank", extension: "gb" },
  { format: "fasta", label: "FASTA", extension: "fa" },
  { format: "snapgene", label: "SnapGene (.dna)", extension: "dna" },
];

export interface SaveAsSelection {
  filename: string;
  format: SequenceFileFormat;
}

interface SaveAsDialogProps {
  doc: SequenceDocument;
  defaultName: string;
  onConfirm: (selection: SaveAsSelection) => void;
  onCancel: () => void;
}

function basenameWithoutExtension(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? name;
  return base.replace(/\.[^.]+$/, "") || "sequence";
}

export function SaveAsDialog({
  doc,
  defaultName,
  onConfirm,
  onCancel,
}: SaveAsDialogProps) {
  const [fileName, setFileName] = useState(basenameWithoutExtension(defaultName));
  const [format, setFormat] = useState<SequenceFileFormat>("genbank");

  const losses = useMemo(() => getExportLosses(doc, format), [doc, format]);

  const submit = () => {
    const trimmed = fileName.trim();
    if (!trimmed) return;
    const option = OPTIONS.find((o) => o.format === format) ?? OPTIONS[0]!;
    onConfirm({ filename: `${trimmed}.${option.extension}`, format });
  };

  // Escape anywhere in the dialog closes it (not just on the text input),
  // matching native dialog behavior even when a radio is focused.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);

  return createPortal(
    <div
      className="save-as-dialog__overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className="save-as-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-as-dialog-title"
      >
        <div className="save-as-dialog__header">
          <span className="save-as-dialog__title-row">
            <FileDown aria-hidden="true" />
            <h2 id="save-as-dialog-title">另存为</h2>
          </span>
          <button
            type="button"
            className="save-as-dialog__close"
            aria-label="取消保存"
            onClick={onCancel}
          >
            <X aria-hidden="true" />
          </button>
        </div>

        <label className="save-as-dialog__field">
          <span>文件名</span>
          <input
            type="text"
            value={fileName}
            onChange={(event) => setFileName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            autoFocus
          />
          <span className="save-as-dialog__hint">.{(OPTIONS.find((o) => o.format === format) ?? OPTIONS[0])!.extension}</span>
        </label>

        <fieldset className="save-as-dialog__field">
          <legend>格式</legend>
          <div className="save-as-dialog__formats" role="radiogroup" aria-label="导出格式">
            {OPTIONS.map((option) => (
              <label key={option.format} className="save-as-dialog__format">
                <input
                  type="radio"
                  name="save-as-format"
                  value={option.format}
                  checked={format === option.format}
                  onChange={() => setFormat(option.format)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {losses.length > 0 && (
          <div className="save-as-dialog__lossy" role="alert">
            <AlertTriangle aria-hidden="true" />
            <div>
              <strong>该格式会丢失部分数据</strong>
              <ul>
                {losses.map((loss) => (
                  <li key={loss.field}>{loss.description}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="save-as-dialog__actions">
          <button type="button" className="save-as-dialog__cancel" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="save-as-dialog__confirm"
            onClick={submit}
            disabled={!fileName.trim()}
          >
            保存
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
