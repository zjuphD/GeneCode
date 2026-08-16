import {
  Bot,
  Clock3,
  History,
  Pencil,
  RotateCcw,
  Scissors,
  Tag,
  Trash2,
} from "lucide-react";
import type {
  DocumentHistoryEntry,
  DocumentHistorySource,
} from "../workspace/documentHistory";

interface DocumentHistoryPanelProps {
  history: DocumentHistoryEntry[];
  onRestore: (id: string, version?: "before" | "after") => void;
  onClear: () => void;
}

const SOURCE_ICON: Record<DocumentHistorySource, typeof Pencil> = {
  manual: Pencil,
  agent: Bot,
  annotation: Tag,
  selection: Scissors,
  history: RotateCcw,
};

function changeSummary(entry: DocumentHistoryEntry): string {
  const lengthDelta = entry.after.sequence.length - entry.before.sequence.length;
  const featureDelta = entry.after.features.length - entry.before.features.length;
  const details: string[] = [];
  if (lengthDelta) details.push(`${lengthDelta > 0 ? "+" : ""}${lengthDelta} bp`);
  if (featureDelta) details.push(`${featureDelta > 0 ? "+" : ""}${featureDelta} annotations`);
  return details.length ? details.join(" · ") : "元数据或序列内容已变更";
}

export function DocumentHistoryPanel({
  history,
  onRestore,
  onClear,
}: DocumentHistoryPanelProps) {
  if (!history.length) {
    return (
      <div className="history-empty">
        <History aria-hidden="true" />
        <strong>暂无文档历史记录</strong>
        <p>手动编辑、注释、选区操作和已接受的 Agent 更改会显示在这里。</p>
      </div>
    );
  }

  return (
    <div className="document-history">
      <div className="document-history__current">
        <span className="document-history__dot" />
        <div>
          <strong>当前序列</strong>
          <span>已记录 {history.length} 个操作</span>
        </div>
        <button type="button" onClick={onClear} title="清除文档历史" aria-label="清除文档历史">
          <Trash2 aria-hidden="true" />
        </button>
      </div>
      <ol className="document-history__list">
        {[...history].reverse().map((entry) => {
          const SourceIcon = SOURCE_ICON[entry.source];
          return (
            <li key={entry.id}>
              <span className="document-history__rail" />
              <span className="document-history__icon"><SourceIcon aria-hidden="true" /></span>
              <div className="document-history__content">
                <strong>{entry.label}</strong>
                <span>{changeSummary(entry)}</span>
                <small><Clock3 aria-hidden="true" /> {new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
                <button type="button" onClick={() => onRestore(entry.id, "before")}>
                  <RotateCcw aria-hidden="true" />
                  恢复到本步骤之前
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
