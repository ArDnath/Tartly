import { apiError, created, ok, withUser } from "@/lib/api/http";
import { snippetCreateBody as createSchema } from "@/lib/api/contracts/settings";
import { createSnippet, listSnippets } from "@/lib/ai/features/knowledge";
import { isUniqueViolation } from "@/lib/db/errors";

export const GET = withUser(async (userId) => {
  return ok({ snippets: await listSnippets({ userId }) });
});

export const POST = withUser(async (userId, request) => {
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);
  try {
    const snippet = await createSnippet({ userId, ...parsed.data });
    return created(
      { snippet },
      { location: `/api/v1/settings/snippets/${snippet.id}` },
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      return apiError("conflict", "That shortcut already exists.", 409);
    }
    throw error;
  }
});
