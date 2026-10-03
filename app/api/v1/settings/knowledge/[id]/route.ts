import { apiError, noContent, ok, withUser } from "@/lib/api/http";
import { knowledgePatchBody as patchSchema } from "@/lib/api/contracts/settings";
import {
  deleteKnowledgeEntry,
  updateKnowledgeEntry,
} from "@/lib/ai/features/knowledge";

export const PATCH = withUser<{ params: Promise<{ id: string }> }>(
  async (userId, request, context) => {
    const { id } = await context.params;
    const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

    const updated = await updateKnowledgeEntry({ userId, id, ...parsed.data });
    if (!updated) return apiError("not_found", "Entry not found", 404);
    return ok({ updated: true });
  },
);

export const DELETE = withUser<{ params: Promise<{ id: string }> }>(
  async (userId, _request, context) => {
    const { id } = await context.params;
    const deleted = await deleteKnowledgeEntry({ userId, id });
    if (!deleted) return apiError("not_found", "Entry not found", 404);
    return noContent();
  },
);
