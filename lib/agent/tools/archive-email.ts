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
});

export type ArchiveEmailInput = z.infer<typeof inputSchema>;

function buildArchiveEmailTool(email: EmailService): AnyToolDefinition {
  return defineTool({
    name: "archive_email",
    description:
      "Archive an email: remove it from the inbox without deleting it. Reversible, and safe to do without asking. Use when the user says to archive, clear, or move something out of the inbox.",
    risk: "WRITE",
    inputSchema,
    authorize(ctx) {
      requireWritePermission(ctx);
    },
    async execute(ctx, input) {
      await email.archiveMessage({
        userId: ctx.userId,
        messageId: input.messageId,
      });
      return {
        messageId: input.messageId,
        archived: true,
        notice: "Archived (removed from the inbox). It is still in the mailbox.",
      };
    },
  });
}

/** `archive_email` — WRITE. Injectable for tests. */
export function createArchiveEmailTool(
  deps: { email?: EmailService } = {},
): AnyToolDefinition {
  return buildArchiveEmailTool(deps.email ?? emailService);
}

export const archiveEmailTool = buildArchiveEmailTool(emailService);
