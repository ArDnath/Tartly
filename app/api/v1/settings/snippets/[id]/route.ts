import { z } from "zod";

import { apiError, ok, withUser } from "@/lib/api/http";
import { deleteSnippet, updateSnippet } from "@/lib/ai/features/knowledge";

const patchSchema = z.object({
  shortcut: z.string().min(1).max(60).optional(),
  content: z.string().min(1).max(4_000).optional(),
});

export const PATCH = withUser<{ params: Promise<{ id: string }> }>(
  async (userId, request, context) => {
    const { id } = await context.params;
    const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

    const updated = await updateSnippet({ userId, id, ...parsed.data });
    if (!updated) return apiError("not_found", "Snippet not found", 404);
    return ok({ updated: true });
  },
);

export const DELETE = withUser<{ params: Promise<{ id: string }> }>(
  async (userId, _request, context) => {
    const { id } = await context.params;
    const deleted = await deleteSnippet({ userId, id });
    if (!deleted) return apiError("not_found", "Snippet not found", 404);
    return ok({ deleted: true });
  },
);
