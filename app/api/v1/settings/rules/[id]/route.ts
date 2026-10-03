import { apiError, noContent, ok, withUser } from "@/lib/api/http";
import { rulesPatchBody as patchSchema } from "@/lib/api/contracts/settings";
import {
  deleteRule,
  updateRule,
} from "@/lib/ai/features/rules";

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
    return noContent();
  },
);
