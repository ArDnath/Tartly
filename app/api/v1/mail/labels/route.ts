import { apiError, created } from "@/lib/api/http";
import { mailLabelBody as schema } from "@/lib/api/contracts/mail";
import { connectedMailProviders } from "@/lib/mail/accounts";
import { withMailUser } from "@/lib/mail/route";
import { createLabel } from "@/lib/mail/service";
import { createOutlookCategory } from "@/lib/outlook/service";

export const POST = withMailUser(async (userId, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

  const providers = await connectedMailProviders(userId);
  await Promise.all([
    providers.includes("google")
      ? createLabel(userId, parsed.data.label)
      : Promise.resolve(),
    providers.includes("microsoft")
      ? createOutlookCategory(userId, parsed.data.label).catch(() => undefined)
      : Promise.resolve(),
  ]);

  return created({ label: parsed.data.label });
});
