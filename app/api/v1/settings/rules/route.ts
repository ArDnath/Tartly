import { z } from "zod";

import { apiError, ok, withUser } from "@/lib/api/http";
import { buildManualRule, compileRule } from "@/lib/ai/features/compile-rule";
import {
  createRule,
  listRuleExecutions,
  listRules,
} from "@/lib/ai/features/rules";
import { RULE_ACTION_TYPES } from "@/lib/db/schema";

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

const actionSchema = z.object({
  type: z.enum(RULE_ACTION_TYPES),
  fields: z
    .object({
      label: z.string().max(120).optional(),
      folder: z.string().max(120).optional(),
      instruction: z.string().max(1_000).optional(),
      to: z.string().max(320).optional(),
      message: z.string().max(500).optional(),
      digest: z.string().max(120).optional(),
    })
    .default({}),
  delayMinutes: z.number().int().min(0).max(10_080).optional(),
});

const conditionSchema = z.object({
  logic: z.enum(["AND", "OR"]).default("AND"),
  ai: z.string().max(500).nullable().default(null),
  from: z.string().max(320).nullable().default(null),
  to: z.string().max(320).nullable().default(null),
  subject: z.string().max(320).nullable().default(null),
  categories: z.array(z.string().max(60)).max(12).default([]),
  hasUnsubscribe: z.boolean().optional(),
  coldEmail: z.boolean().optional(),
});

const bodySchema = z.union([
  z.object({ instructions: z.string().min(4).max(2_000) }),
  z.object({
    name: z.string().min(1).max(120),
    condition: conditionSchema,
    actions: z.array(actionSchema).min(1).max(6),
  }),
]);

export const POST = withUser(async (userId, request) => {
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
    return ok({ rule }, { status: 201 });
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
  return ok({ rule }, { status: 201 });
});
