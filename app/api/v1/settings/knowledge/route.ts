import { apiError, created, ok, withUser } from "@/lib/api/http";
import { knowledgeCreateBody as createSchema } from "@/lib/api/contracts/settings";
import {
  createKnowledgeEntry,
  listKnowledgeEntries,
} from "@/lib/ai/features/knowledge";
import { isUniqueViolation } from "@/lib/db/errors";

export const GET = withUser(async (userId) => {
  return ok({ entries: await listKnowledgeEntries({ userId }) });
});

export const POST = withUser(async (userId, request) => {
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);
  try {
    const entry = await createKnowledgeEntry({ userId, ...parsed.data });
    return created(
      { entry },
      { location: `/api/v1/settings/knowledge/${entry.id}` },
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      return apiError("conflict", "An entry with that title already exists.", 409);
    }
    throw error;
  }
});
