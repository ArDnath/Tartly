import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import { addSuppression } from "@/lib/campaigns/service";

import { requireWritePermission } from "./shared";

/**
 * `add_suppression` — WRITE.
 *
 * Adds an address to the suppression list so no campaign can ever email it
 * again. Use it when the user says "never contact X".
 */

const inputSchema = z.object({
  email: z.string().min(3).max(320).describe("The address to suppress."),
  reason: z
    .enum(["unsubscribe", "bounce", "manual", "existing_contact", "complaint"])
    .optional()
    .describe("Why it is suppressed; defaults to manual."),
});

export type AddSuppressionInput = z.infer<typeof inputSchema>;

export const addSuppressionTool: AnyToolDefinition = defineTool({
  name: "add_suppression",
  description:
    "Add an email address to the do-not-contact list. No campaign will ever email it again. Use it when the user asks to stop contacting someone.",
  risk: "WRITE",
  inputSchema,
  authorize(ctx) {
    requireWritePermission(ctx);
  },
  async execute(ctx, input) {
    await addSuppression({
      userId: ctx.userId,
      email: input.email,
      reason: input.reason ?? "manual",
    });
    return { added: true, email: input.email.toLowerCase() };
  },
});
