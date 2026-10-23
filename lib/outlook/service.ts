import "server-only";

import {
  defaultOutlookTransport,
  graphJson,
  graphPath,
  OutlookApiError,
  type OutlookTransport,
} from "@/lib/outlook/client";
import { promoteLazyImages, rewriteInlineImages } from "@/lib/mail/render-email";
import type { MailAddress, MailMessage } from "@/lib/mail/types";

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
].join(",");

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

interface GraphMessage {
  id?: string | null;
  conversationId?: string | null;
  subject?: string | null;
  bodyPreview?: string | null;
  body?: { contentType?: string | null; content?: string | null } | null;
  from?: GraphRecipient | null;
  toRecipients?: GraphRecipient[] | null;
  ccRecipients?: GraphRecipient[] | null;
  receivedDateTime?: string | null;
  isRead?: boolean | null;
  isDraft?: boolean | null;
  flag?: { flagStatus?: string | null } | null;
  hasAttachments?: boolean | null;
  internetMessageId?: string | null;
  attachments?: GraphAttachment[] | null;
}

/** Graph's mailbox folders, keyed by the boxes the mail client uses. */
const BOX_FOLDER: Record<string, string> = {
  inbox: "inbox",
  sent: "sentitems",
  drafts: "drafts",
  archive: "archive",
  trash: "deleteditems",
  spam: "junkemail",
};

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
    tag: "other",
    labels: [],
    unread: message.isRead === false,
    starred: message.flag?.flagStatus === "flagged",
    ...(message.internetMessageId
      ? { inReplyTo: message.internetMessageId }
      : {}),
  };
}

/** A metadata page of Outlook mail, newest first. */
export async function listOutlookMessages(
  userId: string,
  options: OutlookListOptions = {},
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<OutlookListResult> {
  const top = Math.min(options.limit ?? 30, 100);
  let path: string;

  if (options.search?.trim()) {
    // Graph's `$search` is a free-text query and cannot be combined with
    // `$orderby`; it already returns relevance-ranked matches.
    path = `/me/messages?$search="${encodeURIComponent(options.search.trim())}"&$top=${top}&$select=${GRAPH_MESSAGE_SELECT}`;
  } else if (options.box === "starred") {
    path = `/me/messages?$filter=${encodeURIComponent("flag/flagStatus eq 'flagged'")}&$top=${top}&$select=${GRAPH_MESSAGE_SELECT}&$orderby=receivedDateTime desc`;
  } else {
    const folder = options.box ? BOX_FOLDER[options.box] : undefined;
    const base = folder
      ? `/me/mailFolders/${folder}/messages`
      : "/me/messages";
    path = `${base}?$top=${top}&$select=${GRAPH_MESSAGE_SELECT}&$orderby=receivedDateTime desc`;
  }

  if (options.pageToken) {
    path = graphPath(options.pageToken);
  }

  const page = await graphJson<{
    value?: GraphMessage[];
    "@odata.nextLink"?: string;
  }>(userId, path, undefined, transport);

  // The list is a saved view over the mailbox; Graph folders map onto the
  // client's boxes 1:1, defaulting to the inbox when no box was requested.
  const box: MailMessage["box"] =
    options.box && options.box in BOX_FOLDER
      ? (options.box as MailMessage["box"])
      : "inbox";

  return {
    messages: (page.value ?? []).map((message) =>
      toMailMessage(message, { box, accountEmail: null }),
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
  const message = await graphJson<GraphMessage>(
    userId,
    `/me/messages/${encodeURIComponent(id)}?$select=${GRAPH_MESSAGE_SELECT},body&$expand=${GRAPH_ATTACHMENTS_EXPAND}`,
    undefined,
    transport,
  );
  return toMailMessage(message, { box: "inbox", accountEmail: null });
}

/** A whole Outlook conversation, oldest first. */
export async function getOutlookThread(
  userId: string,
  conversationId: string,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<{ id: string; subject: string; messages: MailMessage[] }> {
  const page = await graphJson<{ value?: GraphMessage[] }>(
    userId,
    `/me/messages?$filter=${encodeURIComponent(
      `conversationId eq '${conversationId.replace(/'/g, "''")}'`,
    )}&$top=50&$select=${GRAPH_MESSAGE_SELECT},body&$expand=${GRAPH_ATTACHMENTS_EXPAND}&$orderby=receivedDateTime asc`,
    undefined,
    transport,
  );

  const messages = (page.value ?? []).map((message) =>
    toMailMessage(message, { box: "inbox", accountEmail: null }),
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
 * Permanently delete messages, bypassing the Deleted Items folder. Graph's
 * `permanentDelete` action moves them to the mailbox's purges area, which mail
 * clients cannot reach — the Outlook equivalent of Gmail's permanent delete.
 */
export function deleteOutlookMessages(
  userId: string,
  ids: string[],
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<void[]> {
  return Promise.all(
    ids.map((id) =>
      graphJson<void>(
        userId,
        `/me/messages/${encodeURIComponent(id)}/permanentDelete`,
        { method: "POST" },
        transport,
      ),
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

/** The signed-in Outlook address; cached briefly by the caller. */
export async function outlookProfile(
  userId: string,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<{ emailAddress: string; messagesTotal: number }> {
  const me = await graphJson<{
    mail?: string | null;
    userPrincipalName?: string | null;
  }>(userId, "/me?$select=mail,userPrincipalName", undefined, transport);

  return {
    emailAddress: me.mail ?? me.userPrincipalName ?? "",
    messagesTotal: 0,
  };
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
}

function toRecipients(addresses: string[] | undefined): GraphRecipient[] {
  return (addresses ?? []).map((address) => ({ emailAddress: { address } }));
}

/**
 * Sends through Graph. Graph has no client-supplied idempotency key, so the
 * caller must not retry blindly; the shared inbox only sends on explicit user
 * action and the compose path is Gmail's by default.
 */
export async function sendOutlookMail(
  userId: string,
  mail: OutlookOutgoingMail,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<void> {
  await graphJson<void>(
    userId,
    "/me/sendMail",
    {
      method: "POST",
      body: JSON.stringify({
        message: {
          subject: mail.subject,
          body: { contentType: "Text", content: mail.body },
          toRecipients: toRecipients(mail.to),
          ...(mail.cc?.length ? { ccRecipients: toRecipients(mail.cc) } : {}),
          ...(mail.bcc?.length ? { bccRecipients: toRecipients(mail.bcc) } : {}),
        },
        saveToSentItems: true,
      }),
    },
    transport,
  );
}
