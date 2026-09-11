import { z } from "zod";

import { apiError, ok } from "@/lib/api/http";
import { withMailUser } from "@/lib/mail/route";
import { createLabel } from "@/lib/mail/service";

const schema = z.object({ label: z.string().trim().min(1) });

export const POST = withMailUser(async (userId, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);
  await createLabel(userId, parsed.data.label);
  return ok({ label: parsed.data.label });
});
