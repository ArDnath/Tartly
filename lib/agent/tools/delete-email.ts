import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import { EmailService, emailService } from "@/lib/services/email-service";

import { requireSendPermission } from "./shared";

/**
 * `delete_email` — EXTERNAL_SIDE_EFFECT.
 *
 * Destructive, so it follows the same rule as sending: the model can only
 * *propose* it. `execute` runs solely from the confirmed-action executor, and
 * it trashes rather than deletes. Gmail keeps trashed mail for 30 days and
 * `messages.delete` needs a scope we deliberately do not hold, so "delete"
 * here is always recoverable.
 */

const inputSchema = z.object({
  messageId: z
    .string()
    .min(1)
    .max(256)
    .describe("The message id returned by search_emails or get_email."),
});

export type DeleteEmailInput = z.infer<typeof inputSchema>;

function buildDeleteEmailTool(email: EmailService): AnyToolDefinition {
  return defineTool({
    name: "delete_email",
    description:
      "Move an email to the trash. Calling this does NOT delete anything: it creates a confirmation card the user must approve. The mail stays recoverable from the trash for 30 days.",
    risk: "EXTERNAL_SIDE_EFFECT",
    inputSchema,
    authorize(ctx) {
      requireSendPermission(ctx);
    },
    async execute(ctx, input) {
      await email.trashMessage({
        userId: ctx.userId,
        messageId: input.messageId,
      });
      return {
        messageId: input.messageId,
        trashed: true,
        notice:
          "Moved to the trash. It is recoverable for 30 days, not permanently deleted.",
      };
    },
  });
}

/** `delete_email` — EXTERNAL_SIDE_EFFECT. Injectable for tests. */
export function createDeleteEmailTool(
  deps: { email?: EmailService } = {},
): AnyToolDefinition {
  return buildDeleteEmailTool(deps.email ?? emailService);
}

export const deleteEmailTool = buildDeleteEmailTool(emailService);
