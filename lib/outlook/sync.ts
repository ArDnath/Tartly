import "server-only";

import { upsertParsedMessage } from "@/lib/gmail/sync";
import type { ParsedMessage } from "@/lib/gmail/parse";
import {
  defaultOutlookTransport,
  type OutlookTransport,
} from "@/lib/outlook/client";
import {
  getOutlookMessage,
  listOutlookMessages,
} from "@/lib/outlook/service";
import { mailboxRepository } from "@/lib/repositories/mailboxes";
import { messageRepository } from "@/lib/repositories/messages";
import { threadRepository } from "@/lib/repositories/threads";

/**
 * Pull Outlook mail into the same Postgres mirror the Gmail path writes.
 *
 * Graph has no equivalent of Gmail's history cursor that is worth the extra
 * subscription plumbing here, so this is a bounded recent-window sync: the
 * newest inbox and sent messages are re-read and upserted idempotently. It runs
 * when the user opens Mail/Inbox, after connecting an account, and from the
 * daily cron. The mirror ids carry the `outlook:` namespace, which is what lets
 * the triage inbox open the live Graph conversation and lets approvals send
 * back through Outlook.
 */

const SYNC_WINDOW = 40;

function toParsedMessage(
  message: Awaited<ReturnType<typeof getOutlookMessage>>,
): ParsedMessage {
  const sent = message.box === "sent";
  return {
    gmailMessageId: `outlook:${message.id}`,
    gmailThreadId: `outlook:${message.threadId}`,
    subject: message.subject,
    from: {
      name: message.from.name || null,
      email: message.from.email,
    },
    to: message.to.map((address) => ({
      name: address.name || null,
      email: address.email,
    })),
    cc: (message.cc ?? []).map((address) => ({
      name: address.name || null,
      email: address.email,
    })),
    bodyText: message.body,
    bodyHtml: message.bodyHtml ?? null,
    snippet: message.preview || null,
    labels: [
      ...(sent ? ["SENT"] : ["INBOX"]),
      ...(message.unread ? ["UNREAD"] : []),
      ...message.labels,
    ],
    unsubscribe: message.unsubscribe
      ? {
          ...(message.unsubscribe.url ? { url: message.unsubscribe.url } : {}),
          ...(message.unsubscribe.mailto
            ? { mailto: message.unsubscribe.mailto }
            : {}),
          oneClick: message.unsubscribe.oneClick,
          ...(message.unsubscribe.listId
            ? { listId: message.unsubscribe.listId }
            : {}),
        }
      : null,
    autoSubmitted: message.autoSubmitted === true,
    sentAt: new Date(message.receivedAt),
  };
}

export async function syncOutlookMailbox(
  userId: string,
  mailboxId: string,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<{ synced: number }> {
  const mailbox = await mailboxRepository.findByIdForUser(userId, mailboxId);
  if (!mailbox) throw new Error(`Mailbox ${mailboxId} not found for user.`);

  try {
    const [inbox, sent] = await Promise.all([
      listOutlookMessages(
        userId,
        { box: "inbox", limit: SYNC_WINDOW },
        transport,
      ),
      listOutlookMessages(
        userId,
        { box: "sent", limit: SYNC_WINDOW },
        transport,
      ),
    ]);

    // Mirror sent replies only when their conversation is also in the recent
    // inbox window. A sent-only conversation has no inbound turn to triage and
    // would otherwise become a bogus "needs reply" candidate.
    const inboxThreads = new Set(
      inbox.messages.map((message) => message.threadId),
    );
    const sentIds = new Set(
      sent.messages
        .filter((message) => inboxThreads.has(message.threadId))
        .map((message) => message.id),
    );
    const summaries = [
      ...inbox.messages,
      ...sent.messages.filter((message) => sentIds.has(message.id)),
    ].sort(
      (a, b) =>
        new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime(),
    );
    const byId = new Map(summaries.map((message) => [message.id, message]));
    const ids = [...byId.keys()];
    const existing = await messageRepository.existingGmailMessageIds(
      ids.map((id) => `outlook:${id}`),
    );

    let synced = 0;
    for (const id of ids) {
      if (existing.has(`outlook:${id}`)) continue;

      // The list carries metadata only; read one body at a time. The window is
      // bounded, and messages already in the mirror are skipped above.
      const full = await getOutlookMessage(userId, id, transport);
      await upsertParsedMessage({
        userId,
        mailboxId,
        parsed: toParsedMessage(
          sentIds.has(id) ? { ...full, box: "sent" } : full,
        ),
      });
      synced += 1;
    }

    // `summaries` is oldest-first. For every conversation, the last entry is
    // the newest message, so a read state/category change in Outlook refreshes
    // the inbox badge even when the body itself was already mirrored.
    const latestByThread = new Map<string, (typeof summaries)[number]>();
    for (const message of summaries) {
      latestByThread.set(message.threadId, message);
    }
    await Promise.all(
      [...latestByThread.values()].map((message) =>
        threadRepository
          .updateMirrorState({
            gmailThreadId: `outlook:${message.threadId}`,
            subject: message.subject,
            labels: message.labels,
            isUnread: message.unread,
          })
          .catch(() => undefined),
      ),
    );

    await mailboxRepository.updateSyncCursor({
      mailboxId,
      historyId: null,
      lastSyncedAt: new Date(),
    });
    if (mailbox.syncError) {
      await mailboxRepository.updateSyncError(mailboxId, null);
    }

    return { synced };
  } catch (error) {
    await mailboxRepository
      .updateSyncError(mailboxId, "sync_failed")
      .catch(() => {});
    throw error;
  }
}
