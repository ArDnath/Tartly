import { z } from "zod";

import { apiError, ok } from "@/lib/api/http";
import { withMailUser } from "@/lib/mail/route";
import { trash, untrash } from "@/lib/mail/service";

const schema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  trashed: z.boolean(),
});

export const POST = withMailUser(async (userId, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);
  const { ids, trashed } = parsed.data;
  await (trashed ? trash(userId, ids) : untrash(userId, ids));
  return ok({ updated: ids.length });
});
