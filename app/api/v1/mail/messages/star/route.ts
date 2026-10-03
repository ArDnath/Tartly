import { apiError, ok } from "@/lib/api/http";
import { mailStarBody as schema } from "@/lib/api/contracts/mail";
import { withMailUser } from "@/lib/mail/route";
import { setStarred } from "@/lib/mail/service";

export const POST = withMailUser(async (userId, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);
  await setStarred(userId, parsed.data.ids, parsed.data.starred);
  return ok({ updated: parsed.data.ids.length });
});
