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
  starred: z
    .boolean()
    .default(true)
    .describe("True to star the email, false to remove the star."),
});

export type StarEmailInput = z.infer<typeof inputSchema>;

function buildStarEmailTool(email: EmailService): AnyToolDefinition {
  return defineTool({
    name: "star_email",
    description:
      "Star an email (or remove its star). Reversible and safe to do without asking. Use it to flag messages the user wants to find later; call it once per message.",
    risk: "WRITE",
    inputSchema,
    authorize(ctx) {
      requireWritePermission(ctx);
    },
    async execute(ctx, input) {
      await email.starMessage({
        userId: ctx.userId,
        messageId: input.messageId,
        starred: input.starred,
      });
      return {
        messageId: input.messageId,
        starred: input.starred,
        notice: input.starred ? "Starred." : "Star removed.",
      };
    },
  });
}

/** `star_email` — WRITE. Injectable for tests. */
export function createStarEmailTool(
  deps: { email?: EmailService } = {},
): AnyToolDefinition {
  return buildStarEmailTool(deps.email ?? emailService);
}

export const starEmailTool = buildStarEmailTool(emailService);
