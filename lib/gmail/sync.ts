import "server-only";

import { nanoid } from "nanoid";

import {
  defaultGmailTransport,
  gmailJson,
  type GmailTransport,
} from "@/lib/gmail/client";
import {
  htmlToText,
  parseGmailMessage,
  type GmailMessageResource,
  type ParsedMessage,
} from "@/lib/gmail/parse";
import { mailboxRepository } from "@/lib/repositories/mailboxes";
import { messageRepository } from "@/lib/repositories/messages";
import { threadRepository } from "@/lib/repositories/threads";

type GmailListResponse = {
  messages?: Array<{ id?: string | null; threadId?: string | null }>;
  nextPageToken?: string | null;
};

type GmailHistoryResponse = {
  history?: Array<{
    messages?: Array<{ id?: string | null; threadId?: string | null }>;
    messagesAdded?: Array<{ message?: { id?: string | null } }>;
  }>;
  nextPageToken?: string | null;
  historyId?: string | null;
};

type GmailProfile = { emailAddress?: string; historyId?: string };

export async function getGmailProfile(
  userId: string,
  transport: GmailTransport = defaultGmailTransport,
): Promise<GmailProfile> {
  return gmailJson<GmailProfile>(userId, "/profile", undefined, transport);
}

export async function listRecentMessageIds(
  userId: string,
  {
    query = "in:inbox",
    maxResults = 25,
    transport = defaultGmailTransport,
  }: { query?: string; maxResults?: number; transport?: GmailTransport } = {},
): Promise<string[]> {
  const params = new URLSearchParams({
    q: query,
    maxResults: String(maxResults),
  });
  const response = await gmailJson<GmailListResponse>(
    userId,
    `/messages?${params.toString()}`,
    undefined,
    transport,
  );
  return (response.messages ?? [])
    .map((message) => message.id)
    .filter((id): id is string => Boolean(id));
}

export async function listHistoryMessageIds(
  userId: string,
  startHistoryId: string,
  transport: GmailTransport = defaultGmailTransport,
  options: { maxPages?: number } = {},
): Promise<{ messageIds: string[]; historyId: string | null; pageCount: number }> {
  // Bound the walk: a single drain must not page for minutes. Five pages of
  // 100 is 500 messages, far more than one overnight window produces.
  const maxPages = Math.max(1, Math.min(options.maxPages ?? 5, 20));
  const ids = new Set<string>();
  let pageToken: string | undefined;
  let historyId: string | null = null;
  let pageCount = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({ startHistoryId, maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);

    const response = await gmailJson<GmailHistoryResponse>(
      userId,
      `/history?${params.toString()}`,
      undefined,
      transport,
    );
    pageCount += 1;

    for (const entry of response.history ?? []) {
      for (const message of entry.messages ?? []) {
        if (message.id) ids.add(message.id);
      }
      for (const added of entry.messagesAdded ?? []) {
        if (added.message?.id) ids.add(added.message.id);
      }
    }

    if (response.historyId) historyId = response.historyId;
    if (!response.nextPageToken) break;
    pageToken = response.nextPageToken;
  }

  return { messageIds: [...ids], historyId, pageCount };
}

export async function fetchMessageResource(
  userId: string,
  messageId: string,
  transport: GmailTransport = defaultGmailTransport,
): Promise<GmailMessageResource> {
  return gmailJson<GmailMessageResource>(
    userId,
    `/messages/${messageId}?format=full`,
    undefined,
    transport,
  );
}

export type UpsertedMessage = {
  threadId: string;
  messageId: string;
};

/**
 * Upserts a parsed message and its thread. Idempotent on the Gmail ids so a
 * replayed history page (or a double-fired webhook) cannot duplicate rows.
 */
export async function upsertParsedMessage({
  userId,
  mailboxId,
  parsed,
}: {
  userId: string;
  mailboxId: string;
  parsed: ParsedMessage;
}): Promise<UpsertedMessage> {
  if (!parsed.gmailMessageId || !parsed.gmailThreadId) {
    throw new Error("Parsed message is missing Gmail ids.");
  }

  const bodyText =
    parsed.bodyText ||
    (parsed.bodyHtml ? htmlToText(parsed.bodyHtml) : "") ||
    parsed.snippet ||
    "";

  const thread = await threadRepository.upsertMirrored({
    id: nanoid(),
    mailboxId,
    userId,
    gmailThreadId: parsed.gmailThreadId,
    subject: parsed.subject,
    lastMessageAt: parsed.sentAt,
    labels: parsed.labels,
    isUnread: parsed.labels.includes("UNREAD"),
  });

  // Keep lastMessageAt monotonic: an older message fetched later must not
  // move the thread backwards.
  if (
    parsed.sentAt &&
    (!thread.lastMessageAt || parsed.sentAt > thread.lastMessageAt)
  ) {
    await threadRepository.updateLastMessageAt(
      thread.id,
      parsed.sentAt,
    );
  }

  const insertedMessage = await messageRepository.upsertMirrored(
    {
      id: nanoid(),
      threadId: thread.id,
      gmailMessageId: parsed.gmailMessageId,
      direction: parsed.labels.includes("SENT") ? "outbound" : "inbound",
      fromAddr: parsed.from?.email ?? null,
      toAddr: parsed.to.map((address) => address.email),
      subject: parsed.subject,
      bodyText,
      bodyHtml: parsed.bodyHtml,
      snippet: parsed.snippet,
      unsubscribe: parsed.unsubscribe,
      autoSubmitted: parsed.autoSubmitted,
      sentAt: parsed.sentAt,
    },
  );

  return { threadId: thread.id, messageId: insertedMessage.id };
}

/**
 * Incremental sync: history.list from the stored cursor, falling back to a
 * recent-message listing when no cursor exists (first connect or expired
 * history). Stores the new cursor and stamps `lastSyncedAt`.
 */
export async function syncMailbox(
  userId: string,
  mailboxId: string,
  transport: GmailTransport = defaultGmailTransport,
): Promise<{ synced: number; historyId: string | null }> {
  const mailbox = await mailboxRepository.findByIdForUser(
    userId,
    mailboxId,
  );
  if (!mailbox) throw new Error(`Mailbox ${mailboxId} not found for user.`);

  try {
    let messageIds: string[] = [];
    let historyId: string | null = null;

    if (mailbox.historyId) {
      try {
        const result = await listHistoryMessageIds(
          userId,
          mailbox.historyId,
          transport,
        );
        messageIds = result.messageIds;
        historyId = result.historyId;
      } catch (error) {
        // Expired/invalid cursor: fall back to a recent listing.
        console.warn("[gmail/sync] history.list failed, falling back", error);
      }
    }

    if (!mailbox.historyId || messageIds.length === 0) {
      messageIds = await listRecentMessageIds(userId, { transport });
      if (!historyId) {
        const profile = await getGmailProfile(userId, transport);
        historyId = profile.historyId ?? null;
      }
    }

    let synced = 0;
    for (const messageId of messageIds) {
      const resource = await fetchMessageResource(userId, messageId, transport);
      await upsertParsedMessage({
        userId,
        mailboxId,
        parsed: parseGmailMessage(resource),
      });
      synced += 1;
    }

    await mailboxRepository.updateSyncCursor({
      mailboxId,
      historyId: historyId ?? mailbox.historyId,
      lastSyncedAt: new Date(),
    });

    // A successful pass clears any prior failure marker.
    if (mailbox.syncError) {
      await mailboxRepository.updateSyncError(mailboxId, null);
    }

    return { synced, historyId: historyId ?? mailbox.historyId };
  } catch (error) {
    // Record a short, content-free marker, then rethrow so the caller's
    // retry/backoff still applies. Never store the raw error (may leak).
    await mailboxRepository
      .updateSyncError(mailboxId, "sync_failed")
      .catch(() => {});
    throw error;
  }
}
