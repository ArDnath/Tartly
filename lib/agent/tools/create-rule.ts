import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import { createRuleFromInstructions } from "@/lib/ai/features/rules";
import { isRulesEnabled } from "@/lib/env";
import { AuthorizationError } from "@/lib/agent/errors";

import { requireWritePermission } from "./shared";

/**
 * `create_rule` — WRITE.
 *
 * Turns "when an invoice arrives, label it Receipts and archive it" into a live
 * automation rule. Reversible configuration, not an external effect, so it runs
 * without confirmation; the rule itself is created disabled-by-default? No —
 * enabled, but its sends still obey `egress`. The user can disable it in
 * `/settings/rules`.
 */

const inputSchema = z.object({
  instructions: z
    .string()
    .min(4)
    .max(2_000)
    .describe(
      "The automation in plain English, e.g. 'When I get an invoice, label it Receipts and archive it'.",
    ),
});

export type CreateRuleInput = z.infer<typeof inputSchema>;

export const createRuleTool: AnyToolDefinition = defineTool({
  name: "create_rule",
  description:
    "Create an automation rule from a plain-English instruction. Use it when the user says 'make a rule that…' or 'always…'. The rule runs through the existing engine; sending actions still require the mailbox's normal approval. Returns the compiled rule or asks the user to use the manual form if it could not be parsed.",
  risk: "WRITE",
  inputSchema,
  authorize(ctx) {
    requireWritePermission(ctx);
    if (!isRulesEnabled()) {
      throw new AuthorizationError("Rules are disabled for this workspace.");
    }
  },
  async execute(ctx, input) {
    const rule = await createRuleFromInstructions({
      userId: ctx.userId,
      instructions: input.instructions,
    });
    if (!rule) {
      return {
        created: false,
        notice:
          "I couldn't compile that into a rule. Please describe the trigger and the action, or add it manually in Settings → Rules.",
      };
    }
    return {
      created: true,
      ruleId: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      condition: rule.condition,
      actions: rule.actions,
      notice:
        "Rule created. Review or disable it in Settings → Rules. Reply drafts it produces still go through the normal approval flow.",
    };
  },
});
