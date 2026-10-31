import "server-only";

import { nanoid } from "nanoid";

import type { OutboundEmail } from "@/lib/gmail/mime";
import {
  defaultOutlookTransport,
  type OutlookTransport,
} from "@/lib/outlook/client";
import { sendOutlookMail } from "@/lib/outlook/service";
import { gmailSendLedgerRepository } from "@/lib/repositories/gmail-send-ledger";

export type OutlookSendResult = {
  outlookMessageId: string | null;
  /** Graph sends do not return the created message; kept for symmetry. */
  outlookThreadId: string | null;
  /** True when the ledger had already accepted this key — nothing was sent. */
  deduped: boolean;
};

/**
 * The single idempotent Outlook send path.
 *
 * The send ledger is provider-agnostic: its unique idempotency key is what makes
 * a retried request (or a double-clicked confirmation) at-most-once. Gmail and
 * Outlook share it, so the same confirmed action can never fan out twice.
 */
export async function sendOutlookEmail({
  userId,
  email,
  idempotencyKey,
  transport = defaultOutlookTransport,
}: {
  userId: string;
  email: OutboundEmail;
  idempotencyKey: string;
  transport?: OutlookTransport;
}): Promise<OutlookSendResult> {
  const inserted = await gmailSendLedgerRepository.claim({
    id: nanoid(),
    userId,
    jobId: null,
    idempotencyKey,
    status: "pending",
    seq: 1,
  });

  if (!inserted) {
    const status = await gmailSendLedgerRepository.findStatus(idempotencyKey);
    if (status === "accepted" || status === "pending") {
      return {
        outlookMessageId: null,
        outlookThreadId: null,
        deduped: true,
      };
    }
    // A previous attempt failed: reclaim the row for a retry.
    await gmailSendLedgerRepository.updateStatus(idempotencyKey, "pending");
  }

  try {
    await sendOutlookMail(
      userId,
      {
        to: email.to,
        ...(email.cc?.length ? { cc: email.cc } : {}),
        ...(email.bcc?.length ? { bcc: email.bcc } : {}),
        subject: email.subject,
        body: email.text,
        ...(email.html ? { html: email.html } : {}),
        ...(email.attachments?.length
          ? { attachments: email.attachments }
          : {}),
        ...(email.inlineImages?.length
          ? { inlineImages: email.inlineImages }
          : {}),
      },
      transport,
    );

    await gmailSendLedgerRepository.updateStatus(idempotencyKey, "accepted");
    return {
      outlookMessageId: null,
      outlookThreadId: null,
      deduped: false,
    };
  } catch (error) {
    await gmailSendLedgerRepository.updateStatus(idempotencyKey, "failed");
    throw error;
  }
}
