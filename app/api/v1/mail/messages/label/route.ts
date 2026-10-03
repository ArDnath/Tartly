import { apiError, ok } from "@/lib/api/http";
import { mailLabelMessagesBody as schema } from "@/lib/api/contracts/mail";
import { withMailUser } from "@/lib/mail/route";
import { applyLabel } from "@/lib/mail/service";

export const POST = withMailUser(async (userId, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);
  await applyLabel(userId, parsed.data.ids, parsed.data.label);
  return ok({ updated: parsed.data.ids.length });
});
