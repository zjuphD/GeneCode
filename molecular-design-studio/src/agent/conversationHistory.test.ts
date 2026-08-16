import { describe, expect, it } from "vitest";
import {
  buildConversationHistoryEntry,
  conversationTitle,
} from "./conversationHistory";

describe("Agent conversation history", () => {
  it("uses the user request as a readable conversation title", () => {
    const entry = buildConversationHistoryEntry({
      id: "conv-1",
      goal: "  Design primers for GAPDH  ",
      workspace: "rtqpcr",
      agentMode: "plan",
      messages: [
        { role: "user", content: "Design primers for GAPDH" },
        { role: "assistant", content: "Please provide an accession." },
      ],
    });

    expect(entry.title).toBe("Design primers for GAPDH");
    expect(entry.messages).toHaveLength(2);
  });

  it("falls back to the first user message when no goal was supplied", () => {
    expect(
      conversationTitle("", [{ role: "user", content: "  Inspect this plasmid  " }]),
    ).toBe("Inspect this plasmid");
  });

  it("keeps only the most recent visible messages", () => {
    const messages = Array.from({ length: 90 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `message ${index}`,
    }));
    const entry = buildConversationHistoryEntry({
      id: "conv-2",
      goal: "Review sequence",
      workspace: "cloning",
      agentMode: "review",
      messages,
    });

    expect(entry.messages).toHaveLength(80);
    expect(entry.messages[0]?.content).toBe("message 10");
    expect(entry.messages[entry.messages.length - 1]?.content).toBe("message 89");
  });
});
