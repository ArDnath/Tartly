import "server-only";

import { eq, lt, or, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { mailboxes } from "@/lib/db/schema";
import {
  defaultGmailTransport,
  gmailJson,
  type GmailTransport,
} from "@/lib/gmail/client";

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

  await db
    .update(mailboxes)
    .set({
      watchExpiration: expiration,
      ...(response.historyId ? { historyId: response.historyId } : {}),
    })
    .where(eq(mailboxes.id, mailboxId));

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

  const rows = await db
    .select({
      id: mailboxes.id,
      userId: mailboxes.userId,
    })
    .from(mailboxes)
    .where(
      or(
        isNull(mailboxes.watchExpiration),
        lt(mailboxes.watchExpiration, cutoff),
      ),
    );

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
