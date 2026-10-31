import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import {
  FollowupService,
  followupService,
} from "@/lib/services/followup-service";

import { requireWritePermission } from "./shared";

/**
 * `create_followup` — WRITE.
 *
 * Starts a follow-up cadence on a conversation. It is reversible (an enrollment
 * can be paused or stopped), so it runs without confirmation, and it never
 * sends anything by itself: the cadence produces a draft the user approves.
 *
 * Follow-ups live on the mirrored thread model, so this resolves the provider
 * thread id (Gmail or `outlook:`-prefixed) to its mirror row; an unsynced
 * thread returns a clear result instead of a half-created enrollment.
 */

const inputSchema = z.object({
  threadId: z
    .string()
    .min(1)
    .max(256)
    .describe("The thread id from search_emails or get_thread."),
  afterDays: z
    .number()
    .int()
    .min(1)
    .max(30)
    .optional()
    .describe("Days to wait before the first nudge (default 3)."),
  maxAttempts: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe("How many nudges before the cadence completes (default 3)."),
});

export type CreateFollowupInput = z.infer<typeof inputSchema>;

function buildCreateFollowupTool(
  followups: FollowupService,
): AnyToolDefinition {
  return defineTool({
    name: "create_followup",
    description:
      "Start a gentle follow-up cadence on a conversation: after a few days it prepares a nudge draft for the user to approve. Nothing is sent automatically. Use it when the user asks to follow up or bump a thread. Pass afterDays for an explicit wait; if the user left the timing vague — and no timing was fixed earlier in this thread — ask before starting.",
    risk: "WRITE",
    inputSchema,
    authorize(ctx) {
      requireWritePermission(ctx);
    },
    async execute(ctx, input) {
      return followups.createFollowup({
        userId: ctx.userId,
        gmailThreadId: input.threadId,
        ...(input.afterDays !== undefined ? { afterDays: input.afterDays } : {}),
        ...(input.maxAttempts !== undefined
          ? { maxAttempts: input.maxAttempts }
          : {}),
      });
    },
  });
}

/** `create_followup` — WRITE. Injectable for tests. */
export function createCreateFollowupTool(
  deps: { followups?: FollowupService } = {},
): AnyToolDefinition {
  return buildCreateFollowupTool(deps.followups ?? followupService);
}

export const createFollowupTool = buildCreateFollowupTool(followupService);
