/**
 * CopyActionButton — clipboard copy with success/failure feedback.
 *
 * Shared between AgentPanel and CandidateCards.
 */

import { useState, useRef, useEffect, useCallback } from "react";

type CopyFeedback = "idle" | "success" | "failure";

export function CopyActionButton({ label, getText }: { label: string; getText: () => string }) {
  const [feedback, setFeedback] = useState<CopyFeedback>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(getText());
      setFeedback("success");
    } catch {
      setFeedback("failure");
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setFeedback("idle"), 2000);
  }, [getText]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="agent-copy-action">
      <button
        type="button"
        className="agent-btn agent-btn--secondary"
        onClick={handleCopy}
      >
        {label}
      </button>
      {feedback === "success" && (
        <span className="agent-copy-action__feedback">已复制</span>
      )}
      {feedback === "failure" && (
        <span className="agent-copy-action__feedback agent-copy-action__feedback--error">
          复制失败
        </span>
      )}
    </div>
  );
}
