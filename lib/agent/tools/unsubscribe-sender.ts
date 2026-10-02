import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import { performUnsubscribe } from "@/lib/ai/features/unsubscribe";

import { requireSendPermission, recipientSchema } from "./shared";

/**
 * `unsubscribe_sender` — EXTERNAL_SIDE_EFFECT.
 *
 * Sends a real unsubscribe request to the sender (RFC 8058 one-click) or
 * surfaces the mailto/link, and can archive the thread. Because it contacts a
 * third party, the model can only *propose* it: the deterministic permission
 * engine turns it into a `pending_action` the user must confirm.
 */

const inputSchema = z.object({
  senderEmail: recipientSchema.describe(
    "The sender's address, from search_emails or get_sender_profile.",
  ),
  threadId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("The thread to archive after unsubscribing, if any."),
  archiveThread: z
    .boolean()
    .optional()
    .describe("Archive the thread after unsubscribing. Defaults to true."),
});

export type UnsubscribeSenderInput = z.infer<typeof inputSchema>;

export const unsubscribeSenderTool: AnyToolDefinition = defineTool({
  name: "unsubscribe_sender",
  description:
    "Unsubscribe from a bulk/newsletter sender and archive the thread. Calling this does NOT act immediately: it creates a confirmation card the user must approve. Prefers the sender's one-click endpoint; otherwise returns the address or link the user must use.",
  risk: "EXTERNAL_SIDE_EFFECT",
  inputSchema,
  authorize(ctx) {
    requireSendPermission(ctx);
  },
  async execute(ctx, input) {
    const result = await performUnsubscribe({
      userId: ctx.userId,
      senderEmail: input.senderEmail,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.archiveThread !== undefined
        ? { archiveThread: input.archiveThread }
        : {}),
    });
    return {
      senderEmail: input.senderEmail,
      method: result.method,
      status: result.status,
      target: result.target,
      archived: result.archived,
      notice: result.note,
    };
  },
});
