import { ok, apiError, withUser } from "@/lib/api/http";
import { followupPauseBody as bodySchema } from "@/lib/api/contracts/inbox";
import { pauseEnrollment } from "@/lib/followup/service";

export const POST = withUser<{ params: Promise<{ id: string }> }>(
  async (userId, request, context) => {
    const { id } = await context.params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

    const enrollment = await pauseEnrollment({
      userId,
      enrollmentId: id,
      paused: parsed.data.paused,
    });
    if (!enrollment) return apiError("not_found", "Enrollment not found", 404);

    return ok({ id: enrollment.id, status: enrollment.status });
  },
);
