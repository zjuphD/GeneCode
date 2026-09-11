/**
 * File-level commands and current document status.
 *
 * Compact workbench commands, using the same icon system as Agent.
 */

import { Chip, Tooltip } from "@mui/material";
import { FilePlus2, FolderOpen, Import, Redo2, Save, SaveAll, TriangleAlert, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { MOD_KEY } from "./documentShortcuts";

export interface DocumentToolbarProps {
  /** Sequence length in base pairs. */
  sequenceLength: number;
  /** Whether the molecule is circular. */
  circular: boolean;
  /** Number of annotation features. */
  featureCount: number;
  /** Short status message. */
  status: string | null;
  /** Status type for styling — "success" or "error". */
  statusType: "success" | "error" | null;
  /** Called when the New button is clicked. */
  onNew: () => void;
  /** Called when the Open button is clicked. */
  onOpen: () => void;
  /** Called when the Import FASTA button is clicked. */
  onImport?: () => void;
  /** Called when the Save File button is clicked. */
  onSave: () => void;
  /** Called when the Save File As button is clicked. */
  onSaveAs: () => void;
  /** A-STATE-001: canonical undo/redo actions from the workspace log. */
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  /** Optional sequence-analysis and document-action menu. */
  tools?: ReactNode;
}

/**
 * A-PERF-001: sequences above this size are interactively usable but slow
 * (1Mb takes tens of seconds to first paint). Surface the supported-scale
 * baseline instead of letting users discover the limit mid-workflow.
 */
const LARGE_SEQUENCE_BP = 100_000;

function DocumentToolbar({
  sequenceLength,
  circular,
  featureCount,
  status,
  statusType,
  onNew,
  onOpen,
  onImport,
  onSave,
  onSaveAs,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  tools,
}: DocumentToolbarProps) {
  return (      <div className="doc-toolbar" aria-label="文档工具栏">
      <div className="doc-toolbar__group">
        <button
          type="button"
          className="doc-toolbar__btn"
          onClick={onNew}
          title="新建序列"
          aria-label="新建序列"
        >
          <FilePlus2 aria-hidden="true" />
          <span>新建</span>
        </button>
        <button
          type="button"
          className="doc-toolbar__btn"
          onClick={onOpen}
          title={`打开文件 (${MOD_KEY}+O)`}
          aria-label={`打开文件 (${MOD_KEY}+O)`}
        >
          <FolderOpen aria-hidden="true" />
          <span>打开</span>
        </button>
        {onImport && (
          <button
            type="button"
            className="doc-toolbar__btn"
            onClick={onImport}
            title="导入一个或多个 FASTA 记录"
            aria-label="导入一个或多个 FASTA 记录"
          >
            <Import aria-hidden="true" />
            <span>导入</span>
          </button>
        )}
      </div>
      {(onUndo || onRedo) && (
        <>
          <span className="doc-toolbar__divider" aria-hidden="true" />
          <div className="doc-toolbar__group">
            <button
              type="button"
              className="doc-toolbar__btn"
              onClick={onUndo}
              disabled={!canUndo}
              title={`撤销 (${MOD_KEY}+Z)`}
              aria-label={`撤销 (${MOD_KEY}+Z)`}
            >
              <Undo2 aria-hidden="true" />
              <span>撤销</span>
            </button>
            <button
              type="button"
              className="doc-toolbar__btn"
              onClick={onRedo}
              disabled={!canRedo}
              title={`重做 (${MOD_KEY}+Shift+Z)`}
              aria-label={`重做 (${MOD_KEY}+Shift+Z)`}
            >
              <Redo2 aria-hidden="true" />
              <span>重做</span>
            </button>
          </div>
        </>
      )}
      <span className="doc-toolbar__divider" aria-hidden="true" />
      <div className="doc-toolbar__group">
        <button
          type="button"
          className="doc-toolbar__btn doc-toolbar__btn--save"
          onClick={onSave}
          title={`保存文件 (${MOD_KEY}+S)`}
          aria-label={`保存文件 (${MOD_KEY}+S)`}
        >
          <Save aria-hidden="true" />
          <span>保存</span>
        </button>
        <button
          type="button"
          className="doc-toolbar__btn"
          onClick={onSaveAs}
          title={`文件另存为 (${MOD_KEY}+Shift+S)`}
          aria-label={`文件另存为 (${MOD_KEY}+Shift+S)`}
        >
          <SaveAll aria-hidden="true" />
          <span>另存为</span>
        </button>
      </div>
      {tools && (
        <>
          <span className="doc-toolbar__divider" aria-hidden="true" />
          <div className="doc-toolbar__group">{tools}</div>
        </>
      )}

      <div className="doc-toolbar__spacer" />

      <div className="doc-toolbar__metadata" role="group" aria-label="序列元信息">
        {sequenceLength > LARGE_SEQUENCE_BP && (
          <Tooltip title={`当前序列 ${sequenceLength.toLocaleString()} bp，超出推荐支持上限（${LARGE_SEQUENCE_BP.toLocaleString()} bp）。大序列的图谱渲染与编辑响应会明显变慢，建议拆分或精简特征。`}>
            <Chip
              size="small"
              variant="outlined"
              className="doc-toolbar__chip doc-toolbar__chip--large-seq"
              icon={<TriangleAlert aria-hidden="true" />}
              label={`${sequenceLength.toLocaleString()} bp (DNA)`}
              aria-label={`当前序列 ${sequenceLength.toLocaleString()} bp，超出推荐支持上限（${LARGE_SEQUENCE_BP.toLocaleString()} bp）。大序列的图谱渲染与编辑响应会明显变慢，建议拆分或精简特征。`}
            />
          </Tooltip>
        )}
        {sequenceLength <= LARGE_SEQUENCE_BP && (
          <Chip size="small" variant="outlined" className="doc-toolbar__chip" label={`${sequenceLength.toLocaleString()} bp (DNA)`} />
        )}
        <Chip size="small" variant="outlined" className="doc-toolbar__chip" label={circular ? "环状" : "线性"} />
        <Chip size="small" variant="outlined" className="doc-toolbar__chip" label={`${featureCount} 个特征`} />
      </div>

      {status && (
        <span
          className={`doc-toolbar__status doc-toolbar__status--${statusType ?? "success"}`}
          title={status}
        >
          {status}
        </span>
      )}
    </div>
  );
}

export default DocumentToolbar;
