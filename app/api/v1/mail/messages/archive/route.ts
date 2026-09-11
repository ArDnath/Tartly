import { z } from "zod";

import { apiError, ok } from "@/lib/api/http";
import { withMailUser } from "@/lib/mail/route";
import { archive, unarchive } from "@/lib/mail/service";

const schema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  archived: z.boolean(),
});

export const POST = withMailUser(async (userId, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);
  const { ids, archived } = parsed.data;
  await (archived ? archive(userId, ids) : unarchive(userId, ids));
  return ok({ updated: ids.length });
});
