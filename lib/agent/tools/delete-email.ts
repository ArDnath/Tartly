import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import { EmailService, emailService } from "@/lib/services/email-service";

import { requireSendPermission } from "./shared";

/**
 * `delete_email` — EXTERNAL_SIDE_EFFECT.
 *
 * Destructive, so it follows the same rule as sending: the model can only
 * *propose* it. `execute` runs solely from the confirmed-action executor.
 *
 * By default it trashes (recoverable for 30 days). With `permanent: true` it
 * deletes outright, bypassing the trash — that needs the restricted
 * full-mailbox scope, and it is only ever reached through the same confirmation
 * the other side effects require.
 */

const inputSchema = z.object({
  messageId: z
    .string()
    .min(1)
    .max(256)
    .describe("The message id returned by search_emails or get_email."),
  permanent: z
    .boolean()
    .default(false)
    .describe(
      "True to permanently delete the message, bypassing the trash. Irreversible — set it only when the user explicitly asks to delete forever. Defaults to false, which moves the message to the trash (recoverable for 30 days).",
    ),
});

export type DeleteEmailInput = z.infer<typeof inputSchema>;

function buildDeleteEmailTool(email: EmailService): AnyToolDefinition {
  return defineTool({
    name: "delete_email",
    description:
      "Delete an email. Calling this does NOT delete anything on its own: it creates a confirmation card the user must approve. By default the message is moved to the trash and stays recoverable for 30 days; pass permanent: true only when the user explicitly wants it deleted forever (irreversible).",
    risk: "EXTERNAL_SIDE_EFFECT",
    inputSchema,
    authorize(ctx) {
      requireSendPermission(ctx);
    },
    async execute(ctx, input) {
      if (input.permanent) {
        await email.deleteMessageForever({
          userId: ctx.userId,
          messageId: input.messageId,
        });
        return {
          messageId: input.messageId,
          trashed: false,
          permanent: true,
          notice: "Permanently deleted. This cannot be undone.",
        };
      }
      await email.trashMessage({
        userId: ctx.userId,
        messageId: input.messageId,
      });
      return {
        messageId: input.messageId,
        trashed: true,
        permanent: false,
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
