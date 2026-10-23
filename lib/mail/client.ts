import type {
  MailAccount,
  MailAddress,
  MailMessage,
  MailThread,
} from "@/lib/mail/types";

/**
 * The mail feature talks to the signed-in user's real Gmail through the BFF
 * (`/api/v1/mail`), which holds the OAuth token. Nothing is cached here —
 * Gmail is the source of truth. Browser-side fetch wrapper only; the Gmail
 * client itself lives in `lib/mail/service.ts` on the server.
 */

interface ApiEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string };
}

/**
 * A mail API failure that preserves the server's error `code` (and status).
 * The paywall keys off `code === "payment_required"`, so the store must be able
 * to tell a paywall block apart from a generic Gmail failure.
 */
export class MailApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "MailApiError";
  }
}

export function isPaymentRequired(error: unknown): boolean {
  return error instanceof MailApiError && error.code === "payment_required";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const payload = (await response.json().catch(() => null)) as
    | ApiEnvelope<T>
    | null;

  if (!response.ok) {
    throw new MailApiError(
      payload?.error?.code ?? "unknown",
      response.status,
      payload?.error?.message || `Request failed (${response.status})`,
    );
  }

  return payload?.data as T;
}

export interface Mailbox {
  messages: MailMessage[];
  labels: string[];
  account: MailAddress;
  /**
   * Opaque Gmail cursor for the slice after this page. Absent on the last page.
   * The client only ever holds it in memory to fetch the *next* page on demand —
   * nothing is persisted, so the full mailbox never lands in a database.
   */
  nextPageToken?: string;
}

/** A Gmail-side mailbox. The sidebar's views map onto these. */
export type MailboxBox =
  | "inbox"
  | "sent"
  | "drafts"
  | "archive"
  | "trash"
  | "spam"
  | "starred"
  /** Everything except Spam and Trash — what a label view spans. */
  | "active"
  | "all";

export interface MailboxRequest {
  box: MailboxBox;
  /** Extra Gmail search syntax stacked on the box, e.g. `label:"Investors"`. */
  search?: string;
  limit?: number;
  /**
   * Cursor returned by a previous call as `nextPageToken`. Omit for the first
   * page; pass it to fetch the page after the one already loaded.
   */
  pageToken?: string;
  /**
   * Which connected account to read. Defaults to `all` — the shared inbox — so
   * Gmail and Outlook merge into one list. A label search is always Gmail-only
   * on the server.
   */
  account?: "all" | "gmail" | "outlook";
}

/** The list slice of a mailbox fetch — no account/profile round trip. */
export interface MailboxPage {
  messages: MailMessage[];
  labels: string[];
  nextPageToken?: string;
}

/**
 * One cursor slice of one box. The destination identity and cursor both live in
 * `request_`, so a "load more" is just the same call with `pageToken` set.
 */
export async function fetchMailboxPage(
  request_: MailboxRequest = { box: "inbox" },
): Promise<MailboxPage> {
  const params = new URLSearchParams({
    box: request_.box,
    limit: String(request_.limit ?? 60),
    account: request_.account ?? "all",
  });
  if (request_.search) params.set("search", request_.search);
  if (request_.pageToken) params.set("pageToken", request_.pageToken);

  const mailbox = await request<{
    messages: MailMessage[];
    labels: string[];
    nextPageToken?: string;
  }>(`/api/v1/mail/messages?${params}`);

  return {
    messages: mailbox.messages,
    labels: mailbox.labels,
    ...(mailbox.nextPageToken
      ? { nextPageToken: mailbox.nextPageToken }
      : {}),
  };
}

/** One page of one box, plus the signed-in account for the first load. */
export async function fetchMailbox(
  request_: MailboxRequest = { box: "inbox" },
): Promise<Mailbox> {
  const [page, account] = await Promise.all([
    fetchMailboxPage(request_),
    request<{ emailAddress: string }>("/api/v1/mail/profile"),
  ]);

  return {
    messages: page.messages,
    labels: page.labels,
    account: {
      name: account.emailAddress.split("@")[0] ?? "Me",
      email: account.emailAddress,
    },
    ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
  };
}

/**
 * The list is fetched with metadata only, so a row's `body` is empty until the
 * reader opens it. This fills it in.
 */
export function fetchMessageBody(id: string): Promise<MailMessage> {
  return request<MailMessage>(`/api/v1/mail/messages/${encodeURIComponent(id)}`);
}

/**
 * The whole conversation, oldest message first, with full bodies — what the
 * reader shows once a row is opened. Gmail's `threads.get` also returns the
 * messages this mailbox view no longer lists (an archived reply, say), so the
 * reader is always the complete conversation.
 */
export function fetchThread(threadId: string): Promise<MailThread> {
  return request<MailThread>(
    `/api/v1/mail/threads/${encodeURIComponent(threadId)}`,
  );
}

/** Connected mail accounts for the "connected accounts" settings surface. */
export async function fetchMailAccounts(): Promise<MailAccount[]> {
  const result = await request<{ accounts: MailAccount[] }>(
    "/api/v1/settings/accounts",
  );
  return result.accounts;
}

// --------------------------------------------------------------------------
// Mutations — each mirrors one Gmail label operation
// --------------------------------------------------------------------------
export function setRead(ids: string[], read: boolean) {
  return request("/api/v1/mail/messages/read", {
    method: "POST",
    body: JSON.stringify({ ids, read }),
  });
}

export function setStarred(ids: string[], starred: boolean) {
  return request("/api/v1/mail/messages/star", {
    method: "POST",
    body: JSON.stringify({ ids, starred }),
  });
}

export function setArchived(ids: string[], archived: boolean) {
  return request("/api/v1/mail/messages/archive", {
    method: "POST",
    body: JSON.stringify({ ids, archived }),
  });
}

export function setTrashed(ids: string[], trashed: boolean) {
  return request("/api/v1/mail/messages/trash", {
    method: "POST",
    body: JSON.stringify({ ids, trashed }),
  });
}

export function setSpam(ids: string[], spam: boolean) {
  return request("/api/v1/mail/messages/spam", {
    method: "POST",
    body: JSON.stringify({ ids, spam }),
  });
}

/** Permanently delete messages (bypassing the trash). Irreversible. */
export function deleteMessages(ids: string[]) {
  return request<{ updated: number }>("/api/v1/mail/messages/delete", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

/** Permanently delete everything in the trash. Returns how many were removed. */
export function emptyTrash() {
  return request<{ deleted: number }>("/api/v1/mail/trash/empty", {
    method: "POST",
  });
}

export function applyLabel(ids: string[], label: string) {
  return request("/api/v1/mail/messages/label", {
    method: "POST",
    body: JSON.stringify({ ids, label }),
  });
}

export function createLabel(label: string) {
  return request("/api/v1/mail/labels", {
    method: "POST",
    body: JSON.stringify({ label }),
  });
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
  threadId?: string;
  inReplyTo?: string;
  /** Phase 6: library assets to attach / inline. */
  assetIds?: string[];
  inlineImageIds?: string[];
  /** Which connected account to send from; defaults to Gmail. */
  account?: "gmail" | "outlook";
}

export async function sendMail(mail: OutgoingMail): Promise<string> {
  const result = await request<{ id: string | null }>("/api/v1/mail/send", {
    method: "POST",
    body: JSON.stringify(mail),
  });
  return result.id ?? "";
}

export async function saveDraft(mail: OutgoingMail): Promise<string> {
  const result = await request<{ id: string }>("/api/v1/mail/drafts", {
    method: "POST",
    body: JSON.stringify(mail),
  });
  return result.id;
}

// --------------------------------------------------------------------------
// Agent drafting
// --------------------------------------------------------------------------
/**
 * Ask the server to write the body. The composer never sends straight from the
 * model — the result is placed in the textarea for the user to review and edit.
 */
export async function generateMailDraft(input: {
  to: string[];
  subject: string;
  instruction?: string;
}): Promise<string> {
  const result = await request<{ body: string }>("/api/v1/mail/draft", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.body.trim();
}

/**
 * A message worth showing the user. Prefers what the server said, falls back
 * to a generic line, and never surfaces a bare stack trace.
 */
export function errorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

// --------------------------------------------------------------------------
// Smart compose (streaming)
// --------------------------------------------------------------------------
export type ComposeAssistAction =
  | "complete"
  | "rewrite"
  | "shorten"
  | "formal"
  | "casual"
  | "bulletize"
  | "translate"
  | "write";

export interface ComposeAssistRequest {
  action: ComposeAssistAction;
  body: string;
  selection?: string;
  subject?: string;
  to?: string[];
  targetLanguage?: string;
  /** The user's free-form description, for the `write` action. */
  instruction?: string;
}

/**
 * Stream a compose suggestion. `onChunk` receives the growing text so the UI can
 * render tokens as they arrive. Never sends anything — the caller decides what
 * to do with the returned text.
 */
export async function assistCompose(
  input: ComposeAssistRequest,
  {
    onChunk,
    signal,
  }: { onChunk?: (text: string, delta: string) => void; signal?: AbortSignal } = {},
): Promise<string> {
  const response = await fetch("/api/v1/mail/assist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | ApiEnvelope<unknown>
      | null;
    throw new Error(
      payload?.error?.message || `Request failed (${response.status})`,
    );
  }

  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const delta = decoder.decode(value, { stream: true });
    if (!delta) continue;
    text += delta;
    onChunk?.(text, delta);
  }
  return text;
}
