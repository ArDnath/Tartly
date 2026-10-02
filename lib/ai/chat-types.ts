/**
 * Shared chat types (safe to import from client and server).
 */

export type ChatThread = {
  id: string;
  title: string | null;
  isWorkspaceSetup: boolean;
  /** "chat" | "briefing" — the persistent morning-briefing conversation. */
  kind?: string;
  archivedAt: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessageRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: string;
  role: ChatMessageRole;
  text: string;
  createdAt: string;
  /** Optimistic/client-only messages have a temporary id. */
  pending?: boolean;
  /** Queued client-side while another reply is streaming. */
  queued?: boolean;
};

export type SuggestedPrompt = {
  id: string;
  label: string;
  prompt: string;
};
