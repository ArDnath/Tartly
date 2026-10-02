import { apiError, ok, withUser } from "@/lib/api/http";
import { archiveReplyMemory } from "@/lib/ai/features/reply-memory";

/** Forget a learned memory. Soft-delete: the row is archived, not destroyed. */
export const DELETE = withUser<{ params: Promise<{ id: string }> }>(
  async (userId, _request, context) => {
    const { id } = await context.params;
    const archived = await archiveReplyMemory({ userId, memoryId: id });
    if (!archived) return apiError("not_found", "Memory not found", 404);
    return ok({ archived: true });
  },
);
