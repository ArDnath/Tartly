import { ok, apiError, withUser } from "@/lib/api/http";
import { autonomyPatchBody as patchSchema } from "@/lib/api/contracts/settings";
import {
  getAutonomySettings,
  setContactOverride,
  setMailboxAutonomy,
} from "@/lib/settings/autonomy";

export const GET = withUser(async (userId) => {
  return ok(await getAutonomySettings(userId));
});

export const PATCH = withUser(async (userId, request) => {
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

  if (parsed.data.mailboxAutonomy) {
    await setMailboxAutonomy(userId, parsed.data.mailboxAutonomy);
  }
  if (parsed.data.contact) {
    await setContactOverride(
      userId,
      parsed.data.contact.email,
      parsed.data.contact.override,
    );
  }

  return ok(await getAutonomySettings(userId));
});
