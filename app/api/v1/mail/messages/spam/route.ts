import { z } from "zod";

import { apiError, ok } from "@/lib/api/http";
import { withMailUser } from "@/lib/mail/route";
import { setSpam } from "@/lib/mail/service";

const schema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  spam: z.boolean(),
});

export const POST = withMailUser(async (userId, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);
  await setSpam(userId, parsed.data.ids, parsed.data.spam);
  return ok({ updated: parsed.data.ids.length });
});
