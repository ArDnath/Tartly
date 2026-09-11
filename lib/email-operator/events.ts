import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db, pool } from "@/lib/db";
import { eventLog } from "@/lib/db/schema";
import { JOB_KIND_INBOUND_EMAIL } from "@/lib/email-operator/job-kinds";
import { findMailboxByEmail } from "@/lib/email-operator/mailbox";
import { enqueueJob } from "@/lib/queue/queue";
import { syncMailbox } from "@/lib/gmail/sync";

/**
 * Dedupe-and-record for inbound provider events. Pub/Sub is at-least-once, so
 * the unique `(userId, externalId)` constraint is what makes processing safe to
 * replay: the first insert wins, every redelivery returns `isNew: false`.
 */
export async function recordEvent({
  userId,
  kind,
  externalId,
  payload,
}: {
  userId: string;
  kind: string;
  externalId: string;
  payload: Record<string, unknown>;
}): Promise<{ id: string; isNew: boolean }> {
  const inserted = await db
    .insert(eventLog)
    .values({
      id: nanoid(),
      userId,
      kind,
      externalId,
      payload,
    })
    .onConflictDoNothing({
      target: [eventLog.userId, eventLog.externalId],
    })
    .returning({ id: eventLog.id });

  if (inserted[0]) {
    return { id: inserted[0].id, isNew: true };
  }

  const existing = (
    await db
      .select({ id: eventLog.id })
      .from(eventLog)
      .where(
        and(eq(eventLog.userId, userId), eq(eventLog.externalId, externalId)),
      )
      .limit(1)
  )[0];

  return { id: existing?.id ?? "", isNew: false };
}

/**
 * Processes a recorded Gmail event. Phase 1 only mirrors the mailbox; the
 * engine-driven triage/draft pipeline is layered on in phase 2+.
 *
 * Returns a small summary for logs/tests.
 */
export async function processGmailEvent(eventId: string): Promise<{
  processed: boolean;
  synced: number;
  enqueued: boolean;
}> {
  const rows = await db
    .select()
    .from(eventLog)
    .where(eq(eventLog.id, eventId))
    .limit(1);

  const event = rows[0];
  if (!event) return { processed: false, synced: 0, enqueued: false };
  if (event.processedAt) return { processed: false, synced: 0, enqueued: false };

  const emailAddress =
    typeof event.payload.emailAddress === "string"
      ? event.payload.emailAddress
      : null;

  let synced = 0;
  let enqueued = false;

  if (emailAddress) {
    const mailbox = await findMailboxByEmail(emailAddress);
    if (mailbox) {
      const result = await syncMailbox(mailbox.userId, mailbox.id);
      synced = result.synced;

      // Hand the new mail to the engine. `sourceEventId` dedupes event→job so
      // a redelivered notification cannot enqueue twice.
      const { deduped } = await enqueueJob(pool, mailbox.userId, {
        kind: JOB_KIND_INBOUND_EMAIL,
        laneKey: `mailbox:${mailbox.id}`,
        payload: { mailboxId: mailbox.id, emailAddress },
        sourceEventId: `gmail.push:${event.externalId}`,
      });
      enqueued = !deduped;
    }
  }

  await db
    .update(eventLog)
    .set({ processedAt: new Date() })
    .where(eq(eventLog.id, eventId));

  return { processed: true, synced, enqueued };
}
