import { useCallback, useEffect, useState } from "react";
import HistoryRounded from "@mui/icons-material/HistoryRounded";
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded";
import ChatBubbleOutlineRounded from "@mui/icons-material/ChatBubbleOutlineRounded";
import {
  CONVERSATION_HISTORY_UPDATED_EVENT,
  loadConversationHistory,
  type AgentConversationHistoryEntry,
} from "../agent/conversationHistory";
import { workspaceDisplayLabel } from "./agentPanelHelpers";

interface AgentConversationHistoryProps {
  onClose: () => void;
  onContinue: (entry: AgentConversationHistoryEntry) => void;
}

function timeLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function ConversationTranscript({ entry }: { entry: AgentConversationHistoryEntry }) {
  return (
    <div className="agent-conversation-history__transcript" aria-label={`${entry.title} 对话内容`}>
      {entry.messages.map((message, index) => (
        <div
          key={`${entry.id}-${index}`}
          className={`agent-conversation-history__message agent-conversation-history__message--${message.role}`}
        >
          <span className="agent-conversation-history__message-role">
            {message.role === "user" ? "你" : "Agent"}
          </span>
          <p>{message.content}</p>
        </div>
      ))}
    </div>
  );
}

export function AgentConversationHistory({ onClose, onContinue }: AgentConversationHistoryProps) {
  const [entries, setEntries] = useState<AgentConversationHistoryEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = useCallback(() => setEntries(loadConversationHistory()), []);

  useEffect(() => {
    refresh();
    window.addEventListener(CONVERSATION_HISTORY_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(CONVERSATION_HISTORY_UPDATED_EVENT, refresh);
  }, [refresh]);

  return (
    <section className="agent-conversation-history-panel" aria-label="Agent 历史对话">
      <div className="agent-conversation-history-panel__header">
        <div>
          <strong>
            <HistoryRounded aria-hidden="true" />
            历史对话
          </strong>
          <span>本机保存最近 50 个 Agent 对话</span>
        </div>
        <button type="button" className="agent-conversation-history-panel__close" onClick={onClose}>
          收起
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="agent-conversation-history-panel__empty">
          <ChatBubbleOutlineRounded aria-hidden="true" />
          <strong>还没有历史对话</strong>
          <span>完成一次 Agent 对话后，会自动出现在这里。</span>
        </div>
      ) : (
        <div className="agent-conversation-history-panel__list">
          {entries.map((entry) => {
            const expanded = expandedId === entry.id;
            return (
              <article key={entry.id} className={`agent-conversation-history-panel__item${expanded ? " is-expanded" : ""}`}>
                <div className="agent-conversation-history-panel__summary-row">
                  <button
                    type="button"
                    className="agent-conversation-history-panel__summary"
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : entry.id)}
                  >
                    <ChevronRightRounded aria-hidden="true" />
                    <span className="agent-conversation-history-panel__summary-copy">
                      <strong>{entry.title}</strong>
                      <span>
                        {workspaceDisplayLabel(entry.workspace)} · {entry.messages.length} 条消息 · {timeLabel(entry.timestamp)}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="agent-conversation-history-panel__continue"
                    aria-label={`继续对话：${entry.title}`}
                    onClick={() => onContinue(entry)}
                  >
                    继续
                  </button>
                </div>
                {expanded && (
                  <>
                    <ConversationTranscript entry={entry} />
                    <div className="agent-conversation-history-panel__actions">
                      <button
                        type="button"
                        className="agent-btn agent-btn--primary"
                        onClick={() => onContinue(entry)}
                      >
                        继续此对话
                      </button>
                      <span>恢复消息后会按当前序列重新规划，不会自动应用旧结果。</span>
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
