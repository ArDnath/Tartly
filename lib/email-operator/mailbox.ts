import "server-only";

import { nanoid } from "nanoid";

import { pool } from "@/lib/db";
import { JOB_KIND_MAILBOX_SYNC } from "@/lib/email-operator/job-kinds";
import { getGmailProfile } from "@/lib/gmail/sync";
import { enqueueJob } from "@/lib/queue/queue";
import { mailboxRepository, type Mailbox } from "@/lib/repositories/mailboxes";

export type MailboxRow = Mailbox;

/** Creates (or returns) the mailbox row for a connected Google account. */
export async function ensureMailbox({
  userId,
  email,
  historyId,
}: {
  userId: string;
  email: string;
  historyId?: string | null;
}): Promise<MailboxRow> {
  const inserted = await mailboxRepository.upsert({
    id: nanoid(),
    userId,
    email,
    provider: "google",
    historyId: historyId ?? null,
  });

  return inserted;
}

export async function getMailboxForUser(
  userId: string,
): Promise<MailboxRow | null> {
  const mailbox = await mailboxRepository.findByUser(userId);
  return mailbox ?? null;
}

export async function getMailboxForUserById(
  userId: string,
  mailboxId: string,
): Promise<MailboxRow | null> {
  const mailbox = await mailboxRepository.findByIdForUser(
    userId,
    mailboxId,
  );
  return mailbox ?? null;
}

/** Resolves the mailbox a Pub/Sub notification belongs to. */
export async function findMailboxByEmail(
  email: string,
): Promise<MailboxRow | null> {
  const mailbox = await mailboxRepository.findByEmail(email);
  return mailbox ?? null;
}

/**
 * Self-heal for users who onboarded before mailbox creation existed: if the
 * user has no mailbox row but Google is linked with the inbox scopes, create
 * the mailbox and queue an initial sync. Best-effort — a user without Google
 * (or without the Gmail scopes) simply returns null, and the caller must never
 * block a page render on it.
 */
export async function ensureMailboxForUser(
  userId: string,
): Promise<MailboxRow | null> {
  const existing = await getMailboxForUser(userId);
  if (existing) return existing;

  try {
    const profile = await getGmailProfile(userId);
    const email = profile.emailAddress;
    if (!email) return null;

    const mailbox = await ensureMailbox({
      userId,
      email,
      historyId: profile.historyId ?? null,
    });

    // Dedupe on the mailbox id so concurrent layouts never stack syncs.
    await enqueueJob(pool, userId, {
      kind: JOB_KIND_MAILBOX_SYNC,
      laneKey: `mailbox:${mailbox.id}`,
      payload: { mailboxId: mailbox.id },
      sourceEventId: `connect:${mailbox.id}`,
    });

    return mailbox;
  } catch (error) {
    console.warn("[mailbox] self-heal skipped", error);
    return null;
  }
}
