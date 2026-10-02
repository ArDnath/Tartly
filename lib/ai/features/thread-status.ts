import "server-only";

import { z } from "zod";

/**
 * Reply Zero — AI thread status (Phase 4).
 *
 * "Waiting on them" versus "needs you" is the single most useful inbox signal:
 * it is what lets the user stop mentally tracking every thread. The status is
 * produced by the existing **batched triage** call (one extra enum field, no
 * extra model call) and always has a deterministic fallback here, so the inbox
 * never mislabels a thread when the model is unavailable.
 *
 * The deterministic rule is intentionally conservative:
 *   - the last message is outbound  → `awaiting_them`
 *   - the last message is inbound and asks something → `needs_reply`
 *   - otherwise → `none`
 */

export const REPLY_STATUSES = ["needs_reply", "awaiting_them", "none"] as const;
export type ReplyStatus = (typeof REPLY_STATUSES)[number];

export const replyStatusSchema = z.enum(REPLY_STATUSES);

export function normalizeReplyStatus(value: unknown): ReplyStatus | null {
  const parsed = replyStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Question/request phrasing that means a human is waiting on the user. */
const ASK_PATTERN =
  /\b(can you|could you|would you|will you|please|need you|let me know|thoughts|feedback|review|confirm|approve|any update|following up|when can|are you able)\b|\?/i;

export type ReplyStatusInput = {
  /** "inbound" | "outbound" | null when the thread has no messages yet. */
  lastDirection: string | null;
  subject?: string | null;
  body?: string | null;
};

/** Deterministic fallback; pure and unit-testable. */
export function deriveReplyStatus({
  lastDirection,
  subject,
  body,
}: ReplyStatusInput): ReplyStatus {
  if (lastDirection === "outbound") return "awaiting_them";
  if (lastDirection !== "inbound") return "none";

  const text = `${subject ?? ""}\n${body ?? ""}`;
  return ASK_PATTERN.test(text) ? "needs_reply" : "none";
}

/**
 * True when the deterministic signal is ambiguous enough to benefit from the
 * model's opinion. `awaiting_them` from the last direction is unambiguous; only
 * an inbound last message can be misread, so triage may override those.
 */
export function shouldAskModel(input: ReplyStatusInput): boolean {
  return input.lastDirection === "inbound";
}

export const REPLY_STATUS_LABELS: Record<ReplyStatus, string> = {
  needs_reply: "Needs you",
  awaiting_them: "Waiting on them",
  none: "No reply needed",
};

/**
 * Deterministic mapping from the triage category, used when the last message's
 * direction is not cheaply available. Kept here (not in `triage.ts`) so the
 * inbox and the Reply Zero surface agree on one rule.
 */
export function replyStatusFromCategory(category: string): ReplyStatus {
  switch (category) {
    case "awaiting_reply":
      return "awaiting_them";
    case "needs_reply":
    case "meeting_request":
      return "needs_reply";
    default:
      return "none";
  }
}
