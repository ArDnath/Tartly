import { z } from "zod";

import { apiError, ok, withUser } from "@/lib/api/http";
import { addSuppression, listSuppression } from "@/lib/campaigns/service";
import { isCampaignsEnabled } from "@/lib/env";

/** Suppression list: addresses that must never be emailed again. */

export const GET = withUser(async (userId) => {
  const rows = await listSuppression(userId);
  return ok({
    suppressed: rows.map((row) => ({
      id: row.id,
      email: row.email,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    })),
  });
});

const schema = z.object({
  email: z.string().min(3).max(320),
  reason: z.enum(["unsubscribe", "bounce", "manual", "existing_contact", "complaint"]).optional(),
});

export const POST = withUser(async (userId, request) => {
  if (!isCampaignsEnabled()) {
    return apiError("disabled", "Campaigns are disabled.", 403);
  }
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

  await addSuppression({
    userId,
    email: parsed.data.email,
    reason: parsed.data.reason ?? "manual",
  });
  return ok({ added: true });
});
