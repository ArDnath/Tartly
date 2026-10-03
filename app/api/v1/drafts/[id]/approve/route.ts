import { ok, apiError, withUser } from "@/lib/api/http";
import { approveDraftBody as bodySchema } from "@/lib/api/contracts/agent";
import { invalidateBriefing } from "@/lib/briefing/service";
import { approveDraft } from "@/lib/inbox/service";

export const POST = withUser<{ params: Promise<{ id: string }> }>(
  async (userId, request, context) => {
    const { id } = await context.params;
    const parsed = bodySchema.safeParse(
      await request.json().catch(() => ({})),
    );
    if (!parsed.success) {
      return apiError("bad_request", "Invalid request", 400);
    }

    const result = await approveDraft({
      userId,
      draftId: id,
      editedBody: parsed.data.editedBody ?? null,
    });
    if (!result) return apiError("not_found", "Draft not found", 404);
    // The briefing's reply card is now stale; next read recomputes.
    void invalidateBriefing(userId);
    return ok(result);
  },
);
