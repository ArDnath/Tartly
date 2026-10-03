import { apiError, created } from "@/lib/api/http";
import { mailLabelBody as schema } from "@/lib/api/contracts/mail";
import { withMailUser } from "@/lib/mail/route";
import { createLabel } from "@/lib/mail/service";

export const POST = withMailUser(async (userId, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);
  await createLabel(userId, parsed.data.label);
  return created({ label: parsed.data.label });
});
