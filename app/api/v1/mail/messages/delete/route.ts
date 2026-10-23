import { apiError, ok } from "@/lib/api/http";
import { mailDeleteBody as schema } from "@/lib/api/contracts/mail";
import { withMailUser } from "@/lib/mail/route";
import { deleteMessagesUnified } from "@/lib/mail/unified";

/**
 * Permanently delete messages (bypassing the trash). Irreversible, and on Gmail
 * it needs the restricted full-mailbox scope; `withMailUser` maps a grant that
 * lacks it to `403 gmail_not_connected` so the client can offer a reconnect.
 */
export const POST = withMailUser(async (userId, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);
  await deleteMessagesUnified(userId, parsed.data.ids);
  return ok({ updated: parsed.data.ids.length });
});
