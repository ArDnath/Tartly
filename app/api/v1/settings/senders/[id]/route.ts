import { z } from "zod";

import {
  deleteSenderProfile,
  setSenderStatus,
} from "@/lib/ai/features/sender-profiles";
import { apiError, ok, withUser } from "@/lib/api/http";

/**
 * One sender profile: whitelist it ("allowed" — never cold, never reclassify)
 * or forget it (delete, so the next inbound reclassifies from scratch).
 */

const patchSchema = z.object({
  status: z.enum(["active", "allowed", "blocked"]),
});

export const PATCH = withUser<{ params: Promise<{ id: string }> }>(
  async (userId, request, context) => {
    const { id } = await context.params;
    const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

    const updated = await setSenderStatus({
      userId,
      id,
      status: parsed.data.status,
    });
    if (!updated) return apiError("not_found", "Sender not found", 404);
    return ok({ id, status: parsed.data.status });
  },
);

export const DELETE = withUser<{ params: Promise<{ id: string }> }>(
  async (userId, _request, context) => {
    const { id } = await context.params;
    const deleted = await deleteSenderProfile({ userId, id });
    if (!deleted) return apiError("not_found", "Sender not found", 404);
    return ok({ id, deleted: true });
  },
);
