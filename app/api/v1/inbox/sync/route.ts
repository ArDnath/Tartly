import { ok, apiError, withUser } from "@/lib/api/http";
import { syncInbox } from "@/lib/inbox/service";

export const POST = withUser(async (userId) => {
  const result = await syncInbox(userId);
  if (!result.accepted) {
    return apiError("no_mailbox", "No connected mailbox", 409);
  }
  return ok(result);
});
