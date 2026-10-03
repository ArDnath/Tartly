import "server-only";

import {
  defaultGmailTransport,
  gmailJson,
  type GmailTransport,
} from "@/lib/gmail/client";
import { mailboxRepository } from "@/lib/repositories/mailboxes";

type WatchResponse = { historyId?: string; expiration?: string };

/**
 * Gmail watches expire (~7 days). The daily cron renews them well before that,
 * so a push subscription never silently lapses.
 */
export const WATCH_RENEWAL_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function registerMailboxWatch({
  userId,
  mailboxId,
  topicName,
  transport = defaultGmailTransport,
}: {
  userId: string;
  mailboxId: string;
  topicName: string;
  transport?: GmailTransport;
}): Promise<{ expiration: Date | null; historyId: string | null }> {
  const response = await gmailJson<WatchResponse>(
    userId,
    "/watch",
    {
      method: "POST",
      body: JSON.stringify({ topicName, labelIds: ["INBOX"] }),
    },
    transport,
  );

  const expiration = response.expiration
    ? new Date(Number(response.expiration))
    : null;

  await mailboxRepository.updateWatch({
    mailboxId,
    expiration,
    historyId: response.historyId,
  });

  return { expiration, historyId: response.historyId ?? null };
}

/**
 * Renews every watch that is missing or expiring inside the renewal window.
 * Best-effort per mailbox: one failing account does not stop the others.
 */
export async function renewExpiringWatches({
  topicName,
  now = new Date(),
  transport = defaultGmailTransport,
}: {
  topicName: string;
  now?: Date;
  transport?: GmailTransport;
}): Promise<{ renewed: number; failed: number }> {
  const cutoff = new Date(now.getTime() + WATCH_RENEWAL_WINDOW_MS);

  const rows = await mailboxRepository.listExpiringWatches(cutoff);

  let renewed = 0;
  let failed = 0;

  for (const mailbox of rows) {
    try {
      await registerMailboxWatch({
        userId: mailbox.userId,
        mailboxId: mailbox.id,
        topicName,
        transport,
      });
      renewed += 1;
    } catch (error) {
      failed += 1;
      console.error(`[gmail/watch] renewal failed for ${mailbox.id}`, error);
    }
  }

  return { renewed, failed };
}

export type WatchStatus = "ok" | "expiring" | "lapsed";

export type WatchHealth = {
  mailboxId: string;
  userId: string;
  email: string;
  status: WatchStatus;
  watchExpiration: Date | null;
  lastSyncedAt: Date | null;
  syncError: string | null;
};

/**
 * Derives watch health from an expiration instant. `expiring` means it will
 * lapse inside the renewal window; `lapsed` means it already has or was never
 * registered.
 */
export function watchStatusFor(
  expiration: Date | null,
  now: Date,
  minMinutesLeft = 24 * 60,
): WatchStatus {
  if (!expiration) return "lapsed";
  const msLeft = expiration.getTime() - now.getTime();
  if (msLeft <= 0) return "lapsed";
  if (msLeft <= minMinutesLeft * 60 * 1000) return "expiring";
  return "ok";
}

/**
 * Every mailbox that needs attention: no watch, a watch expiring within the
 * window, or a recorded sync failure. Powers the health alert/reaper and the
 * operator panel. `minMinutesLeft` defaults to 24h.
 */
export async function getUnhealthyWatches({
  now = new Date(),
  minMinutesLeft = 24 * 60,
}: {
  now?: Date;
  minMinutesLeft?: number;
} = {}): Promise<WatchHealth[]> {
  const rows = await mailboxRepository.listWatchHealth();
  return rows
    .map((row) => ({
      mailboxId: row.id,
      userId: row.userId,
      email: row.email,
      status: watchStatusFor(row.watchExpiration, now, minMinutesLeft),
      watchExpiration: row.watchExpiration,
      lastSyncedAt: row.lastSyncedAt,
      syncError: row.syncError,
    }))
    .filter((row) => row.status !== "ok" || row.syncError !== null);
}
