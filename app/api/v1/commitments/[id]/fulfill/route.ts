import { apiError, ok, withUser } from "@/lib/api/http";
import { invalidateBriefing } from "@/lib/briefing/service";
import { fulfillCommitment } from "@/lib/commitments/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/v1/commitments/[id]/fulfill — mark a promise kept. */
export const POST = withUser<Ctx>(async (userId, _request, context) => {
  const { id } = await context.params;
  const fulfilled = await fulfillCommitment(userId, id);
  if (!fulfilled) return apiError("not_found", "Commitment not found", 404);
  void invalidateBriefing(userId);
  return ok({ fulfilled: true });
});
