import { apiError, ok } from "@/lib/api/http";
import { mailLabelMessagesBody as schema } from "@/lib/api/contracts/mail";
import { withMailUser } from "@/lib/mail/route";
import { applyLabelUnified } from "@/lib/mail/unified";

export const POST = withMailUser(async (userId, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);
  // Gmail applies a label; Outlook applies a category of the same name.
  await applyLabelUnified(userId, parsed.data.ids, parsed.data.label);
  return ok({ updated: parsed.data.ids.length });
});
