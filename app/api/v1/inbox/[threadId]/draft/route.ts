import { ok, apiError, withUser } from "@/lib/api/http";
import { regenerateDraft } from "@/lib/inbox/service";

export const POST = withUser<{ params: Promise<{ threadId: string }> }>(
  { requiresSubscription: true },
  async (userId, _request, context) => {
    const { threadId } = await context.params;
    const draft = await regenerateDraft({ userId, threadId });
    if (!draft) return apiError("not_found", "Thread not found", 404);
    return ok(draft);
  },
);
