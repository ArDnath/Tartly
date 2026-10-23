import { apiError, ok } from "@/lib/api/http";
import { mailTrashBody as schema } from "@/lib/api/contracts/mail";
import { withMailUser } from "@/lib/mail/route";
import { setTrashedUnified } from "@/lib/mail/unified";

export const POST = withMailUser(async (userId, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);
  const { ids, trashed } = parsed.data;
  await setTrashedUnified(userId, ids, trashed);
  return ok({ updated: ids.length });
});
