import { ok, apiError, withUser } from "@/lib/api/http";
import { stopEnrollment } from "@/lib/followup/service";

export const POST = withUser<{ params: Promise<{ id: string }> }>(
  async (userId, _request, context) => {
    const { id } = await context.params;
    const stopped = await stopEnrollment({
      userId,
      enrollmentId: id,
      reason: "manual",
    });
    if (!stopped) return apiError("not_found", "Enrollment not found", 404);
    return ok({ stopped: true });
  },
);
