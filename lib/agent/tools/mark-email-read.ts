import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import { EmailService, emailService } from "@/lib/services/email-service";

import { requireWritePermission } from "./shared";

const inputSchema = z.object({
  messageId: z
    .string()
    .min(1)
    .max(256)
    .describe("The message id returned by search_emails or get_email."),
  read: z
    .boolean()
    .default(true)
    .describe("True to mark as read, false to mark as unread."),
});

export type MarkEmailReadInput = z.infer<typeof inputSchema>;

function buildMarkEmailReadTool(email: EmailService): AnyToolDefinition {
  return defineTool({
    name: "mark_email_read",
    description:
      "Mark an email as read (or unread). Reversible and safe to do without asking. Prefer this over archive_email when the user only wants to clear the unread state.",
    risk: "WRITE",
    inputSchema,
    authorize(ctx) {
      requireWritePermission(ctx);
    },
    async execute(ctx, input) {
      await email.markRead({
        userId: ctx.userId,
        messageId: input.messageId,
        read: input.read,
      });
      return {
        messageId: input.messageId,
        read: input.read,
        notice: input.read ? "Marked as read." : "Marked as unread.",
      };
    },
  });
}

/** `mark_email_read` — WRITE. Injectable for tests. */
export function createMarkEmailReadTool(
  deps: { email?: EmailService } = {},
): AnyToolDefinition {
  return buildMarkEmailReadTool(deps.email ?? emailService);
}

export const markEmailReadTool = buildMarkEmailReadTool(emailService);
