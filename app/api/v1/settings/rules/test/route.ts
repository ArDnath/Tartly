import { z } from "zod";

import { apiError, ok, withUser } from "@/lib/api/http";
import { compileRule } from "@/lib/ai/features/compile-rule";
import {
  evaluateAiCondition,
  evaluateConditionDeterministically,
  getRule,
} from "@/lib/ai/features/rules";

/**
 * Test a rule against a pasted email without applying anything.
 *
 * Static conditions are evaluated deterministically; a semantic condition is
 * evaluated with the `fast` model. Nothing is written and no mail is touched.
 */

const bodySchema = z.object({
  instructions: z.string().min(4).max(2_000).optional(),
  ruleId: z.string().min(1).max(200).optional(),
  email: z.object({
    from: z.string().max(320).default(""),
    subject: z.string().max(320).default(""),
    body: z.string().max(8_000).default(""),
    categories: z.array(z.string().max(60)).max(12).default([]),
  }),
});

export const POST = withUser(async (userId, request) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);
  const { instructions, ruleId, email } = parsed.data;

  const rule =
    ruleId !== undefined
      ? await getRule({ userId, id: ruleId })
      : instructions
        ? await compileRule({ userId, instructions }).then((compiled) =>
            compiled
              ? { name: compiled.name, condition: compiled.condition, actions: compiled.actions }
              : null,
          )
        : null;
  if (!rule) {
    return apiError(
      "not_available",
      "Provide a rule id or an instruction that compiles.",
      422,
    );
  }

  const context = {
    from: email.from,
    to: [] as string[],
    subject: email.subject,
    body: email.body,
    categories: email.categories,
    hasUnsubscribe: false,
    coldEmail: false,
  };

  let verdict = evaluateConditionDeterministically(rule.condition, context);
  if (verdict.kind === "needs-ai") {
    const ai = await evaluateAiCondition({
      userId,
      condition: rule.condition,
      context,
    });
    verdict = ai.matches
      ? { kind: "match", reason: ai.reason }
      : { kind: "no-match", reason: ai.reason };
  }

  return ok({
    rule: rule.name,
    matched: verdict.kind === "match",
    reason: verdict.reason,
  });
});
