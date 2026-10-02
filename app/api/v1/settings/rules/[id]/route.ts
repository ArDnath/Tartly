import { z } from "zod";

import { apiError, ok, withUser } from "@/lib/api/http";
import {
  deleteRule,
  updateRule,
} from "@/lib/ai/features/rules";
import { RULE_ACTION_TYPES } from "@/lib/db/schema";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(9_999).optional(),
  condition: z
    .object({
      logic: z.enum(["AND", "OR"]).default("AND"),
      ai: z.string().max(500).nullable().default(null),
      from: z.string().max(320).nullable().default(null),
      to: z.string().max(320).nullable().default(null),
      subject: z.string().max(320).nullable().default(null),
      categories: z.array(z.string().max(60)).max(12).default([]),
      hasUnsubscribe: z.boolean().optional(),
      coldEmail: z.boolean().optional(),
    })
    .optional(),
  actions: z
    .array(
      z.object({
        type: z.enum(RULE_ACTION_TYPES),
        fields: z.record(z.string(), z.string()).default({}),
        delayMinutes: z.number().int().min(0).max(10_080).optional(),
      }),
    )
    .min(1)
    .max(6)
    .optional(),
});

export const PATCH = withUser<{ params: Promise<{ id: string }> }>(
  async (userId, request, context) => {
    const { id } = await context.params;
    const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

    const updated = await updateRule({ userId, id, patch: parsed.data });
    if (!updated) return apiError("not_found", "Rule not found", 404);
    return ok({ id, updated: true });
  },
);

export const DELETE = withUser<{ params: Promise<{ id: string }> }>(
  async (userId, _request, context) => {
    const { id } = await context.params;
    const deleted = await deleteRule({ userId, id });
    if (!deleted) return apiError("not_found", "Rule not found", 404);
    return ok({ id, deleted: true });
  },
);
