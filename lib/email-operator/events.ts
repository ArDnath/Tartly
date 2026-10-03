import "server-only";

import { nanoid } from "nanoid";

import { pool } from "@/lib/db";
import { JOB_KIND_INBOUND_EMAIL } from "@/lib/email-operator/job-kinds";
import { findMailboxByEmail } from "@/lib/email-operator/mailbox";
import { enqueueJob } from "@/lib/queue/queue";
import { eventLogRepository } from "@/lib/repositories/event-log";
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
  const inserted = await eventLogRepository.insertIfAbsent({
    id: nanoid(),
    userId,
    kind,
    externalId,
    payload,
  });

  if (inserted) {
    return { id: inserted.id, isNew: true };
  }

  const existing = await eventLogRepository.findIdByExternalId({
    userId,
    externalId,
  });

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
  const event = await eventLogRepository.findById(eventId);
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

  await eventLogRepository.markProcessed(eventId, new Date());

  return { processed: true, synced, enqueued };
}
