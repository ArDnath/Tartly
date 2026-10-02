import { z } from "zod";

import { apiError, ok, withUser } from "@/lib/api/http";
import { invalidateBriefing } from "@/lib/briefing/service";
import { snoozeEnrollment } from "@/lib/followup/service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  days: z.number().int().min(1).max(30).default(1),
});

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/v1/followups/[id]/snooze — push the next nudge out by `days`. */
export const POST = withUser<Ctx>(async (userId, request, context) => {
  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

  const enrollment = await snoozeEnrollment({
    userId,
    enrollmentId: id,
    days: parsed.data.days,
  });
  if (!enrollment) return apiError("not_found", "Enrollment not found", 404);

  void invalidateBriefing(userId);
  return ok({
    id: enrollment.id,
    status: enrollment.status,
    nextEvalAt: enrollment.nextEvalAt
      ? enrollment.nextEvalAt.toISOString()
      : null,
  });
});
