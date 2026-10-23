import { apiError, ok } from "@/lib/api/http";
import { mailLabelMessagesBody as schema } from "@/lib/api/contracts/mail";
import { withMailUser } from "@/lib/mail/route";
import { applyLabel } from "@/lib/mail/service";
import { isOutlookId } from "@/lib/mail/unified";

export const POST = withMailUser(async (userId, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);
  // Labels are a Gmail concept; Outlook messages in the shared inbox are
  // skipped rather than sent a label id Graph would reject.
  const gmailIds = parsed.data.ids.filter((id) => !isOutlookId(id));
  if (gmailIds.length) await applyLabel(userId, gmailIds, parsed.data.label);
  return ok({ updated: gmailIds.length });
});
