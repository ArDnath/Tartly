import { ok, withUser } from "@/lib/api/http";
import { listFollowups } from "@/lib/followup/service";

export const GET = withUser(async (userId) => {
  const followups = await listFollowups(userId);
  return ok({ followups });
});
