import { z } from "zod";

import { apiError, ok } from "@/lib/api/http";
import { withMailUser } from "@/lib/mail/route";
import { saveDraft } from "@/lib/mail/service";

const schema = z.object({
  to: z.array(z.string().min(1)).default([]),
  cc: z.array(z.string().min(1)).optional(),
  bcc: z.array(z.string().min(1)).optional(),
  subject: z.string().default(""),
  body: z.string().default(""),
  threadId: z.string().optional(),
  inReplyTo: z.string().optional(),
});

export const POST = withMailUser(async (userId, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);
  const { to, cc, bcc, subject, body, threadId, inReplyTo } = parsed.data;

  const draft = await saveDraft(userId, {
    to,
    ...(cc?.length ? { cc } : {}),
    ...(bcc?.length ? { bcc } : {}),
    subject,
    body,
    ...(threadId ? { threadId } : {}),
    ...(inReplyTo ? { inReplyTo } : {}),
  });

  return ok({ id: draft.id });
});
