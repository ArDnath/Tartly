import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/lib/db";
import { mailboxes, messages, threads } from "@/lib/db/schema";
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
): Promise<{ messageIds: string[]; historyId: string | null }> {
  const params = new URLSearchParams({ startHistoryId, maxResults: "100" });
  const response = await gmailJson<GmailHistoryResponse>(
    userId,
    `/history?${params.toString()}`,
    undefined,
    transport,
  );

  const ids = new Set<string>();
  for (const entry of response.history ?? []) {
    for (const message of entry.messages ?? []) {
      if (message.id) ids.add(message.id);
    }
    for (const added of entry.messagesAdded ?? []) {
      if (added.message?.id) ids.add(added.message.id);
    }
  }

  return { messageIds: [...ids], historyId: response.historyId ?? null };
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

  const insertedThread = await db
    .insert(threads)
    .values({
      id: nanoid(),
      mailboxId,
      userId,
      gmailThreadId: parsed.gmailThreadId,
      subject: parsed.subject,
      lastMessageAt: parsed.sentAt,
      labels: parsed.labels,
      isUnread: parsed.labels.includes("UNREAD"),
    })
    .onConflictDoUpdate({
      target: threads.gmailThreadId,
      set: {
        subject: parsed.subject,
        labels: parsed.labels,
        isUnread: parsed.labels.includes("UNREAD"),
        updatedAt: new Date(),
      },
    })
    .returning({ id: threads.id, lastMessageAt: threads.lastMessageAt });

  const thread = insertedThread[0];

  // Keep lastMessageAt monotonic: an older message fetched later must not
  // move the thread backwards.
  if (
    parsed.sentAt &&
    (!thread.lastMessageAt || parsed.sentAt > thread.lastMessageAt)
  ) {
    await db
      .update(threads)
      .set({ lastMessageAt: parsed.sentAt })
      .where(eq(threads.id, thread.id));
  }

  const insertedMessage = await db
    .insert(messages)
    .values({
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
      sentAt: parsed.sentAt,
    })
    .onConflictDoUpdate({
      target: messages.gmailMessageId,
      set: {
        bodyText,
        bodyHtml: parsed.bodyHtml,
        snippet: parsed.snippet,
      },
    })
    .returning({ id: messages.id });

  return { threadId: thread.id, messageId: insertedMessage[0].id };
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
  const rows = await db
    .select()
    .from(mailboxes)
    .where(and(eq(mailboxes.id, mailboxId), eq(mailboxes.userId, userId)))
    .limit(1);

  const mailbox = rows[0];
  if (!mailbox) throw new Error(`Mailbox ${mailboxId} not found for user.`);

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

  await db
    .update(mailboxes)
    .set({
      historyId: historyId ?? mailbox.historyId,
      lastSyncedAt: new Date(),
    })
    .where(eq(mailboxes.id, mailboxId));

  return { synced, historyId: historyId ?? mailbox.historyId };
}
