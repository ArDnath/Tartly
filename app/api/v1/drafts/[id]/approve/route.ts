import { z } from "zod";

import { ok, apiError, withUser } from "@/lib/api/http";
import { approveDraft } from "@/lib/inbox/service";

const bodySchema = z.object({
  editedBody: z.string().max(20_000).optional(),
});

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
    return ok(result);
  },
);
