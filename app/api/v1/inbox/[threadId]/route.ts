import { ok, apiError, withUser } from "@/lib/api/http";
import { getThreadDetail } from "@/lib/inbox/service";

export const GET = withUser<{ params: Promise<{ threadId: string }> }>(
  async (userId, _request, context) => {
    const { threadId } = await context.params;
    const detail = await getThreadDetail({ userId, threadId });
    if (!detail) return apiError("not_found", "Thread not found", 404);
    return ok(detail);
  },
);
