import type { MailAddress, MailMessage } from "@/lib/mail/types";

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
    throw new Error(
      payload?.error?.message || `Request failed (${response.status})`,
    );
  }

  return payload?.data as T;
}

export interface Mailbox {
  messages: MailMessage[];
  labels: string[];
  account: MailAddress;
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
}

/** One page of one box. Each destination asks Gmail for itself. */
export async function fetchMailbox(
  request_: MailboxRequest = { box: "inbox" },
): Promise<Mailbox> {
  const params = new URLSearchParams({
    box: request_.box,
    limit: String(request_.limit ?? 60),
  });
  if (request_.search) params.set("search", request_.search);

  const [mailbox, account] = await Promise.all([
    request<{
      messages: MailMessage[];
      labels: string[];
      nextPageToken?: string;
    }>(`/api/v1/mail/messages?${params}`),
    request<{ emailAddress: string }>("/api/v1/mail/profile"),
  ]);

  return {
    messages: mailbox.messages,
    labels: mailbox.labels,
    account: {
      name: account.emailAddress.split("@")[0] ?? "Me",
      email: account.emailAddress,
    },
  };
}

/**
 * The list is fetched with metadata only, so a row's `body` is empty until the
 * reader opens it. This fills it in.
 */
export function fetchMessageBody(id: string): Promise<MailMessage> {
  return request<MailMessage>(`/api/v1/mail/messages/${encodeURIComponent(id)}`);
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
