import { z } from "zod";

import { apiError, ok } from "@/lib/api/http";
import { generateMailBody } from "@/lib/mail/ai-draft";
import { withMailUser } from "@/lib/mail/route";

const schema = z.object({
  to: z.array(z.string()).optional(),
  subject: z.string().optional(),
  instruction: z.string().optional(),
});

/** "Draft with AI": returns a suggested body. Never sends. */
export const POST = withMailUser(async (userId, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

  const result = await generateMailBody({
    userId,
    to: parsed.data.to ?? [],
    subject: parsed.data.subject ?? "",
    ...(parsed.data.instruction ? { instruction: parsed.data.instruction } : {}),
  });

  return ok(result);
});
