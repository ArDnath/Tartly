import type { UIMessage } from "ai";

import type { ChatMessagePart } from "@/lib/db/schema";

/**
 * Conversions between persisted message parts and the AI SDK `UIMessage` shape
 * the client's `useChat` rehydrates. Pure and dependency-light so both the
 * route and tests can use it.
 */

export type StoredConversationMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  parts: ChatMessagePart[];
  createdAt: string;
};

export function storedMessageToUIMessage(
  message: StoredConversationMessage,
): UIMessage {
  return {
    id: message.id,
    role: message.role,
    // The parts column carries exactly the UIMessage part union; the cast just
    // re-narrows the persisted JSON to the SDK type.
    parts: message.parts as UIMessage["parts"],
  };
}

/** Concatenate a UI message's text parts (used for titles and logging). */
export function extractUIMessageText(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}
