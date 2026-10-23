import { ok } from "@/lib/api/http";
import { withMailUser } from "@/lib/mail/route";
import { emptyTrashUnified } from "@/lib/mail/unified";

/**
 * Permanently delete everything in the trash, across connected accounts.
 * Irreversible; on Gmail it needs the restricted full-mailbox scope.
 */
export const POST = withMailUser(async (userId) => {
  const deleted = await emptyTrashUnified(userId);
  return ok({ deleted });
});
