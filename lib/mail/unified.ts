import "server-only";

import {
  connectedMailProviders,
  resolveProviderEmails,
  type MailProviderId,
} from "@/lib/mail/accounts";
import {
  archive,
  deleteMessages,
  emptyTrash,
  getAttachment,
  getMessage,
  getThread,
  listMessages,
  setRead,
  setSpam,
  setStarred,
  trash,
  unarchive,
  untrash,
} from "@/lib/mail/service";
import {
  deleteOutlookMessages,
  emptyOutlookTrash,
  getOutlookAttachment,
  getOutlookMessage,
  getOutlookThread,
  listOutlookMessages,
  setOutlookArchived,
  setOutlookRead,
  setOutlookSpam,
  setOutlookStarred,
  setOutlookTrashed,
} from "@/lib/outlook/service";
import type { MailMessage, MailThread } from "@/lib/mail/types";

/**
 * The shared inbox.
 *
 * Every view reads from each connected mail account and merges the results,
 * newest first, so Gmail and Outlook land in one list. Outlook ids are namespaced
 * with an `outlook:` prefix; Gmail ids are left untouched, so a raw Gmail id
 * from an email link (or the triage mirror) keeps working. That single
 * convention is what lets reads and mutations route back to the right provider
 * without a lookup table.
 *
 * Pagination stays per-provider: a next-page cursor is only returned when a
 * single account backs the view (a cross-provider cursor would need a merged
 * server-side ordering we deliberately don't keep).
 */

const OUTLOOK_PREFIX = "outlook:";

export function isOutlookId(id: string): boolean {
  return id.startsWith(OUTLOOK_PREFIX);
}

function stripOutlookId(id: string): string {
  return id.slice(OUTLOOK_PREFIX.length);
}

function tagOutlook(message: MailMessage, accountEmail: string | null): MailMessage {
  return {
    ...message,
    id: `${OUTLOOK_PREFIX}${message.id}`,
    threadId: `${OUTLOOK_PREFIX}${message.threadId}`,
    provider: "outlook",
    ...(accountEmail ? { accountEmail } : {}),
  };
}

function tagGmail(message: MailMessage, accountEmail: string | null): MailMessage {
  return {
    ...message,
    provider: "gmail",
    ...(accountEmail ? { accountEmail } : {}),
  };
}

const byNewest = (a: MailMessage, b: MailMessage) =>
  new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();

/** Which providers a request's `account` filter leaves in scope. */
function providersFor(
  connected: MailProviderId[],
  account: string | undefined,
): MailProviderId[] {
  if (account === "gmail") return connected.filter((p) => p === "google");
  if (account === "outlook") return connected.filter((p) => p === "microsoft");
  return connected;
}

function partition(ids: string[]): { gmail: string[]; outlook: string[] } {
  const gmail: string[] = [];
  const outlook: string[] = [];
  for (const id of ids) {
    if (isOutlookId(id)) outlook.push(stripOutlookId(id));
    else gmail.push(id);
  }
  return { gmail, outlook };
}

export interface UnifiedListOptions {
  box?: string;
  search?: string;
  limit?: number;
  pageToken?: string;
  /** "all" (default), "gmail" or "outlook". */
  account?: string;
}

export interface UnifiedListResult {
  messages: MailMessage[];
  labels: string[];
  nextPageToken?: string;
}

/**
 * One page of the shared inbox across every connected account.
 *
 * A provider outage degrades the view rather than emptying it: if one account
 * succeeds and the other fails, the successful rows are returned. Only when
 * *every* account fails does the error propagate (so a revoked Gmail grant still
 * surfaces its reconnect prompt).
 */
export async function listUnifiedMessages(
  userId: string,
  options: UnifiedListOptions = {},
): Promise<UnifiedListResult> {
  const connected = await connectedMailProviders(userId);

  // An empty connection list keeps the old Gmail-only path, whose auth error is
  // what tells the UI to offer a reconnect.
  if (connected.length === 0) {
    return listMessages(userId, {
      ...(options.box ? { box: options.box } : {}),
      ...(options.search ? { search: options.search } : {}),
      ...(options.limit ? { limit: options.limit } : {}),
      ...(options.pageToken ? { pageToken: options.pageToken } : {}),
    });
  }

  let providers = providersFor(connected, options.account);

  // Gmail's label syntax has no Graph equivalent; a label view is Gmail-only.
  const labelSearch = options.search?.includes("label:") ?? false;
  if (labelSearch) {
    providers = providers.filter((p) => p === "google");
    if (providers.length === 0) return { messages: [], labels: [] };
  }

  // A cursor belongs to one provider; we only ever emit one for single-provider
  // views, so ignore it if the scope widened.
  const [emails, gmailResult, outlookResult] = await Promise.all([
    resolveProviderEmails(userId),
    providers.includes("google")
      ? listMessages(userId, {
          ...(options.box ? { box: options.box } : {}),
          ...(options.search ? { search: options.search } : {}),
          ...(options.limit ? { limit: options.limit } : {}),
          ...(options.pageToken && providers.length === 1
            ? { pageToken: options.pageToken }
            : {}),
        }).then(
          (value) => ({ ok: true as const, value }),
          (error) => ({ ok: false as const, error }),
        )
      : null,
    providers.includes("microsoft")
      ? listOutlookMessages(userId, {
          ...(options.box ? { box: options.box } : {}),
          ...(options.search ? { search: options.search } : {}),
          ...(options.limit ? { limit: options.limit } : {}),
          ...(options.pageToken && providers.length === 1
            ? { pageToken: options.pageToken }
            : {}),
        }).then(
          (value) => ({ ok: true as const, value }),
          (error) => ({ ok: false as const, error }),
        )
      : null,
  ]);

  const succeededCount =
    (gmailResult?.ok ? 1 : 0) + (outlookResult?.ok ? 1 : 0);

  if (succeededCount === 0) {
    // Nothing came back: rethrow the (most relevant) underlying failure.
    const firstError: unknown =
      (gmailResult && !gmailResult.ok && gmailResult.error) ||
      (outlookResult && !outlookResult.ok && outlookResult.error);
    if (firstError instanceof Error) throw firstError;
    throw new Error("No connected mail account responded.");
  }

  const gmailMessages =
    gmailResult?.ok && gmailResult.value.messages
      ? gmailResult.value.messages.map((message) =>
          tagGmail(message, emails.gmail),
        )
      : [];
  const outlookMessages =
    outlookResult?.ok && outlookResult.value.messages
      ? outlookResult.value.messages.map((message) =>
          tagOutlook(message, emails.outlook),
        )
      : [];

  const merged = [...gmailMessages, ...outlookMessages].sort(byNewest);

  const singleToken =
    providers.length === 1
      ? (gmailResult?.ok ? gmailResult.value.nextPageToken : undefined) ??
        (outlookResult?.ok ? outlookResult.value.nextPageToken : undefined)
      : undefined;

  return {
    messages: options.limit ? merged.slice(0, options.limit) : merged,
    labels: gmailResult?.ok ? gmailResult.value.labels : [],
    ...(singleToken ? { nextPageToken: singleToken } : {}),
  };
}

/** One message with its body, routed to the account that owns it. */
export async function getUnifiedMessage(
  userId: string,
  id: string,
): Promise<MailMessage> {
  const emails = await resolveProviderEmails(userId);
  if (isOutlookId(id)) {
    return tagOutlook(await getOutlookMessage(userId, stripOutlookId(id)), emails.outlook);
  }
  return tagGmail(await getMessage(userId, id), emails.gmail);
}

/** A whole conversation, routed to the account that owns it. */
export async function getUnifiedThread(
  userId: string,
  threadId: string,
): Promise<MailThread> {
  const emails = await resolveProviderEmails(userId);
  if (isOutlookId(threadId)) {
    const thread = await getOutlookThread(userId, stripOutlookId(threadId));
    return {
      id: `${OUTLOOK_PREFIX}${thread.id}`,
      subject: thread.subject,
      messages: thread.messages.map((message) => tagOutlook(message, emails.outlook)),
    };
  }
  const thread = await getThread(userId, threadId);
  return {
    id: thread.id,
    subject: thread.subject,
    messages: thread.messages.map((message) => tagGmail(message, emails.gmail)),
  };
}

/**
 * One attachment's bytes, routed to the account that owns the message. Backs
 * the same-origin proxy that renders inline (`cid:`) images. Ownership is
 * implicit: the id came from this user's own mailbox, and the provider call runs
 * on their grant.
 */
export async function getUnifiedAttachment(
  userId: string,
  messageId: string,
  attachmentId: string,
): Promise<{ body: Buffer; contentType?: string }> {
  if (isOutlookId(messageId)) {
    return getOutlookAttachment(userId, stripOutlookId(messageId), attachmentId);
  }
  return { body: await getAttachment(userId, messageId, attachmentId) };
}

// --------------------------------------------------------------------------
// Mutations — dispatched per provider by the id prefix
// --------------------------------------------------------------------------

export async function setReadUnified(
  userId: string,
  ids: string[],
  read: boolean,
): Promise<void> {
  const { gmail, outlook } = partition(ids);
  await Promise.all([
    gmail.length ? setRead(userId, gmail, read) : Promise.resolve(),
    outlook.length ? setOutlookRead(userId, outlook, read) : Promise.resolve(),
  ]);
}

export async function setStarredUnified(
  userId: string,
  ids: string[],
  starred: boolean,
): Promise<void> {
  const { gmail, outlook } = partition(ids);
  await Promise.all([
    gmail.length ? setStarred(userId, gmail, starred) : Promise.resolve(),
    outlook.length ? setOutlookStarred(userId, outlook, starred) : Promise.resolve(),
  ]);
}

export async function setArchivedUnified(
  userId: string,
  ids: string[],
  archived: boolean,
): Promise<void> {
  const { gmail, outlook } = partition(ids);
  await Promise.all([
    gmail.length
      ? archived
        ? archive(userId, gmail)
        : unarchive(userId, gmail)
      : Promise.resolve(),
    outlook.length
      ? setOutlookArchived(userId, outlook, archived)
      : Promise.resolve(),
  ]);
}

export async function setTrashedUnified(
  userId: string,
  ids: string[],
  trashed: boolean,
): Promise<void> {
  const { gmail, outlook } = partition(ids);
  await Promise.all([
    gmail.length
      ? trashed
        ? trash(userId, gmail)
        : untrash(userId, gmail)
      : Promise.resolve(),
    outlook.length
      ? setOutlookTrashed(userId, outlook, trashed)
      : Promise.resolve(),
  ]);
}

export async function setSpamUnified(
  userId: string,
  ids: string[],
  spam: boolean,
): Promise<void> {
  const { gmail, outlook } = partition(ids);
  await Promise.all([
    gmail.length ? setSpam(userId, gmail, spam) : Promise.resolve(),
    outlook.length ? setOutlookSpam(userId, outlook, spam) : Promise.resolve(),
  ]);
}

/**
 * Permanently delete messages across providers. Irreversible: on Gmail it
 * bypasses the trash and needs the restricted full-mailbox scope; on Outlook it
 * is Graph's `permanentDelete`.
 */
export async function deleteMessagesUnified(
  userId: string,
  ids: string[],
): Promise<void> {
  const { gmail, outlook } = partition(ids);
  await Promise.all([
    gmail.length ? deleteMessages(userId, gmail) : Promise.resolve(),
    outlook.length ? deleteOutlookMessages(userId, outlook) : Promise.resolve(),
  ]);
}

/** Permanently delete every trashed message across providers. Returns the count. */
export async function emptyTrashUnified(userId: string): Promise<number> {
  const [gmailCount, outlookCount] = await Promise.all([
    emptyTrash(userId),
    emptyOutlookTrash(userId),
  ]);
  return gmailCount + outlookCount;
}
