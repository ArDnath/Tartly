import { apiError, created, ok, withUser } from "@/lib/api/http";
import { rulesCreateBody as bodySchema } from "@/lib/api/contracts/settings";
import { buildManualRule, compileRule } from "@/lib/ai/features/compile-rule";
import {
  createRule,
  listRuleExecutions,
  listRules,
} from "@/lib/ai/features/rules";

/**
 * Automation rules (Phase 3).
 *
 * `GET`  — every rule plus recent executions (the "why" history).
 * `POST` — create either from a plain-English instruction (compiled) or from a
 *          structured manual rule.
 */

export const GET = withUser(async (userId) => {
  const [rules, executions] = await Promise.all([
    listRules({ userId }),
    listRuleExecutions({ userId, limit: 50 }),
  ]);
  const { isAiProviderConfigured } = await import("@/lib/ai/provider");
  return ok({
    rules,
    executions,
    compilerAvailable: isAiProviderConfigured(),
  });
});

export const POST = withUser({ requiresSubscription: true }, async (userId, request) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

  if ("instructions" in parsed.data) {
    const compiled = await compileRule({
      userId,
      instructions: parsed.data.instructions,
    });
    if (!compiled) {
      return apiError(
        "compile_failed",
        "Couldn't compile that into a rule. Try the manual form.",
        422,
      );
    }
    const rule = await createRule({
      userId,
      rule: compiled,
      instruction: parsed.data.instructions,
      source: "ai",
      createdBy: "user",
    });
    return created({ rule }, { location: `/api/v1/settings/rules/${rule.id}` });
  }

  const compiled = buildManualRule({
    name: parsed.data.name,
    condition: parsed.data.condition,
    actions: parsed.data.actions,
  });
  if (!compiled) {
    return apiError("invalid_rule", "The rule has no usable actions.", 422);
  }
  const rule = await createRule({ userId, rule: compiled, source: "user" });
  return created({ rule }, { location: `/api/v1/settings/rules/${rule.id}` });
});
