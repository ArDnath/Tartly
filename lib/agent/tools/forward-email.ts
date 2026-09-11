import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import {
  MAX_SEND_BODY_CHARS,
  MAX_SEND_RECIPIENTS,
  SendService,
  sendService,
} from "@/lib/services/send-service";

import { recipientSchema, requireSendPermission } from "./shared";

/**
 * `forward_email` — EXTERNAL_SIDE_EFFECT.
 *
 * The original is fetched server-side and quoted into the body; the model
 * supplies only the new recipients and an optional note. Like every side
 * effect it is confirmation-gated and idempotent.
 */

const inputSchema = z.object({
  messageId: z
    .string()
    .min(1)
    .max(256)
    .describe("The message id (from search_emails or get_email) being forwarded."),
  to: z
    .array(recipientSchema)
    .min(1)
    .max(MAX_SEND_RECIPIENTS)
    .describe("Recipient email addresses for the forward."),
  cc: z
    .array(recipientSchema)
    .max(MAX_SEND_RECIPIENTS)
    .optional()
    .describe("Optional Cc recipients."),
  body: z
    .string()
    .max(MAX_SEND_BODY_CHARS)
    .optional()
    .describe("An optional note to include above the forwarded message."),
});

export type ForwardEmailInput = z.infer<typeof inputSchema>;

function buildForwardEmailTool(sender: SendService): AnyToolDefinition {
  return defineTool({
    name: "forward_email",
    description:
      "Prepare a forward of an existing message. Calling this does NOT send anything: it creates a confirmation card the user must approve. The original message is quoted server-side; only use recipient addresses that came from a tool result or the user.",
    risk: "EXTERNAL_SIDE_EFFECT",
    inputSchema,
    authorize(ctx) {
      requireSendPermission(ctx);
    },
    async execute(ctx, input) {
      const result = await sender.forwardMessage({
        userId: ctx.userId,
        ...(ctx.idempotencyKey ? { idempotencyKey: ctx.idempotencyKey } : {}),
        messageId: input.messageId,
        to: input.to,
        ...(input.cc?.length ? { cc: input.cc } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
      });

      return {
        sent: !result.deduped,
        deduped: result.deduped,
        to: result.to,
        subject: result.subject,
        gmailMessageId: result.gmailMessageId,
        notice: result.deduped
          ? "This forward was already sent; it was not sent again."
          : "Forward sent.",
      };
    },
  });
}

/** `forward_email` — EXTERNAL_SIDE_EFFECT. Injectable for tests. */
export function createForwardEmailTool(
  deps: { sender?: SendService } = {},
): AnyToolDefinition {
  return buildForwardEmailTool(deps.sender ?? sendService);
}

export const forwardEmailTool = buildForwardEmailTool(sendService);
