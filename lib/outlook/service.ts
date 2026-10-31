import "server-only";

import {
  defaultOutlookTransport,
  graphJson,
  graphPath,
  OutlookApiError,
  type OutlookTransport,
} from "@/lib/outlook/client";
import { promoteLazyImages, rewriteInlineImages } from "@/lib/mail/render-email";
import {
  parseAutoSubmitted,
  parseUnsubscribeHeaders,
} from "@/lib/gmail/parse";
import type { MailAddress, MailMessage } from "@/lib/mail/types";
import type { MailDraft, OutgoingMail } from "@/lib/mail/service";

/**
 * Live Microsoft Graph pass-through for the shared mail client.
 *
 * The Outlook analogue of `lib/mail/service.ts`: reads and reversible
 * mutations go straight to Graph so Outlook stays the source of truth. Ids are
 * namespaced by the shared-inbox layer (`lib/mail/unified.ts`), which strips the
 * `outlook:` prefix before calling in here.
 */

const GRAPH_MESSAGE_SELECT = [
  "id",
  "conversationId",
  "subject",
  "bodyPreview",
  "from",
  "toRecipients",
  "ccRecipients",
  "receivedDateTime",
  "isRead",
  "isDraft",
  "flag",
  "hasAttachments",
  "internetMessageId",
  "categories",
  "parentFolderId",
].join(",");

/** One message's body plus the headers the mail client derives state from. */
const GRAPH_MESSAGE_DETAIL_SELECT = `${GRAPH_MESSAGE_SELECT},body,internetMessageHeaders`;

/** Inline parts (Content-ID + metadata) behind the `cid:` refs in the HTML. */
const GRAPH_ATTACHMENTS_EXPAND =
  "attachments($select=id,name,contentType,contentId,isInline,size)";

interface GraphRecipient {
  emailAddress?: { name?: string | null; address?: string | null } | null;
}

interface GraphAttachment {
  id?: string | null;
  name?: string | null;
  contentType?: string | null;
  /** Set on inline images: the `cid:` referenced from the HTML body. */
  contentId?: string | null;
  isInline?: boolean | null;
  size?: number | null;
}

interface GraphHeader {
  name?: string | null;
  value?: string | null;
}

interface GraphMessage {
  id?: string | null;
  conversationId?: string | null;
  subject?: string | null;
  bodyPreview?: string | null;
  body?: { contentType?: string | null; content?: string | null } | null;
  from?: GraphRecipient | null;
  toRecipients?: GraphRecipient[] | null;
  ccRecipients?: GraphRecipient[] | null;
  bccRecipients?: GraphRecipient[] | null;
  receivedDateTime?: string | null;
  lastModifiedDateTime?: string | null;
  changeKey?: string | null;
  isRead?: boolean | null;
  isDraft?: boolean | null;
  flag?: { flagStatus?: string | null } | null;
  hasAttachments?: boolean | null;
  internetMessageId?: string | null;
  internetMessageHeaders?: GraphHeader[] | null;
  parentFolderId?: string | null;
  categories?: string[] | null;
  attachments?: GraphAttachment[] | null;
}

export interface OutlookListOptions {
  box?: string;
  search?: string;
  limit?: number;
  pageToken?: string;
}

export interface OutlookListResult {
  messages: MailMessage[];
  nextPageToken?: string;
}

function toAddress(recipient: GraphRecipient | null | undefined): MailAddress | null {
  const address = recipient?.emailAddress?.address?.trim();
  if (!address) return null;
  const name = recipient?.emailAddress?.name?.trim();
  return { name: name || address.split("@")[0]!, email: address };
}

function toAddressList(recipients: GraphRecipient[] | null | undefined): MailAddress[] {
  return (recipients ?? [])
    .map(toAddress)
    .filter((address): address is MailAddress => Boolean(address));
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

/** Resolve promises `limit` at a time so a large batch cannot flood Graph. */
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

function formatBytes(bytes: number | null | undefined): string {
  const value = bytes ?? 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Which well-known Outlook folder each mail-client box maps to. The reverse map
 * is built from live folder metadata (ids are mailbox-specific), so a message
 * opened from Sent or Trash still gets the right box without guessing.
 */
const BOX_FOLDER: Record<string, string> = {
  inbox: "inbox",
  sent: "sentitems",
  drafts: "drafts",
  archive: "archive",
  trash: "deleteditems",
  spam: "junkemail",
};

const WELL_KNOWN_BOX: Record<string, MailMessage["box"]> = {
  inbox: "inbox",
  sentitems: "sent",
  drafts: "drafts",
  archive: "archive",
  deleteditems: "trash",
  junkemail: "spam",
};

const FOLDER_CACHE_TTL_MS = 5 * 60 * 1000;
const folderCache = new Map<
  string,
  { value: Map<string, MailMessage["box"]>; expiresAt: number }
>();

/** Folder id → box for one mailbox, cached briefly (folders change rarely). */
async function folderBoxMap(
  userId: string,
  transport: OutlookTransport,
): Promise<Map<string, MailMessage["box"]>> {
  const cached = folderCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = new Map<string, MailMessage["box"]>();
  try {
    let path: string | null =
      "/me/mailFolders?$top=100&$select=id,displayName,wellKnownName";
    while (path) {
      const page: {
        value?: Array<{
          id?: string;
          displayName?: string | null;
          wellKnownName?: string | null;
        }>;
        "@odata.nextLink"?: string;
      } = await graphJson(userId, path, undefined, transport);
      for (const folder of page.value ?? []) {
        if (!folder.id) continue;
        const known =
          (folder.wellKnownName &&
            WELL_KNOWN_BOX[folder.wellKnownName.toLowerCase()]) ||
          WELL_KNOWN_BOX[(folder.displayName ?? "").toLowerCase()];
        if (known) value.set(folder.id, known);
      }
      const next: string | undefined = page["@odata.nextLink"];
      path = next ? graphPath(next) : null;
    }
  } catch {
    // Folder metadata is a presentation nicety. Falling back to the caller's
    // box hint is better than failing the message read.
  }

  folderCache.set(userId, {
    value,
    expiresAt: Date.now() + FOLDER_CACHE_TTL_MS,
  });
  return value;
}

function headerMap(headers: GraphHeader[] | null | undefined): GraphHeader[] {
  return (headers ?? []).map((header) => ({
    name: header.name ?? null,
    value: header.value ?? null,
  }));
}

/** Map a Graph message onto the shared `MailMessage` shape. */
function toMailMessage(
  message: GraphMessage,
  options: { box: MailMessage["box"]; accountEmail: string | null },
): MailMessage {
  const from = toAddress(message.from) ?? { name: "Unknown", email: "" };
  const to = toAddressList(message.toRecipients);
  const cc = toAddressList(message.ccRecipients);
  const contentType = message.body?.contentType?.toLowerCase();
  const rawContent = message.body?.content ?? "";
  const inlineHtml = contentType === "html" ? rawContent : "";
  const body =
    contentType === "html" ? stripHtml(rawContent) : rawContent.trim();

  const id = message.id ?? "";

  // Point every `cid:` reference at the same-origin attachment proxy. Ids are
  // namespaced here because `lib/mail/unified.ts` is the only consumer and it
  // strips the prefix before calling Graph.
  let bodyHtml = inlineHtml ? promoteLazyImages(inlineHtml) : "";
  if (bodyHtml) {
    const urls = new Map<string, string>();
    for (const attachment of message.attachments ?? []) {
      const cid = attachment.contentId?.trim().replace(/^<|>$/g, "");
      if (!cid || !attachment.id) continue;
      if (!(attachment.contentType ?? "").startsWith("image/")) continue;
      const params = new URLSearchParams({
        messageId: `outlook:${id}`,
        attachmentId: attachment.id,
        type: attachment.contentType!,
      });
      urls.set(cid, `/api/v1/mail/attachments?${params.toString()}`);
    }
    if (urls.size > 0) bodyHtml = rewriteInlineImages(bodyHtml, urls);
  }
  const subject = message.subject?.trim();
  const receivedAt = message.receivedDateTime
    ? new Date(message.receivedDateTime).toISOString()
    : new Date().toISOString();

  const headers = headerMap(message.internetMessageHeaders);
  const unsubscribe = parseUnsubscribeHeaders(headers);
  const inReplyTo = headers.find(
    (header) => (header.name ?? "").toLowerCase() === "in-reply-to",
  )?.value;

  const attachments = (message.attachments ?? [])
    .filter(
      (attachment) =>
        attachment.id &&
        attachment.name &&
        !attachment.isInline &&
        !attachment.contentId,
    )
    .map((attachment) => ({
      id: attachment.id!,
      name: attachment.name!,
      size: formatBytes(attachment.size),
      ...(attachment.contentType
        ? { mimeType: attachment.contentType }
        : {}),
      ...(typeof attachment.size === "number"
        ? { sizeBytes: attachment.size }
        : {}),
    }));

  return {
    id,
    threadId: message.conversationId ?? id,
    box: message.isDraft ? "drafts" : options.box,
    provider: "outlook",
    ...(options.accountEmail ? { accountEmail: options.accountEmail } : {}),
    from,
    to,
    ...(cc.length ? { cc } : {}),
    subject: subject && subject.length > 0 ? subject : "(no subject)",
    preview: message.bodyPreview ?? "",
    body,
    ...(bodyHtml ? { bodyHtml } : {}),
    receivedAt,
    // Outlook's categories are the closest equivalent of Gmail labels.
    tag: (message.categories ?? []).some((category) =>
      /newsletter|promotion|marketing/i.test(category),
    )
      ? "newsletter"
      : "other",
    labels: message.categories ?? [],
    unread: message.isRead === false,
    starred: message.flag?.flagStatus === "flagged",
    ...(attachments.length || message.hasAttachments
      ? {
          hasAttachments: attachments.length > 0 || message.hasAttachments === true,
          ...(attachments.length ? { attachments } : {}),
        }
      : {}),
    ...(inReplyTo ? { inReplyTo } : {}),
    ...(unsubscribe
      ? {
          unsubscribe: {
            ...(unsubscribe.url ? { url: unsubscribe.url } : {}),
            ...(unsubscribe.mailto ? { mailto: unsubscribe.mailto } : {}),
            oneClick: unsubscribe.oneClick,
            ...(unsubscribe.listId ? { listId: unsubscribe.listId } : {}),
          },
        }
      : {}),
    ...(headers.length
      ? { autoSubmitted: parseAutoSubmitted(headers) }
      : {}),
  };
}

/**
 * Translate the Gmail-style query terms the agent is prompted to use into the
 * KQL dialect Graph's `$search` understands. Terms with no Graph equivalent
 * (Gmail labels) are dropped; free text is kept as-is.
 */
export function toGraphSearchQuery(query: string): string {
  const now = Date.now();
  return query
    .replace(/\bnewer_than:(\d+)d\b/gi, (_match, days: string) =>
      `received>=${new Date(now - Number(days) * 86_400_000)
        .toISOString()
        .slice(0, 10)}`,
    )
    .replace(/\bolder_than:(\d+)d\b/gi, (_match, days: string) =>
      `received<=${new Date(now - Number(days) * 86_400_000)
        .toISOString()
        .slice(0, 10)}`,
    )
    .replace(/\bis:unread\b/gi, "isRead:false")
    .replace(/\bis:read\b/gi, "isRead:true")
    .replace(/\bhas:attachment\b/gi, "hasAttachments:true")
    .replace(/\b(?:in|label):\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A metadata page of Outlook mail, newest first. */
export async function listOutlookMessages(
  userId: string,
  options: OutlookListOptions = {},
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<OutlookListResult> {
  const top = Math.min(options.limit ?? 30, 100);
  let path: string;

  // `label:"Name"` is the mail client's label view. Outlook's equivalent is a
  // category, which Graph filters as a string collection.
  const label = options.search?.match(/\blabel:(?:"([^"]+)"|(\S+))/i);
  const labelName = (label?.[1] ?? label?.[2] ?? "").replace(/'/g, "''");

  if (labelName) {
    path = `/me/messages?$filter=${encodeURIComponent(
      `categories/any(c:c eq '${labelName}')`,
    )}&$top=${top}&$select=${GRAPH_MESSAGE_SELECT}&$expand=${GRAPH_ATTACHMENTS_EXPAND}&$orderby=receivedDateTime desc`;
  } else if (options.search?.trim()) {
    // Graph's `$search` is a free-text query and cannot be combined with
    // `$orderby`; it already returns relevance-ranked matches.
    const query =
      toGraphSearchQuery(options.search.trim()) || options.search.trim();
    path = `/me/messages?$search="${encodeURIComponent(query)}"&$top=${top}&$select=${GRAPH_MESSAGE_SELECT}&$expand=${GRAPH_ATTACHMENTS_EXPAND}`;
  } else if (options.box === "starred") {
    path = `/me/messages?$filter=${encodeURIComponent("flag/flagStatus eq 'flagged'")}&$top=${top}&$select=${GRAPH_MESSAGE_SELECT}&$expand=${GRAPH_ATTACHMENTS_EXPAND}&$orderby=receivedDateTime desc`;
  } else {
    const folder = options.box ? BOX_FOLDER[options.box] : undefined;
    const base = folder
      ? `/me/mailFolders/${folder}/messages`
      : "/me/messages";
    path = `${base}?$top=${top}&$select=${GRAPH_MESSAGE_SELECT}&$expand=${GRAPH_ATTACHMENTS_EXPAND}&$orderby=receivedDateTime desc`;
  }

  if (options.pageToken) {
    path = graphPath(options.pageToken);
  }

  // Search and the cross-folder Starred view can return a message from any
  // folder, so resolve each row's real box rather than labelling everything as
  // Inbox.
  const foldersPromise =
    options.search?.trim() || options.box === "starred" || !options.box
      ? folderBoxMap(userId, transport)
      : Promise.resolve(null);

  const fetchPage = (nextPath: string) =>
    graphJson<{
      value?: GraphMessage[];
      "@odata.nextLink"?: string;
    }>(userId, nextPath, undefined, transport);

  let page: Awaited<ReturnType<typeof fetchPage>>;
  try {
    page = await fetchPage(path);
  } catch (error) {
    // KQL is permissive about some operators but not all. If a Gmail-style
    // term is rejected, fall back to the remaining free text instead of
    // failing the whole tool call.
    if (
      !labelName &&
      options.search?.trim() &&
      error instanceof OutlookApiError &&
      error.status === 400
    ) {
      const freeText = toGraphSearchQuery(options.search)
        .replace(/\b(?:received|sent)[<>=]+[^\s"]+/gi, "")
        .replace(/\b[\w-]+:[^\s"]+/g, "")
        .trim();
      path = freeText
        ? `/me/messages?$search="${encodeURIComponent(freeText)}"&$top=${top}&$select=${GRAPH_MESSAGE_SELECT}`
        : `/me/messages?$top=${top}&$select=${GRAPH_MESSAGE_SELECT}&$orderby=receivedDateTime desc`;
      page = await fetchPage(path);
    } else {
      throw error;
    }
  }

  const folders = await foldersPromise;

  // The list is a saved view over the mailbox; Graph folders map onto the
  // client's boxes 1:1, defaulting to the inbox when no box was requested.
  const box: MailMessage["box"] =
    options.box && options.box in BOX_FOLDER
      ? (options.box as MailMessage["box"])
      : "inbox";

  return {
    messages: (page.value ?? []).map((message) =>
      toMailMessage(message, {
        box:
          (message.parentFolderId &&
            folders?.get(message.parentFolderId)) ||
          box,
        accountEmail: null,
      }),
    ),
    ...(page["@odata.nextLink"]
      ? { nextPageToken: page["@odata.nextLink"] }
      : {}),
  };
}

/** One message with its body — what the reader pane opens. */
export async function getOutlookMessage(
  userId: string,
  id: string,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<MailMessage> {
  const [message, folders] = await Promise.all([
    graphJson<GraphMessage>(
      userId,
      `/me/messages/${encodeURIComponent(id)}?$select=${GRAPH_MESSAGE_DETAIL_SELECT}&$expand=${GRAPH_ATTACHMENTS_EXPAND}`,
      undefined,
      transport,
    ),
    folderBoxMap(userId, transport),
  ]);
  const box =
    (message.parentFolderId && folders.get(message.parentFolderId)) || "inbox";
  return toMailMessage(message, { box, accountEmail: null });
}

/** A whole Outlook conversation, oldest first. */
export async function getOutlookThread(
  userId: string,
  conversationId: string,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<{ id: string; subject: string; messages: MailMessage[] }> {
  const [page, folders] = await Promise.all([
    graphJson<{ value?: GraphMessage[] }>(
      userId,
      `/me/messages?$filter=${encodeURIComponent(
        `conversationId eq '${conversationId.replace(/'/g, "''")}'`,
      )}&$top=50&$select=${GRAPH_MESSAGE_DETAIL_SELECT}&$expand=${GRAPH_ATTACHMENTS_EXPAND}&$orderby=receivedDateTime asc`,
      undefined,
      transport,
    ),
    folderBoxMap(userId, transport),
  ]);

  const messages = (page.value ?? []).map((message) =>
    toMailMessage(message, {
      box:
        (message.parentFolderId && folders.get(message.parentFolderId)) ||
        "inbox",
      accountEmail: null,
    }),
  );

  return {
    id: conversationId,
    subject: messages[0]?.subject ?? "(no subject)",
    messages,
  };
}

/**
 * One attachment's bytes, for the same-origin proxy that renders inline
 * (`cid:`) images. Graph streams the raw file on the `$value` path.
 */
export async function getOutlookAttachment(
  userId: string,
  messageId: string,
  attachmentId: string,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<{ body: Buffer; contentType?: string }> {
  const response = await transport(
    userId,
    `/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`,
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new OutlookApiError(
      response.status,
      `Microsoft Graph ${response.status}: ${detail.slice(0, 300)}`,
    );
  }
  const contentType = response.headers.get("content-type") ?? undefined;
  return {
    body: Buffer.from(await response.arrayBuffer()),
    ...(contentType ? { contentType } : {}),
  };
}

// --------------------------------------------------------------------------
// Mutations — each mirrors one reversible Outlook action
// --------------------------------------------------------------------------

async function patchMessage(
  userId: string,
  id: string,
  body: Record<string, unknown>,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<void> {
  await graphJson<void>(
    userId,
    `/me/messages/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(body) },
    transport,
  );
}

async function moveMessage(
  userId: string,
  id: string,
  destinationId: string,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<void> {
  await graphJson<void>(
    userId,
    `/me/messages/${encodeURIComponent(id)}/move`,
    { method: "POST", body: JSON.stringify({ destinationId }) },
    transport,
  );
}

export function setOutlookRead(
  userId: string,
  ids: string[],
  read: boolean,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<void[]> {
  return Promise.all(
    ids.map((id) => patchMessage(userId, id, { isRead: read }, transport)),
  );
}

export function setOutlookStarred(
  userId: string,
  ids: string[],
  starred: boolean,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<void[]> {
  return Promise.all(
    ids.map((id) =>
      patchMessage(
        userId,
        id,
        { flag: { flagStatus: starred ? "flagged" : "notFlagged" } },
        transport,
      ),
    ),
  );
}

export function setOutlookArchived(
  userId: string,
  ids: string[],
  archived: boolean,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<void[]> {
  return Promise.all(
    ids.map((id) =>
      moveMessage(userId, id, archived ? "archive" : "inbox", transport),
    ),
  );
}

export function setOutlookTrashed(
  userId: string,
  ids: string[],
  trashed: boolean,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<void[]> {
  return Promise.all(
    ids.map((id) =>
      moveMessage(userId, id, trashed ? "deleteditems" : "inbox", transport),
    ),
  );
}

export function setOutlookSpam(
  userId: string,
  ids: string[],
  spam: boolean,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<void[]> {
  return Promise.all(
    ids.map((id) =>
      moveMessage(userId, id, spam ? "junkemail" : "inbox", transport),
    ),
  );
}

/**
 * Add or remove an Outlook category on a message.
 *
 * Categories are the Graph equivalent of Gmail labels. Graph replaces the whole
 * array, so each update reads the current categories first and writes the union
 * (or the difference) rather than clobbering labels added elsewhere.
 */
async function patchCategories(
  userId: string,
  id: string,
  label: string,
  add: boolean,
  transport: OutlookTransport,
): Promise<void> {
  const current = await graphJson<{ categories?: string[] | null }>(
    userId,
    `/me/messages/${encodeURIComponent(id)}?$select=categories`,
    undefined,
    transport,
  );
  const categories = current.categories ?? [];
  const has = categories.some(
    (category) => category.toLowerCase() === label.toLowerCase(),
  );
  if (add === has) return;
  await patchMessage(
    userId,
    id,
    {
      categories: add
        ? [...categories, label]
        : categories.filter(
            (category) => category.toLowerCase() !== label.toLowerCase(),
          ),
    },
    transport,
  );
}

/**
 * The user's Outlook master categories. Categories are the label vocabulary the
 * mail client shows alongside Gmail labels.
 */
const CATEGORY_CACHE_TTL_MS = 60 * 1000;
const categoryCache = new Map<
  string,
  { value: string[]; expiresAt: number }
>();

export async function listOutlookCategories(
  userId: string,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<string[]> {
  const cached = categoryCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const page = await graphJson<{
      value?: Array<{ displayName?: string | null }>;
    }>(
      userId,
      "/me/outlook/masterCategories",
      undefined,
      transport,
    );
    const value = (page.value ?? [])
      .map((category) => category.displayName?.trim())
      .filter((name): name is string => Boolean(name))
      .sort();
    categoryCache.set(userId, {
      value,
      expiresAt: Date.now() + CATEGORY_CACHE_TTL_MS,
    });
    return value;
  } catch {
    // Category metadata is an optional label vocabulary, never a read failure.
    return [];
  }
}

export async function createOutlookCategory(
  userId: string,
  name: string,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<void> {
  await graphJson<unknown>(
    userId,
    "/me/outlook/masterCategories",
    {
      method: "POST",
      body: JSON.stringify({
        displayName: name,
        color: "preset0",
      }),
    },
    transport,
  );
  categoryCache.delete(userId);
}

export async function addOutlookLabel(
  userId: string,
  ids: string[],
  label: string,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<void[]> {
  // A category used on a message is much more useful when it also exists in the
  // mailbox's category list (that is what the label sidebar reads).
  await createOutlookCategory(userId, label, transport).catch(() => undefined);
  return Promise.all(
    ids.map((id) => patchCategories(userId, id, label, true, transport)),
  );
}

export function removeOutlookLabel(
  userId: string,
  ids: string[],
  label: string,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<void[]> {
  return Promise.all(
    ids.map((id) => patchCategories(userId, id, label, false, transport)),
  );
}

/**
 * Permanently delete messages, bypassing the Deleted Items folder. Graph's
 * `permanentDelete` action moves them to the mailbox's purges area, which mail
 * clients cannot reach — the Outlook equivalent of Gmail's permanent delete.
 */
export function deleteOutlookMessages(
  userId: string,
  ids: string[],
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<void[]> {
  return pooled(ids, 8, (id) =>
    graphJson<void>(
      userId,
      `/me/messages/${encodeURIComponent(id)}/permanentDelete`,
      { method: "POST" },
      transport,
    ),
  );
}

/** Every message id in the Deleted Items folder, following `@odata.nextLink`. */
async function listOutlookDeletedIds(
  userId: string,
  transport: OutlookTransport,
): Promise<string[]> {
  const ids: string[] = [];
  let path: string | null =
    "/me/mailFolders/deleteditems/messages?$select=id&$top=100";
  while (path) {
    const page: {
      value?: Array<{ id?: string }>;
      "@odata.nextLink"?: string;
    } = await graphJson(userId, path, undefined, transport);
    for (const message of page.value ?? []) {
      if (message.id) ids.push(message.id);
    }
    const next: string | undefined = page["@odata.nextLink"];
    path = next ? graphPath(next) : null;
  }
  return ids;
}

/** Permanently delete everything in Deleted Items. Returns how many were removed. */
export async function emptyOutlookTrash(
  userId: string,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<number> {
  const ids = await listOutlookDeletedIds(userId, transport);
  await deleteOutlookMessages(userId, ids, transport);
  return ids.length;
}

/** Short-lived profile cache: the address is read on every mailbox load. */
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;
const profileCache = new Map<
  string,
  {
    value: { emailAddress: string; messagesTotal: number };
    expiresAt: number;
  }
>();

/** The signed-in Outlook address; cached briefly by the caller. */
export async function outlookProfile(
  userId: string,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<{ emailAddress: string; messagesTotal: number }> {
  const cached = profileCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const me = await graphJson<{
    mail?: string | null;
    userPrincipalName?: string | null;
  }>(userId, "/me?$select=mail,userPrincipalName", undefined, transport);

  const value = {
    emailAddress: me.mail ?? me.userPrincipalName ?? "",
    messagesTotal: 0,
  };
  profileCache.set(userId, {
    value,
    expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
  });
  return value;
}

// --------------------------------------------------------------------------
// Drafts
// --------------------------------------------------------------------------

/** The fields a Graph draft needs; mirrors Gmail's `MailDraft` shape. */
const GRAPH_DRAFT_SELECT = [
  "id",
  "conversationId",
  "subject",
  "body",
  "toRecipients",
  "ccRecipients",
  "bccRecipients",
  "changeKey",
  "lastModifiedDateTime",
  "isDraft",
  "internetMessageId",
].join(",");

function toDraftVersion(message: GraphMessage & { changeKey?: string | null }) {
  return (
    message.changeKey ??
    `${message.id ?? ""}:${message.lastModifiedDateTime ?? ""}`
  );
}

function toMailDraft(
  message: GraphMessage & {
    changeKey?: string | null;
    lastModifiedDateTime?: string | null;
  },
): MailDraft {
  const to = toAddressList(message.toRecipients).map((address) => address.email);
  const cc = toAddressList(message.ccRecipients).map((address) => address.email);
  const bcc = toAddressList(message.bccRecipients).map(
    (address) => address.email,
  );
  const updatedAt = message.lastModifiedDateTime
    ? new Date(message.lastModifiedDateTime).toISOString()
    : new Date().toISOString();

  return {
    id: message.id ?? "",
    version: toDraftVersion(message),
    updatedAt,
    to,
    cc,
    bcc,
    subject: message.subject ?? "",
    body: message.body?.content ?? "",
    ...(message.conversationId ? { threadId: message.conversationId } : {}),
    ...(message.internetMessageId
      ? { inReplyTo: message.internetMessageId }
      : {}),
  };
}

function toGraphMessageBody(mail: OutgoingMail | OutlookOutgoingMail) {
  return {
    subject: mail.subject,
    body: mail.html
      ? { contentType: "HTML", content: mail.html }
      : { contentType: "Text", content: mail.body },
    toRecipients: toRecipients(mail.to),
    ...(mail.cc?.length ? { ccRecipients: toRecipients(mail.cc) } : {}),
    ...(mail.bcc?.length ? { bccRecipients: toRecipients(mail.bcc) } : {}),
  };
}

/** Graph accepts a single POST for small attachments; larger files use a session. */
const GRAPH_INLINE_ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;

/** Graph's upload-session endpoint accepts at most 4 MB per PUT. */
const GRAPH_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;

type GraphUploadAttachment = {
  filename: string;
  mimeType: string;
  content: Buffer;
  /** Set for inline images, matching the `cid:` used in the HTML body. */
  cid?: string;
};

/**
 * Flatten inline images and regular attachments into one ordered list. Inline
 * images are attached first so their content ids exist before the HTML body is
 * interpreted by the recipient client.
 */
function graphAttachments(
  mail: OutlookOutgoingMail | OutgoingMail,
): GraphUploadAttachment[] {
  return [
    ...(mail.inlineImages ?? []).map((image) => ({
      filename: image.filename,
      mimeType: image.mimeType,
      content: image.content,
      cid: image.cid,
    })),
    ...(mail.attachments ?? []).map((attachment) => ({
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      content: attachment.content,
    })),
  ];
}

function graphFileAttachment(attachment: GraphUploadAttachment) {
  return {
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: attachment.filename,
    contentType: attachment.mimeType,
    contentBytes: attachment.content.toString("base64"),
    ...(attachment.cid
      ? { contentId: attachment.cid, isInline: true }
      : {}),
  };
}

/** Create a draft and attach every file, using an upload session above 3 MB. */
async function createOutlookMessage(
  userId: string,
  mail: OutlookOutgoingMail | OutgoingMail,
  transport: OutlookTransport,
): Promise<string> {
  const created = await graphJson<{ id?: string | null }>(
    userId,
    "/me/messages",
    {
      method: "POST",
      body: JSON.stringify(toGraphMessageBody(mail)),
    },
    transport,
  );
  if (!created.id) throw new OutlookApiError(502, "Graph created no draft id.");

  for (const attachment of graphAttachments(mail)) {
    await addGraphAttachment(userId, created.id, attachment, transport);
  }
  return created.id;
}

async function addGraphAttachment(
  userId: string,
  messageId: string,
  attachment: GraphUploadAttachment,
  transport: OutlookTransport,
): Promise<void> {
  const path = `/me/messages/${encodeURIComponent(messageId)}/attachments`;

  if (attachment.content.length <= GRAPH_INLINE_ATTACHMENT_MAX_BYTES) {
    await graphJson(
      userId,
      path,
      {
        method: "POST",
        body: JSON.stringify(graphFileAttachment(attachment)),
      },
      transport,
    );
    return;
  }

  const session = await graphJson<{ uploadUrl?: string }>(
    userId,
    `${path}/createUploadSession`,
    {
      method: "POST",
      body: JSON.stringify({
        AttachmentItem: {
          attachmentType: "file",
          name: attachment.filename,
          size: attachment.content.length,
          contentType: attachment.mimeType,
          ...(attachment.cid
            ? { isInline: true, contentId: attachment.cid }
            : {}),
        },
      }),
    },
    transport,
  );
  if (!session.uploadUrl) {
    throw new OutlookApiError(502, "Graph created no upload session.");
  }

  const size = attachment.content.length;
  for (let start = 0; start < size; start += GRAPH_UPLOAD_CHUNK_BYTES) {
    const end = Math.min(start + GRAPH_UPLOAD_CHUNK_BYTES, size);
    const response = await transport(userId, session.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Range": `bytes ${start}-${end - 1}/${size}`,
      },
      body: Uint8Array.from(attachment.content.subarray(start, end)),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new OutlookApiError(
        response.status,
        `Graph attachment upload ${response.status}: ${detail.slice(0, 300)}`,
      );
    }
  }
}

export async function getOutlookDraft(
  userId: string,
  draftId: string,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<MailDraft> {
  const message = await graphJson<
    GraphMessage & { changeKey?: string | null; lastModifiedDateTime?: string | null }
  >(
    userId,
    `/me/messages/${encodeURIComponent(draftId)}?$select=${GRAPH_DRAFT_SELECT}`,
    undefined,
    transport,
  );
  return toMailDraft(message);
}

export async function listOutlookDrafts(
  userId: string,
  limit = 10,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<MailDraft[]> {
  const capped = Math.min(Math.max(limit, 1), 25);
  const page = await graphJson<{
    value?: Array<
      GraphMessage & {
        changeKey?: string | null;
        lastModifiedDateTime?: string | null;
      }
    >;
  }>(
    userId,
    `/me/mailFolders/drafts/messages?$top=${capped}&$select=${GRAPH_DRAFT_SELECT}&$orderby=lastModifiedDateTime desc`,
    undefined,
    transport,
  );
  return (page.value ?? []).map(toMailDraft);
}

export async function saveOutlookDraft(
  userId: string,
  mail: OutgoingMail,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<MailDraft> {
  const draftId = await createOutlookMessage(userId, mail, transport);
  return getOutlookDraft(userId, draftId, transport);
}

export async function updateOutlookDraft(
  userId: string,
  draftId: string,
  mail: OutgoingMail,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<MailDraft> {
  await patchMessage(
    userId,
    draftId,
    toGraphMessageBody(mail),
    transport,
  );
  return getOutlookDraft(userId, draftId, transport);
}

// --------------------------------------------------------------------------
// Sending
// --------------------------------------------------------------------------
export interface OutlookOutgoingMail {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  /** HTML alternative; Graph sends it as the message body when present. */
  html?: string;
  /** Regular file attachments. */
  attachments?: Array<{
    filename: string;
    mimeType: string;
    content: Buffer;
  }>;
  /** Images referenced as `cid:` from the HTML body. */
  inlineImages?: Array<{
    cid: string;
    filename: string;
    mimeType: string;
    content: Buffer;
  }>;
}

function toRecipients(addresses: string[] | undefined): GraphRecipient[] {
  return (addresses ?? []).map((address) => ({ emailAddress: { address } }));
}

/**
 * Sends through Graph. Graph has no client-supplied idempotency key; the
 * idempotent wrapper lives in `lib/outlook/send.ts`, which is the path every
 * application caller uses.
 */
export async function sendOutlookMail(
  userId: string,
  mail: OutlookOutgoingMail,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<void> {
  // The simple sendMail action is limited to small inline attachments. Anything
  // larger needs a draft plus an upload session, so all attachment-bearing mail
  // takes the same draft-then-send path.
  if (graphAttachments(mail).length === 0) {
    await graphJson<void>(
      userId,
      "/me/sendMail",
      {
        method: "POST",
        body: JSON.stringify({
          message: toGraphMessageBody(mail),
          saveToSentItems: true,
        }),
      },
      transport,
    );
    return;
  }

  const draftId = await createOutlookMessage(userId, mail, transport);
  await graphJson<void>(
    userId,
    `/me/messages/${encodeURIComponent(draftId)}/send`,
    { method: "POST" },
    transport,
  );
}
