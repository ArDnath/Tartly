import "server-only";

import { nanoid } from "nanoid";

import { pool } from "@/lib/db";
import { JOB_KIND_MAILBOX_SYNC } from "@/lib/email-operator/job-kinds";
import { getGmailProfile } from "@/lib/gmail/sync";
import { connectedMailProviders } from "@/lib/mail/accounts";
import { outlookProfile } from "@/lib/outlook/service";
import { enqueueJob } from "@/lib/queue/queue";
import { mailboxRepository, type Mailbox } from "@/lib/repositories/mailboxes";

export type MailboxRow = Mailbox;

/** Creates (or returns) the mailbox row for a connected mail account. */
export async function ensureMailbox({
  userId,
  email,
  historyId,
  provider = "google",
}: {
  userId: string;
  email: string;
  historyId?: string | null;
  provider?: "google" | "microsoft";
}): Promise<MailboxRow> {
  const inserted = await mailboxRepository.upsert({
    id: nanoid(),
    userId,
    email,
    provider,
    historyId: historyId ?? null,
  });

  return inserted;
}

/**
 * The mailbox used by Gmail-specific paths (campaigns, legacy callers). Prefer
 * the Gmail row when a user has both accounts, so adding Outlook never changes
 * which address an existing Gmail feature sends from.
 */
export async function getMailboxForUser(
  userId: string,
): Promise<MailboxRow | null> {
  const mailboxes = await mailboxRepository.listByUser(userId);
  return (
    mailboxes.find((mailbox) => mailbox.provider === "google") ??
    mailboxes[0] ??
    null
  );
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

/** How stale a mailbox may be before opening Mail triggers a fresh sync. */
const OPPORTUNISTIC_SYNC_MS = 5 * 60 * 1000;

/**
 * Ensure every connected account (Gmail and/or Outlook) has a mailbox row, and
 * queue a bounded sync when one is new or stale.
 *
 * Best-effort: one provider failing must not hide the other. Returns the Gmail
 * mailbox when present (the historical default), otherwise the first live one.
 */
export async function ensureMailboxForUser(
  userId: string,
): Promise<MailboxRow | null> {
  try {
    const [existing, providers] = await Promise.all([
      mailboxRepository.listByUser(userId),
      connectedMailProviders(userId),
    ]);
    const byProvider = new Map(existing.map((row) => [row.provider, row]));
    const now = Date.now();

    for (const provider of providers) {
      let mailbox = byProvider.get(provider);
      if (!mailbox) {
        const profile =
          provider === "microsoft"
            ? await outlookProfile(userId).then((value) => ({
                emailAddress: value.emailAddress,
                historyId: null,
              }))
            : await getGmailProfile(userId);
        if (!profile.emailAddress) continue;
        mailbox = await ensureMailbox({
          userId,
          email: profile.emailAddress,
          historyId: profile.historyId ?? null,
          provider,
        });
        byProvider.set(provider, mailbox);
      }

      const stale =
        !mailbox.lastSyncedAt ||
        now - mailbox.lastSyncedAt.getTime() > OPPORTUNISTIC_SYNC_MS;
      if (stale) {
        // A five-minute bucket dedupes concurrent layouts/tabs without holding
        // a lock, while still letting a genuinely old mailbox refresh.
        await enqueueJob(pool, userId, {
          kind: JOB_KIND_MAILBOX_SYNC,
          laneKey: `mailbox:${mailbox.id}`,
          payload: { mailboxId: mailbox.id },
          sourceEventId: `sync:${mailbox.id}:${Math.floor(now / OPPORTUNISTIC_SYNC_MS)}`,
        });
      }
    }

    return byProvider.get("google") ?? byProvider.values().next().value ?? null;
  } catch (error) {
    console.warn("[mailbox] self-heal skipped", error);
    return null;
  }
}
