import "server-only";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/lib/db";
import { sendLedger } from "@/lib/db/schema";
import {
  defaultGmailTransport,
  gmailJson,
  type GmailTransport,
} from "@/lib/gmail/client";
import { buildRawMessage, type OutboundEmail } from "@/lib/gmail/mime";

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
  const inserted = await db
    .insert(sendLedger)
    .values({
      id: nanoid(),
      userId,
      jobId: jobId ?? null,
      idempotencyKey,
      status: "pending",
      seq: 1,
    })
    .onConflictDoNothing({ target: sendLedger.idempotencyKey })
    .returning();

  if (!inserted[0]) {
    const existing = (
      await db
        .select({ status: sendLedger.status })
        .from(sendLedger)
        .where(eq(sendLedger.idempotencyKey, idempotencyKey))
        .limit(1)
    )[0];

    // accepted → already delivered. pending → another attempt is in flight.
    // Both short-circuit so at-most-once holds.
    if (existing?.status === "accepted" || existing?.status === "pending") {
      return { gmailMessageId: null, gmailThreadId: null, deduped: true };
    }

    // A previous attempt failed: reclaim the ledger row for a retry.
    await db
      .update(sendLedger)
      .set({ status: "pending" })
      .where(eq(sendLedger.idempotencyKey, idempotencyKey));
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

    await db
      .update(sendLedger)
      .set({ status: "accepted" })
      .where(eq(sendLedger.idempotencyKey, idempotencyKey));

    return {
      gmailMessageId: response.id ?? null,
      gmailThreadId: response.threadId ?? null,
      deduped: false,
    };
  } catch (error) {
    await db
      .update(sendLedger)
      .set({ status: "failed" })
      .where(eq(sendLedger.idempotencyKey, idempotencyKey));
    throw error;
  }
}
