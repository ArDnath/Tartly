import "server-only";

import { createHash } from "node:crypto";

import { defaultGmailTransport, gmailJson, type GmailTransport } from "@/lib/gmail/client";
import { buildRawMessage } from "@/lib/gmail/mime";
import { decodeBase64Url, decodeRfc2047 } from "@/lib/gmail/parse";

/**
 * Live Gmail pass-through for the mail client.
 *
 * Unlike `lib/gmail/sync.ts` (which mirrors mail into Postgres for triage),
 * every call here reads or writes Gmail directly — Gmail stays the source of
 * truth, so a message archived in Gmail proper is archived here on the next
 * load. Ported from topple's `apps/api/src/services/gmail.service.ts`, keeping
 * app-server's `(userId, …)` + `gmailJson` transport instead of `(token, …)`.
 */

/**
 * How many message bodies to fetch in parallel when building a list page.
 *
 * A page is up to 60 metadata reads; the token/account lookups are cached, so
 * this is bounded by Gmail latency rather than our own queries. 16 keeps the
 * waves to ~4 for a full page while staying well inside Gmail's per-user
 * quota.
 */
const LIST_CONCURRENCY = 16;

// --------------------------------------------------------------------------
// Wire types (the subset of the Gmail resource we use)
// --------------------------------------------------------------------------
interface GmailHeader {
  name?: string | null;
  value?: string | null;
}

interface GmailPart {
  partId?: string | null;
  mimeType?: string | null;
  filename?: string | null;
  headers?: GmailHeader[] | null;
  body?: { size?: number | null; data?: string | null; attachmentId?: string | null } | null;
  parts?: GmailPart[] | null;
}

interface GmailMessage {
  id?: string | null;
  threadId?: string | null;
  labelIds?: string[] | null;
  snippet?: string | null;
  internalDate?: string | null;
  historyId?: string | null;
  payload?: GmailPart | null;
}

interface GmailLabel {
  id: string;
  name: string;
  type?: "system" | "user";
}

export interface MailAddress {
  name: string;
  email: string;
}

export interface MailAttachment {
  id: string;
  name: string;
  size: string;
}

/** The shape the mail UI renders. Mirrors `MailMessage` in `lib/mail/types.ts`. */
export interface MailMessage {
  id: string;
  threadId: string;
  box: "inbox" | "sent" | "drafts" | "scheduled" | "archive" | "trash" | "spam";
  from: MailAddress;
  to: MailAddress[];
  cc?: MailAddress[];
  senderLine?: string;
  subject: string;
  preview: string;
  /** Plain text: previews, search, and the quoted block in a reply. */
  body: string;
  /** The sender's own HTML, when the message had an HTML part. Untrusted. */
  bodyHtml?: string;
  receivedAt: string;
  tag: "important" | "newsletter" | "calendar" | "other";
  labels: string[];
  unread: boolean;
  starred: boolean;
  replied?: boolean;
  /** The RFC 2822 Message-ID this message replies to, when present. */
  inReplyTo?: string;
  attachments?: MailAttachment[];
}

// --------------------------------------------------------------------------
// Parsing
// --------------------------------------------------------------------------

function headerValue(headers: GmailHeader[] | null | undefined, name: string): string {
  const target = name.toLowerCase();
  const match = (headers ?? []).find(
    (header) => (header.name ?? "").toLowerCase() === target,
  );
  return match?.value ?? "";
}

/** `"Ada Lovelace" <ada@example.com>, bob@example.com` → structured addresses. */
export function parseAddressList(value: string): MailAddress[] {
  if (!value.trim()) return [];

  const addresses: MailAddress[] = [];
  // Split on commas that aren't inside a quoted display name.
  for (const part of value.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
    const entry = part.trim();
    if (!entry) continue;

    const angled = entry.match(/^(.*)<([^>]+)>$/);
    if (angled) {
      const name = decodeRfc2047(angled[1]!.trim().replace(/^"(.*)"$/, "$1"));
      const email = angled[2]!.trim();
      addresses.push({ name: name || email.split("@")[0]!, email });
      continue;
    }
    const email = decodeRfc2047(entry.replace(/^"(.*)"$/, "$1"));
    addresses.push({ name: email.split("@")[0]!, email });
  }
  return addresses;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Both representations of the body.
 *
 * A `multipart/alternative` message carries the same content twice, and the
 * two are not interchangeable: the HTML part is what the sender designed, and
 * the plain part is a lossy transcription where links collapse to bare URLs.
 * Keep both — HTML for display, text for previews, search and reply quoting.
 */
function extractBody(payload: GmailPart | null | undefined): {
  text: string;
  html: string;
} {
  if (!payload) return { text: "", html: "" };

  const plain: string[] = [];
  const html: string[] = [];

  const walk = (part: GmailPart) => {
    const mime = part.mimeType ?? "";
    if (part.body?.data) {
      if (mime === "text/plain") plain.push(decodeBase64Url(part.body.data));
      else if (mime === "text/html") html.push(decodeBase64Url(part.body.data));
    }
    part.parts?.forEach(walk);
  };
  walk(payload);

  const htmlBody = html.join("\n").trim();
  return {
    // Derive text from HTML only when the sender didn't provide it.
    text: plain.length > 0 ? plain.join("\n").trim() : stripHtml(htmlBody),
    html: htmlBody,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Gmail's `internalDate` is epoch milliseconds but is typed as a string and is
 * not guaranteed numeric. `new Date(NaN).toISOString()` throws a RangeError,
 * so fall back to "now" rather than failing the whole mailbox read.
 */
function formatInternalDate(internalDate: string | null | undefined): string {
  const numeric = Number(internalDate);
  if (internalDate && Number.isFinite(numeric)) {
    return new Date(numeric).toISOString();
  }
  return new Date().toISOString();
}

function collectAttachments(
  payload: GmailPart | null | undefined,
): MailAttachment[] {
  const attachments: MailAttachment[] = [];

  const walk = (part: GmailPart) => {
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        id: part.body.attachmentId,
        name: part.filename,
        size: formatBytes(part.body.size ?? 0),
      });
    }
    part.parts?.forEach(walk);
  };
  if (payload) walk(payload);
  return attachments;
}

function deriveBox(labelIds: string[]): MailMessage["box"] {
  // Order matters: a trashed draft is in the trash, not in drafts.
  if (labelIds.includes("TRASH")) return "trash";
  if (labelIds.includes("SPAM")) return "spam";
  if (labelIds.includes("DRAFT")) return "drafts";
  if (labelIds.includes("SENT")) return "sent";
  if (labelIds.includes("INBOX")) return "inbox";
  // Gmail's "archive" is simply the absence of INBOX.
  return "archive";
}

function deriveTag(labelIds: string[]): MailMessage["tag"] {
  if (labelIds.includes("CATEGORY_PROMOTIONS")) return "newsletter";
  if (labelIds.includes("CATEGORY_UPDATES")) return "newsletter";
  if (labelIds.includes("CATEGORY_FORUMS")) return "newsletter";
  if (labelIds.includes("IMPORTANT")) return "important";
  return "other";
}

/** Sender column: "ada .. bob, carol" when several people are on the thread. */
function senderLine(from: MailAddress, to: MailAddress[]): string | undefined {
  if (to.length <= 1) return undefined;
  const first = from.email.split("@")[0];
  const rest = to
    .slice(0, 2)
    .map((address) => address.name || address.email.split("@")[0])
    .join(", ");
  return `${first} .. ${rest}`;
}

function toMailMessage(
  message: GmailMessage,
  userLabels: Map<string, string>,
): MailMessage {
  const labelIds = message.labelIds ?? [];
  const headers = message.payload?.headers;

  const from = parseAddressList(headerValue(headers, "From"))[0] ?? {
    name: "Unknown",
    email: "",
  };
  const to = parseAddressList(headerValue(headers, "To"));
  const cc = parseAddressList(headerValue(headers, "Cc"));
  const { text: body, html: bodyHtml } = extractBody(message.payload);
  const attachments = collectAttachments(message.payload);
  const sender = senderLine(from, to);

  const subject = headerValue(headers, "Subject");

  return {
    id: message.id ?? "",
    threadId: message.threadId ?? "",
    box: deriveBox(labelIds),
    from,
    to,
    ...(cc.length > 0 ? { cc } : {}),
    ...(sender ? { senderLine: sender } : {}),
    subject: subject ? decodeRfc2047(subject) : "(no subject)",
    preview: message.snippet ?? "",
    body,
    ...(bodyHtml ? { bodyHtml } : {}),
    receivedAt: formatInternalDate(message.internalDate),
    tag: deriveTag(labelIds),
    labels: labelIds
      .map((id) => userLabels.get(id))
      .filter((name): name is string => Boolean(name)),
    unread: labelIds.includes("UNREAD"),
    starred: labelIds.includes("STARRED"),
    ...(headerValue(headers, "In-Reply-To")
      ? {
          replied: true,
          inReplyTo: headerValue(headers, "In-Reply-To"),
        }
      : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

/** Resolve promises `limit` at a time so a 50-message page can't open 50 sockets. */
async function pooled<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await worker(items[index]!);
      }
    },
  );

  await Promise.all(runners);
  return results;
}

// --------------------------------------------------------------------------
// Labels
// --------------------------------------------------------------------------
/**
 * User labels change rarely but are read on every mailbox page and every
 * message open. A short TTL cache (with in-flight coalescing) keeps that off
 * the Gmail hot path; label writes invalidate it.
 */
const LABEL_CACHE_TTL_MS = 60 * 1000;
const labelCache = new Map<
  string,
  { value: Map<string, string>; expiresAt: number }
>();
const labelInFlight = new Map<string, Promise<Map<string, string>>>();

async function fetchUserLabelMap(
  userId: string,
  transport: GmailTransport,
): Promise<Map<string, string>> {
  const { labels } = await gmailJson<{ labels?: GmailLabel[] }>(
    userId,
    "/labels",
    undefined,
    transport,
  );
  const map = new Map<string, string>();
  for (const label of labels ?? []) {
    if (label.type === "user") map.set(label.id, label.name);
  }
  return map;
}

/** User-created labels only, keyed by id — system labels drive `box`/`tag`. */
async function userLabelMap(
  userId: string,
  transport: GmailTransport = defaultGmailTransport,
): Promise<Map<string, string>> {
  const cached = labelCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const pending = labelInFlight.get(userId);
  if (pending) return pending;

  const request = fetchUserLabelMap(userId, transport)
    .then((value) => {
      labelCache.set(userId, {
        value,
        expiresAt: Date.now() + LABEL_CACHE_TTL_MS,
      });
      return value;
    })
    .finally(() => {
      labelInFlight.delete(userId);
    });

  labelInFlight.set(userId, request);
  return request;
}

/** Forget cached labels after a write so the next read sees the change. */
function invalidateUserLabelMap(userId: string): void {
  labelCache.delete(userId);
}

export async function listLabels(userId: string): Promise<string[]> {
  return [...(await userLabelMap(userId)).values()].sort();
}

/** Look up a label id without creating it. Returns undefined when absent. */
async function findLabelIdByName(
  userId: string,
  name: string,
  transport: GmailTransport = defaultGmailTransport,
): Promise<string | undefined> {
  const { labels } = await gmailJson<{ labels?: GmailLabel[] }>(
    userId,
    "/labels",
    undefined,
    transport,
  );
  return labels?.find((label) => label.name.toLowerCase() === name.toLowerCase())
    ?.id;
}

/** Resolve a label name to its id, creating the label when it's new. */
async function labelIdForName(
  userId: string,
  name: string,
  transport: GmailTransport = defaultGmailTransport,
): Promise<string> {
  const existing = await findLabelIdByName(userId, name, transport);
  if (existing) return existing;

  const created = await gmailJson<GmailLabel>(
    userId,
    "/labels",
    {
      method: "POST",
      body: JSON.stringify({
        name,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      }),
    },
    transport,
  );
  invalidateUserLabelMap(userId);
  return created.id;
}

// --------------------------------------------------------------------------
// Reads
// --------------------------------------------------------------------------
/**
 * How each mailbox view is addressed on Gmail's side.
 *
 * System boxes go through `labelIds`, which is an exact match on the label
 * Gmail itself assigns — `deriveBox` reads those same labels back, so the two
 * directions cannot drift. Only the two views with no label of their own fall
 * back to search syntax: "archive" is the *absence* of INBOX, and "all" is
 * everything.
 *
 * `spamTrash` is not optional decoration. `messages.list` drops SPAM and TRASH
 * from every response unless `includeSpamTrash` is set, and it does so even
 * when the query names them explicitly.
 */
interface BoxLookup {
  labelIds?: string[];
  q?: string;
  spamTrash?: boolean;
}

const BOX_LOOKUP: Record<string, BoxLookup> = {
  inbox: { labelIds: ["INBOX"] },
  sent: { labelIds: ["SENT"] },
  drafts: { labelIds: ["DRAFT"] },
  starred: { labelIds: ["STARRED"] },
  trash: { labelIds: ["TRASH"], spamTrash: true },
  spam: { labelIds: ["SPAM"], spamTrash: true },
  // Anything filed away: not in the inbox, not something this mailbox wrote or
  // is still writing, and not a Hangouts/Chat record.
  archive: { q: "-in:inbox -in:sent -in:draft -in:chats" },
  // Live mail wherever it sits — inbox, sent or filed away. Backs the label
  // views, since a label can be on any of those, while leaving
  // `includeSpamTrash` off is what keeps a labelled message in the bin out of
  // them.
  active: { q: "-in:chats" },
  all: { q: "in:anywhere", spamTrash: true },
};

export interface ListOptions {
  box?: string;
  search?: string;
  limit?: number;
  pageToken?: string;
}

export async function listMessages(
  userId: string,
  options: ListOptions = {},
  transport: GmailTransport = defaultGmailTransport,
): Promise<{
  messages: MailMessage[];
  nextPageToken?: string;
  labels: string[];
}> {
  const lookup = BOX_LOOKUP[options.box ?? "inbox"] ?? BOX_LOOKUP.inbox!;

  const params = new URLSearchParams({
    maxResults: String(Math.min(options.limit ?? 30, 100)),
  });
  for (const labelId of lookup.labelIds ?? [])
    params.append("labelIds", labelId);

  const search = [lookup.q, options.search?.trim()].filter(Boolean).join(" ");
  if (search) params.set("q", search);
  if (lookup.spamTrash) params.set("includeSpamTrash", "true");
  if (options.pageToken) params.set("pageToken", options.pageToken);

  // The id list and the label dictionary are independent Gmail reads.
  const [page, labelMap] = await Promise.all([
    gmailJson<{
      messages?: { id?: string | null }[];
      nextPageToken?: string | null;
    }>(userId, `/messages?${params}`, undefined, transport),
    userLabelMap(userId, transport),
  ]);

  const ids = (page.messages ?? [])
    .map((message) => message.id)
    .filter((id): id is string => Boolean(id));

  // `messages.list` returns ids only. Metadata format is enough for the list
  // row (headers + snippet) and skips downloading every body.
  const messages = await pooled(ids, LIST_CONCURRENCY, async (id) =>
    toMailMessage(
      await gmailJson<GmailMessage>(
        userId,
        `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=In-Reply-To`,
        undefined,
        transport,
      ),
      labelMap,
    ),
  );

  return {
    messages,
    ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
    labels: [...labelMap.values()].sort(),
  };
}

/** One message with its body — what the reader pane opens. */
export async function getMessage(
  userId: string,
  id: string,
  transport: GmailTransport = defaultGmailTransport,
): Promise<MailMessage> {
  const [message, labelMap] = await Promise.all([
    gmailJson<GmailMessage>(userId, `/messages/${id}?format=full`, undefined, transport),
    userLabelMap(userId, transport),
  ]);
  return toMailMessage(message, labelMap);
}

interface GmailThread {
  id?: string | null;
  messages?: GmailMessage[] | null;
}

/**
 * A whole Gmail conversation, oldest first.
 *
 * `threads.get` returns the thread's messages in Gmail's own order; we sort by
 * `receivedAt` as well so the agent (and the thread view) can rely on
 * chronological order regardless of how Google serializes them.
 */
export async function getThread(
  userId: string,
  threadId: string,
  transport: GmailTransport = defaultGmailTransport,
): Promise<{ id: string; subject: string; messages: MailMessage[] }> {
  const [thread, labelMap] = await Promise.all([
    gmailJson<GmailThread>(userId, `/threads/${threadId}?format=full`, undefined, transport),
    userLabelMap(userId, transport),
  ]);

  const messages = (thread.messages ?? [])
    .map((message) => toMailMessage(message, labelMap))
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));

  return {
    id: thread.id ?? threadId,
    subject: messages[0]?.subject ?? "(no subject)",
    messages,
  };
}

// --------------------------------------------------------------------------
// Mutations
// --------------------------------------------------------------------------
async function modify(
  userId: string,
  ids: string[],
  body: { addLabelIds?: string[]; removeLabelIds?: string[] },
  transport: GmailTransport = defaultGmailTransport,
): Promise<void> {
  if (ids.length === 0) return;
  // batchModify takes up to 1000 ids and returns 204 (handled in gmailJson).
  await gmailJson<void>(
    userId,
    "/messages/batchModify",
    {
      method: "POST",
      body: JSON.stringify({ ids, ...body }),
    },
    transport,
  );
}

export function setRead(
  userId: string,
  ids: string[],
  read: boolean,
  transport: GmailTransport = defaultGmailTransport,
) {
  return modify(
    userId,
    ids,
    read ? { removeLabelIds: ["UNREAD"] } : { addLabelIds: ["UNREAD"] },
    transport,
  );
}

export function setStarred(
  userId: string,
  ids: string[],
  starred: boolean,
  transport: GmailTransport = defaultGmailTransport,
) {
  return modify(
    userId,
    ids,
    starred ? { addLabelIds: ["STARRED"] } : { removeLabelIds: ["STARRED"] },
    transport,
  );
}

/** Archive is removing INBOX; restore puts it back. */
export function archive(
  userId: string,
  ids: string[],
  transport: GmailTransport = defaultGmailTransport,
) {
  return modify(userId, ids, { removeLabelIds: ["INBOX"] }, transport);
}

export function unarchive(
  userId: string,
  ids: string[],
  transport: GmailTransport = defaultGmailTransport,
) {
  return modify(userId, ids, { addLabelIds: ["INBOX"] }, transport);
}

export function setSpam(
  userId: string,
  ids: string[],
  spam: boolean,
  transport: GmailTransport = defaultGmailTransport,
) {
  return modify(
    userId,
    ids,
    spam
      ? { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] }
      : { addLabelIds: ["INBOX"], removeLabelIds: ["SPAM"] },
    transport,
  );
}

/**
 * Trash, not delete. `messages.delete` is irreversible and needs a scope we
 * deliberately don't hold; trashing is what the UI's "delete" means anyway.
 */
export async function trash(
  userId: string,
  ids: string[],
  transport: GmailTransport = defaultGmailTransport,
): Promise<void> {
  await pooled(ids, LIST_CONCURRENCY, (id) =>
    gmailJson<void>(userId, `/messages/${id}/trash`, { method: "POST" }, transport),
  );
}

export async function untrash(
  userId: string,
  ids: string[],
  transport: GmailTransport = defaultGmailTransport,
): Promise<void> {
  await pooled(ids, LIST_CONCURRENCY, (id) =>
    gmailJson<void>(userId, `/messages/${id}/untrash`, { method: "POST" }, transport),
  );
}

export async function applyLabel(
  userId: string,
  ids: string[],
  label: string,
  transport: GmailTransport = defaultGmailTransport,
): Promise<void> {
  await modify(
    userId,
    ids,
    { addLabelIds: [await labelIdForName(userId, label, transport)] },
    transport,
  );
}

/**
 * Remove a label only if it already exists. Unlike `applyLabel`, this never
 * creates the label: removing a label the mailbox does not have is a no-op.
 */
export async function removeLabel(
  userId: string,
  ids: string[],
  label: string,
  transport: GmailTransport = defaultGmailTransport,
): Promise<void> {
  const labelId = await findLabelIdByName(userId, label, transport);
  if (!labelId) return;
  await modify(userId, ids, { removeLabelIds: [labelId] }, transport);
}

export async function createLabel(
  userId: string,
  label: string,
  transport: GmailTransport = defaultGmailTransport,
): Promise<void> {
  await labelIdForName(userId, label, transport);
}

// --------------------------------------------------------------------------
// Sending
// --------------------------------------------------------------------------
export interface OutgoingMail {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  /** Set when replying, so Gmail threads the message correctly. */
  threadId?: string;
  inReplyTo?: string;
}

/**
 * A stored Gmail draft.
 *
 * `version` is the optimistic-concurrency token (see `draftVersion`).
 */
export interface MailDraft {
  id: string;
  version: string;
  updatedAt: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
}

interface GmailDraft {
  id?: string | null;
  message?: GmailMessage | null;
}

/**
 * An opaque revision token for a draft.
 *
 * Gmail keeps the draft container stable but replaces the message inside it on
 * every update; the replacement carries a new `internalDate`/`historyId`. Hashing
 * that identity gives us a token that changes when — and only when — Gmail
 * accepts a new revision, without introducing a mirror table.
 */
function draftVersion(message: GmailMessage): string {
  return createHash("sha256")
    .update(
      [
        message.id ?? "",
        message.internalDate ?? "",
        message.historyId ?? "",
        message.threadId ?? "",
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 32);
}

function toMailDraft(draft: GmailDraft): MailDraft {
  const message = draft.message ?? {};
  const headers = message.payload?.headers;
  const internalDate = Number(message.internalDate ?? Number.NaN);
  const inReplyTo = headerValue(headers, "In-Reply-To");

  return {
    id: draft.id ?? message.id ?? "",
    version: draftVersion(message),
    updatedAt: Number.isFinite(internalDate)
      ? new Date(internalDate).toISOString()
      : new Date().toISOString(),
    to: parseAddressList(headerValue(headers, "To")).map((address) => address.email),
    cc: parseAddressList(headerValue(headers, "Cc")).map((address) => address.email),
    bcc: parseAddressList(headerValue(headers, "Bcc")).map((address) => address.email),
    subject: decodeRfc2047(headerValue(headers, "Subject")),
    body: extractBody(message.payload).text,
    ...(message.threadId ? { threadId: message.threadId } : {}),
    ...(inReplyTo ? { inReplyTo } : {}),
  };
}

function toOutboundMessage(from: string, mail: OutgoingMail) {
  return {
    from,
    to: mail.to,
    ...(mail.cc?.length ? { cc: mail.cc } : {}),
    ...(mail.bcc?.length ? { bcc: mail.bcc } : {}),
    subject: mail.subject,
    text: mail.body,
    ...(mail.inReplyTo
      ? { inReplyTo: mail.inReplyTo, references: [mail.inReplyTo] }
      : {}),
  };
}

/** Read one draft, owner-scoped by the resolved Gmail account. */
export async function getDraft(
  userId: string,
  draftId: string,
  transport: GmailTransport = defaultGmailTransport,
): Promise<MailDraft> {
  const draft = await gmailJson<GmailDraft>(
    userId,
    `/drafts/${draftId}?format=full`,
    undefined,
    transport,
  );
  return toMailDraft(draft);
}

/**
 * Saves a draft. Sending goes through the idempotent `sendEmail` path in
 * `lib/gmail/send.ts`; drafts have no ledger, so they use the shared MIME
 * builder directly. Gmail assigns the id; we read the draft back so the caller
 * gets a canonical revision token.
 */
export async function saveDraft(
  userId: string,
  mail: OutgoingMail,
  transport: GmailTransport = defaultGmailTransport,
): Promise<MailDraft> {
  const account = await profile(userId, transport);
  const raw = buildRawMessage(toOutboundMessage(account.emailAddress, mail));

  const created = await gmailJson<{ id: string }>(
    userId,
    "/drafts",
    {
      method: "POST",
      body: JSON.stringify({
        message: {
          raw,
          ...(mail.threadId ? { threadId: mail.threadId } : {}),
        },
      }),
    },
    transport,
  );

  return getDraft(userId, created.id, transport);
}

/**
 * Replaces a draft's contents. `drafts.update` replaces the whole inner message,
 * so callers must merge first (the draft service does, with a version check).
 */
export async function updateDraft(
  userId: string,
  draftId: string,
  mail: OutgoingMail,
  transport: GmailTransport = defaultGmailTransport,
): Promise<MailDraft> {
  const account = await profile(userId, transport);
  const raw = buildRawMessage(toOutboundMessage(account.emailAddress, mail));

  await gmailJson<GmailDraft>(
    userId,
    `/drafts/${draftId}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message: {
          raw,
          ...(mail.threadId ? { threadId: mail.threadId } : {}),
        },
      }),
    },
    transport,
  );

  return getDraft(userId, draftId, transport);
}

/**
 * The user's most recent drafts. Each is read back in full so it carries a
 * canonical version; bounded to `MAX_DRAFTS`.
 */
export const MAX_DRAFTS = 25;

export async function listDrafts(
  userId: string,
  limit = 10,
  transport: GmailTransport = defaultGmailTransport,
): Promise<MailDraft[]> {
  const capped = Math.min(Math.max(limit, 1), MAX_DRAFTS);
  const page = await gmailJson<{ drafts?: { id?: string | null }[] }>(
    userId,
    `/drafts?maxResults=${capped}`,
    undefined,
    transport,
  );
  const ids = (page.drafts ?? [])
    .map((draft) => draft.id)
    .filter((id): id is string => Boolean(id));

  return pooled(ids, 8, (id) => getDraft(userId, id, transport));
}

/**
 * The signed-in mailbox address — the "from" the composer shows.
 *
 * Read on its own request from the client on every mailbox load, so it is
 * cached briefly: the address never changes and `messagesTotal` is not used
 * for anything time-sensitive.
 */
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;
const profileCache = new Map<
  string,
  {
    value: { emailAddress: string; messagesTotal: number };
    expiresAt: number;
  }
>();

export async function profile(
  userId: string,
  transport: GmailTransport = defaultGmailTransport,
): Promise<{ emailAddress: string; messagesTotal: number }> {
  const cached = profileCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = await gmailJson<{
    emailAddress: string;
    messagesTotal: number;
  }>(userId, "/profile", undefined, transport);
  profileCache.set(userId, {
    value,
    expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
  });
  return value;
}

// --------------------------------------------------------------------------
// Correspondent directory
// --------------------------------------------------------------------------
export interface Correspondent {
  email: string;
  /** Best display name seen for this address; falls back to the local-part. */
  name: string;
  /** Messages this mailbox sent to them — a much stronger signal than received. */
  sent: number;
  received: number;
  /** ISO timestamp of the most recent message either way; drives recency rank. */
  lastSeen: string;
}

/**
 * Addresses that structurally cannot receive a reply.
 *
 * Deliberately narrow: `support@`, `sales@`, `hello@` and `billing@` are real
 * mailboxes real people answer, and excluding them would break ordinary sales
 * correspondence.
 */
const UNREACHABLE_SUBSTRINGS = [
  "noreply",
  "donotreply",
  "mailerdaemon",
  "autoreply",
  "autoresponder",
];

const UNREACHABLE_EXACT = new Set([
  "postmaster",
  "bounce",
  "bounces",
  "notification",
  "notifications",
  "notify",
  "automated",
  "daemon",
  "unsubscribe",
]);

export function isUnreachable(email: string): boolean {
  const at = email.indexOf("@");
  if (at <= 0) return false;
  // `no-reply`, `no_reply` and `no.reply` are one intent spelled three ways;
  // a `+tag` is dropped so `noreply+123@` still matches.
  const local = email
    .slice(0, at)
    .toLowerCase()
    .split("+")[0]!
    .replace(/[._-]/g, "");
  if (!local) return false;
  if (UNREACHABLE_EXACT.has(local)) return true;
  return UNREACHABLE_SUBSTRINGS.some((marker) => local.includes(marker));
}

/** Everyone this mailbox has actually corresponded with, harvested from headers. */
export async function listCorrespondents(
  userId: string,
  options: { limit?: number } = {},
  transport: GmailTransport = defaultGmailTransport,
): Promise<Correspondent[]> {
  const limit = Math.min(options.limit ?? 500, 2000);
  const self = (await profile(userId, transport)).emailAddress.toLowerCase();

  // Walk `messages.list` pages until we have `limit` ids or Gmail runs out.
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: "in:inbox OR in:sent",
      maxResults: String(Math.min(limit - ids.length, 500)),
    });
    if (pageToken) params.set("pageToken", pageToken);

    const page = await gmailJson<{
      messages?: { id?: string | null }[];
      nextPageToken?: string | null;
    }>(userId, `/messages?${params}`, undefined, transport);

    for (const message of page.messages ?? []) {
      if (message.id) ids.push(message.id);
    }
    pageToken = page.nextPageToken ?? undefined;
  } while (pageToken && ids.length < limit);

  const directory = new Map<string, Correspondent>();

  const record = (
    address: MailAddress,
    direction: "sent" | "received",
    at: number,
  ) => {
    const email = address.email.trim().toLowerCase();
    if (!email || !email.includes("@") || email === self) return;
    // Automated senders are not correspondents.
    if (isUnreachable(email)) return;

    const seen = new Date(at).toISOString();
    const existing = directory.get(email);
    if (!existing) {
      directory.set(email, {
        email,
        name: address.name || email.split("@")[0]!,
        sent: direction === "sent" ? 1 : 0,
        received: direction === "received" ? 1 : 0,
        lastSeen: seen,
      });
      return;
    }

    existing[direction] += 1;
    if (seen > existing.lastSeen) existing.lastSeen = seen;
    // A real display name beats a local-part placeholder, whenever it shows up.
    if (address.name && existing.name === existing.email.split("@")[0]) {
      existing.name = address.name;
    }
  };

  await pooled(ids, LIST_CONCURRENCY, async (id) => {
    const message = await gmailJson<GmailMessage>(
      userId,
      `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Date`,
      undefined,
      transport,
    );
    const headers = message.payload?.headers;
    const at = Number(message.internalDate ?? Date.now());
    // A message in SENT means the mailbox owner wrote to its recipients; the
    // sender of anything else is someone who wrote to them.
    const outgoing = (message.labelIds ?? []).includes("SENT");

    for (const address of parseAddressList(headerValue(headers, "From"))) {
      record(address, outgoing ? "sent" : "received", at);
    }
    for (const field of ["To", "Cc"] as const) {
      for (const address of parseAddressList(headerValue(headers, field))) {
        record(address, outgoing ? "sent" : "received", at);
      }
    }
  });

  return [...directory.values()].sort((a, b) =>
    b.lastSeen.localeCompare(a.lastSeen),
  );
}
