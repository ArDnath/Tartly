/**
 * Realtime event vocabulary for the agent surface.
 *
 * The wire format is Server-Sent Events; this module owns the event shapes and
 * their encoding so the route and the client hook cannot drift. The events are
 * deliberately small: a client reconciles state from the DTO, it never trusts
 * an event to mutate anything.
 *
 * Pure module (no `server-only`) so the client hook can import the types.
 */

export interface AgentActionDto {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  argumentsHash: string;
  provider: string;
  status: string;
  conversationId: string;
  expiresAt: string;
  confirmedAt: string | null;
  executedAt: string | null;
  result: Record<string, unknown> | null;
  createdAt: string;
}

export interface MailThreadDto {
  id: string;
  gmailThreadId: string;
  subject: string | null;
  lastMessageAt: string | null;
  isUnread: boolean;
}

export type AgentRealtimeEvent =
  | { type: "hello"; at: string }
  | { type: "ping"; at: string }
  | { type: "reconnect"; at: string; reason: string }
  | { type: "action.updated"; at: string; action: AgentActionDto }
  | { type: "mail.updated"; at: string; thread: MailThreadDto };

/** Encode one event as an SSE frame. */
export function encodeSse(event: AgentRealtimeEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export const AGENT_EVENT_NAME = "action.updated";
export const MAIL_EVENT_NAME = "mail.updated";
