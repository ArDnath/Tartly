import { z } from "zod";

import { apiError, ok, withUser } from "@/lib/api/http";
import {
  createKnowledgeEntry,
  listKnowledgeEntries,
} from "@/lib/ai/features/knowledge";

export const GET = withUser(async (userId) => {
  return ok({ entries: await listKnowledgeEntries({ userId }) });
});

const createSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(8_000),
});

export const POST = withUser(async (userId, request) => {
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);
  try {
    const entry = await createKnowledgeEntry({ userId, ...parsed.data });
    return ok({ entry }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return apiError("conflict", "An entry with that title already exists.", 409);
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
