import { ok } from "@/lib/api/http";
import { profile } from "@/lib/mail/service";
import { withMailUser } from "@/lib/mail/route";

export const GET = withMailUser(async (userId) => {
  return ok(await profile(userId));
});
