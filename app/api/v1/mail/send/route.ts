import { nanoid } from "nanoid";
import { z } from "zod";

import { apiError, ok } from "@/lib/api/http";
import { getMailboxForUser } from "@/lib/email-operator/mailbox";
import { sendEmail } from "@/lib/gmail/send";
import { allowMailSend } from "@/lib/mail/rate-limit";
import { withMailUser } from "@/lib/mail/route";

const schema = z.object({
  to: z.array(z.string().min(1)).min(1),
  cc: z.array(z.string().min(1)).optional(),
  bcc: z.array(z.string().min(1)).optional(),
  subject: z.string().default(""),
  body: z.string().default(""),
  threadId: z.string().optional(),
  inReplyTo: z.string().optional(),
});

/**
 * Sends mail through the single idempotent path (`sendEmail`), so a retried
 * request can never double-send. A fresh idempotency key per request is what
 * makes each user-initiated send distinct.
 */
export const POST = withMailUser(async (userId, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

  if (!(await allowMailSend(userId))) {
    return apiError("rate_limited", "Too many messages. Try again shortly.", 429);
  }

  const mailbox = await getMailboxForUser(userId);
  if (!mailbox) {
    return apiError("no_mailbox", "No connected mailbox", 409);
  }

  const { to, cc, bcc, subject, body, threadId, inReplyTo } = parsed.data;

  const result = await sendEmail({
    userId,
    email: {
      from: mailbox.email,
      to,
      ...(cc?.length ? { cc } : {}),
      ...(bcc?.length ? { bcc } : {}),
      subject,
      text: body,
      ...(inReplyTo ? { inReplyTo, references: [inReplyTo] } : {}),
    },
    gmailThreadId: threadId ?? null,
    idempotencyKey: `mail:${nanoid()}`,
  });

  return ok({ id: result.gmailMessageId, threadId: result.gmailThreadId });
});
