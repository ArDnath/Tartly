import { ok, apiError, withUser } from "@/lib/api/http";
import { discardDraft } from "@/lib/inbox/service";

export const POST = withUser<{ params: Promise<{ id: string }> }>(
  async (userId, _request, context) => {
    const { id } = await context.params;
    const discarded = await discardDraft({ userId, draftId: id });
    if (!discarded) return apiError("not_found", "Draft not found", 404);
    return ok({ discarded: true });
  },
);
