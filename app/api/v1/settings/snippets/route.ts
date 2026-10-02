import { z } from "zod";

import { apiError, ok, withUser } from "@/lib/api/http";
import { createSnippet, listSnippets } from "@/lib/ai/features/knowledge";

export const GET = withUser(async (userId) => {
  return ok({ snippets: await listSnippets({ userId }) });
});

const createSchema = z.object({
  shortcut: z.string().min(1).max(60),
  content: z.string().min(1).max(4_000),
});

export const POST = withUser(async (userId, request) => {
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);
  try {
    const snippet = await createSnippet({ userId, ...parsed.data });
    return ok({ snippet }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return apiError("conflict", "That shortcut already exists.", 409);
    }
    throw error;
  }
});

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
