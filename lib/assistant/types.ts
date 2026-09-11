/**
 * Route-scoped assistant types, shared by the client rail and the API route.
 */
import type { ComponentType } from "react";

export type AssistantScope = "mail" | "calendar";

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type AssistantQuickAction = {
  id: string;
  label: string;
  /** Sent verbatim as the user's message when the chip is clicked. */
  prompt: string;
  /** Optional leading glyph, used by the chat-style rail's suggestion rows. */
  icon?: ComponentType<{ className?: string }>;
};

/** Live, serializable snapshot of the route, sent to the model for context. */
export type AssistantContext = Record<string, unknown>;
