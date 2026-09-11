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
    .describe("The label name, e.g. 'Investors'. Created if it doesn't exist."),
});

export type AddLabelInput = z.infer<typeof inputSchema>;

function buildAddLabelTool(email: EmailService): AnyToolDefinition {
  return defineTool({
    name: "add_label",
    description:
      "Apply a label to an email, creating the label if it does not exist. Reversible and safe to do without asking.",
    risk: "WRITE",
    inputSchema,
    authorize(ctx) {
      requireWritePermission(ctx);
    },
    async execute(ctx, input) {
      await email.addLabel({
        userId: ctx.userId,
        messageId: input.messageId,
        label: input.label,
      });
      return {
        messageId: input.messageId,
        label: input.label,
        applied: true,
        notice: `Label "${input.label}" applied.`,
      };
    },
  });
}

/** `add_label` — WRITE. Injectable for tests. */
export function createAddLabelTool(
  deps: { email?: EmailService } = {},
): AnyToolDefinition {
  return buildAddLabelTool(deps.email ?? emailService);
}

export const addLabelTool = buildAddLabelTool(emailService);
