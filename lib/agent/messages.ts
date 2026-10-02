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

/**
 * The model-facing view of a stored message. Custom UI parts (briefing cards)
 * are not part of the AI SDK's part union, so they are flattened to a short
 * text note the model can read; everything else passes through untouched. The
 * UI keeps using `storedMessageToUIMessage` and renders the real cards.
 */
export function storedMessageToModelUIMessage(
  message: StoredConversationMessage,
): UIMessage {
  const parts = message.parts.map((part) => {
    if ((part as { type?: string }).type === "briefing") {
      const card = part as {
        kind?: string;
        title?: string;
        subtitle?: string;
      };
      const label = [card.title, card.subtitle].filter(Boolean).join(" · ");
      return {
        type: "text" as const,
        text: `[Briefing card: ${card.kind ?? "item"}${label ? ` — ${label}` : ""}]`,
      };
    }
    return part;
  });
  return {
    id: message.id,
    role: message.role,
    parts: parts as UIMessage["parts"],
  };
}

/** Concatenate a UI message's text parts (used for titles and logging). */
export function extractUIMessageText(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}
