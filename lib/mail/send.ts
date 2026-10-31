import "server-only";

import type { GmailTransport } from "@/lib/gmail/client";
import type { OutboundEmail } from "@/lib/gmail/mime";
import { sendEmail } from "@/lib/gmail/send";
import { sendOutlookEmail } from "@/lib/outlook/send";

/**
 * Send one message from the account that owns a mirrored mailbox.
 *
 * The Gmail path keeps its thread id so the reply lands in the same Gmail
 * conversation. Outlook has no client-supplied thread id on `sendMail`; Graph
 * threads by the conversation it assigns on delivery, so the body/recipients are
 * all it needs.
 */
export async function sendFromMirroredMailbox(input: {
  userId: string;
  provider: string;
  from: string;
  threadId: string | null;
  email: OutboundEmail;
  idempotencyKey: string;
  /** Gmail test seam; production callers omit it. */
  transport?: GmailTransport;
}): Promise<{
  provider: "gmail" | "outlook";
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  deduped: boolean;
}> {
  if (input.provider === "microsoft") {
    const result = await sendOutlookEmail({
      userId: input.userId,
      email: input.email,
      idempotencyKey: input.idempotencyKey,
    });
    return {
      provider: "outlook",
      gmailMessageId: result.outlookMessageId,
      gmailThreadId: null,
      deduped: result.deduped,
    };
  }

  const result = await sendEmail({
    userId: input.userId,
    email: { ...input.email, from: input.from },
    gmailThreadId: input.threadId,
    idempotencyKey: input.idempotencyKey,
    ...(input.transport ? { transport: input.transport } : {}),
  });
  return {
    provider: "gmail",
    gmailMessageId: result.gmailMessageId,
    gmailThreadId: result.gmailThreadId,
    deduped: result.deduped,
  };
}
