import "server-only";

import { nanoid } from "nanoid";

import {
  defaultGmailTransport,
  gmailJson,
  type GmailTransport,
} from "@/lib/gmail/client";
import { buildRawMessage, type OutboundEmail } from "@/lib/gmail/mime";
import { gmailSendLedgerRepository } from "@/lib/repositories/gmail-send-ledger";

type SendResponse = { id?: string; threadId?: string | null };

export type SendEmailResult = {
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  /** True when the ledger had already accepted this key — nothing was sent. */
  deduped: boolean;
};

/**
 * The single outbound send path.
 *
 * `sendLedger.idempotencyKey` is unique, so a retried drain or a double-fired
 * cron can never send the same message twice: the second attempt sees the
 * accepted row and returns `deduped: true` without calling Gmail.
 *
 * Nothing else in the codebase may call `messages/send`.
 */
export async function sendEmail({
  userId,
  email,
  idempotencyKey,
  gmailThreadId,
  jobId,
  transport = defaultGmailTransport,
}: {
  userId: string;
  email: OutboundEmail;
  idempotencyKey: string;
  /** When set, the reply is threaded into the existing Gmail conversation. */
  gmailThreadId?: string | null;
  jobId?: string | null;
  transport?: GmailTransport;
}): Promise<SendEmailResult> {
  const inserted = await gmailSendLedgerRepository.claim({
    id: nanoid(),
    userId,
    jobId: jobId ?? null,
    idempotencyKey,
    status: "pending",
    seq: 1,
  });

  if (!inserted) {
    const status = await gmailSendLedgerRepository.findStatus(idempotencyKey);

    // accepted → already delivered. pending → another attempt is in flight.
    // Both short-circuit so at-most-once holds.
    if (status === "accepted" || status === "pending") {
      return { gmailMessageId: null, gmailThreadId: null, deduped: true };
    }

    // A previous attempt failed: reclaim the ledger row for a retry.
    await gmailSendLedgerRepository.updateStatus(idempotencyKey, "pending");
  }

  const raw = buildRawMessage(email);

  try {
    const response = await gmailJson<SendResponse>(
      userId,
      "/messages/send",
      {
        method: "POST",
        body: JSON.stringify({
          raw,
          ...(gmailThreadId ? { threadId: gmailThreadId } : {}),
        }),
      },
      transport,
    );

    await gmailSendLedgerRepository.updateStatus(idempotencyKey, "accepted");

    return {
      gmailMessageId: response.id ?? null,
      gmailThreadId: response.threadId ?? null,
      deduped: false,
    };
  } catch (error) {
    await gmailSendLedgerRepository.updateStatus(idempotencyKey, "failed");
    throw error;
  }
}
