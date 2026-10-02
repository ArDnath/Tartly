import { apiError, ok, withUser } from "@/lib/api/http";
import { invalidateBriefing } from "@/lib/briefing/service";
import { dismissCommitment } from "@/lib/commitments/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/v1/commitments/[id]/dismiss — cancel a promise (no longer open). */
export const POST = withUser<Ctx>(async (userId, _request, context) => {
  const { id } = await context.params;
  const dismissed = await dismissCommitment(userId, id);
  if (!dismissed) return apiError("not_found", "Commitment not found", 404);
  void invalidateBriefing(userId);
  return ok({ dismissed: true });
});
