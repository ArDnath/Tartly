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
  label: z
    .string()
    .min(1)
    .max(100)
    .describe("The label name to remove, e.g. 'Investors'."),
});

export type RemoveLabelInput = z.infer<typeof inputSchema>;

function buildRemoveLabelTool(email: EmailService): AnyToolDefinition {
  return defineTool({
    name: "remove_label",
    description:
      "Remove a label from an email. Does nothing if the label is not on the message. Reversible and safe to do without asking.",
    risk: "WRITE",
    inputSchema,
    authorize(ctx) {
      requireWritePermission(ctx);
    },
    async execute(ctx, input) {
      await email.removeLabel({
        userId: ctx.userId,
        messageId: input.messageId,
        label: input.label,
      });
      return {
        messageId: input.messageId,
        label: input.label,
        removed: true,
        notice: `Label "${input.label}" removed.`,
      };
    },
  });
}

/** `remove_label` — WRITE. Injectable for tests. */
export function createRemoveLabelTool(
  deps: { email?: EmailService } = {},
): AnyToolDefinition {
  return buildRemoveLabelTool(deps.email ?? emailService);
}

export const removeLabelTool = buildRemoveLabelTool(emailService);
