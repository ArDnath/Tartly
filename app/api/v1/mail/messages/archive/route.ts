import { apiError, ok } from "@/lib/api/http";
import { mailArchiveBody as schema } from "@/lib/api/contracts/mail";
import { withMailUser } from "@/lib/mail/route";
import { archive, unarchive } from "@/lib/mail/service";

export const POST = withMailUser(async (userId, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);
  const { ids, archived } = parsed.data;
  await (archived ? archive(userId, ids) : unarchive(userId, ids));
  return ok({ updated: ids.length });
});
