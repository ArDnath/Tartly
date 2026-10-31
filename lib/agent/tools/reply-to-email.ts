import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import {
  MAX_SEND_BODY_CHARS,
  SendService,
  sendService,
} from "@/lib/services/send-service";

import { requireSendPermission } from "./shared";

/**
 * `reply_to_email` — EXTERNAL_SIDE_EFFECT.
 *
 * Threading is resolved server-side from the original message: the recipient is
 * its sender, the subject is prefixed once, and the Gmail thread id /
 * In-Reply-To headers keep the reply in the same conversation. The model never
 * chooses the From address.
 */

const inputSchema = z.object({
  messageId: z
    .string()
    .min(1)
    .max(256)
    .describe("The message id (from search_emails or get_email) being replied to."),
  body: z
    .string()
    .min(1)
    .max(MAX_SEND_BODY_CHARS)
    .describe("The plain-text reply body."),
});

export type ReplyToEmailInput = z.infer<typeof inputSchema>;

function buildReplyToEmailTool(sender: SendService): AnyToolDefinition {
  return defineTool({
    name: "reply_to_email",
    description:
      "Prepare a reply to an existing message. Calling this does NOT send anything: it creates a confirmation card the user must approve. The recipient, subject and threading are derived from the original message.",
    risk: "EXTERNAL_SIDE_EFFECT",
    inputSchema,
    authorize(ctx) {
      requireSendPermission(ctx);
    },
    async execute(ctx, input) {
      const result = await sender.replyToMessage({
        userId: ctx.userId,
        ...(ctx.idempotencyKey ? { idempotencyKey: ctx.idempotencyKey } : {}),
        messageId: input.messageId,
        body: input.body,
      });

      return {
        sent: !result.deduped,
        deduped: result.deduped,
        provider: result.provider,
        to: result.to,
        subject: result.subject,
        gmailMessageId: result.gmailMessageId,
        notice: result.deduped
          ? "This reply was already sent; it was not sent again."
          : "Reply sent.",
      };
    },
  });
}

/** `reply_to_email` — EXTERNAL_SIDE_EFFECT. Injectable for tests. */
export function createReplyToEmailTool(
  deps: { sender?: SendService } = {},
): AnyToolDefinition {
  return buildReplyToEmailTool(deps.sender ?? sendService);
}

export const replyToEmailTool = buildReplyToEmailTool(sendService);
