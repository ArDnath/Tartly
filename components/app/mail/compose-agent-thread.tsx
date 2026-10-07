"use client";

import type { ChatStatus, UIMessage } from "ai";

import {
  Conversation,
  ConversationContent,
} from "@/components/ai-elements/conversation";
import { AgentMessage } from "@/components/app/assistant/agent-message";

/**
 * The compose agent's live "thinking" surface.
 *
 * It renders through the exact same `AgentMessage` used by the assistant space,
 * so the composer shows the identical chain-of-thought animation and per-tool
 * steps while the agent searches the mailbox and writes. Loaded on demand (see
 * `compose-dialog`), so the AI Elements stack is not in the initial mail bundle.
 */
export function ComposeAgentThread({
  messages,
  status,
}: {
  messages: UIMessage[];
  status: ChatStatus;
}) {
  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent className="gap-3 p-4">
        {messages.map((message, index) => (
          <AgentMessage
            key={message.id}
            message={message}
            isStreaming={
              status === "streaming" && index === messages.length - 1
            }
          />
        ))}
      </ConversationContent>
    </Conversation>
  );
}
