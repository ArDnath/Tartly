import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db, pool } from "@/lib/db";
import { mailboxes } from "@/lib/db/schema";
import { JOB_KIND_MAILBOX_SYNC } from "@/lib/email-operator/job-kinds";
import { getGmailProfile } from "@/lib/gmail/sync";
import { enqueueJob } from "@/lib/queue/queue";

export type MailboxRow = typeof mailboxes.$inferSelect;

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
  const inserted = await db
    .insert(mailboxes)
    .values({
      id: nanoid(),
      userId,
      email,
      provider: "google",
      historyId: historyId ?? null,
    })
    .onConflictDoUpdate({
      target: [mailboxes.userId, mailboxes.email],
      set: {
        ...(historyId ? { historyId } : {}),
        updatedAt: new Date(),
      },
    })
    .returning();

  return inserted[0];
}

export async function getMailboxForUser(
  userId: string,
): Promise<MailboxRow | null> {
  const rows = await db
    .select()
    .from(mailboxes)
    .where(eq(mailboxes.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getMailboxForUserById(
  userId: string,
  mailboxId: string,
): Promise<MailboxRow | null> {
  const rows = await db
    .select()
    .from(mailboxes)
    .where(and(eq(mailboxes.id, mailboxId), eq(mailboxes.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Resolves the mailbox a Pub/Sub notification belongs to. */
export async function findMailboxByEmail(
  email: string,
): Promise<MailboxRow | null> {
  const rows = await db
    .select()
    .from(mailboxes)
    .where(eq(mailboxes.email, email.toLowerCase()))
    .limit(1);
  return rows[0] ?? null;
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
