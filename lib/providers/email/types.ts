/**
 * Email provider contract.
 *
 * The AI layer talks to `EmailService`, which talks to an `EmailProvider`. No
 * tool imports a Gmail module. Adding Outlook or IMAP later means implementing
 * this interface and registering the adapter — nothing above it changes.
 *
 * Reads are read-only in Phase 1; the write/side-effect methods arrive in later
 * phases as a separate, explicitly-risky interface extension.
 */

export type EmailProviderKind = "gmail" | "outlook" | "imap";

export interface EmailAddress {
  name: string;
  email: string;
}

export interface EmailAttachmentSummary {
  id?: string;
  name: string;
  /** Human-readable size, e.g. "2.4 MB". */
  size: string;
}

/** Compact projection — this is what search returns to the model. */
export interface EmailSummary {
  id: string;
  threadId: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  subject: string;
  snippet: string;
  /** ISO timestamp. */
  receivedAt: string;
  direction: "inbound" | "outbound";
  unread: boolean;
  starred: boolean;
  labels: string[];
  hasAttachments: boolean;
}

/** A single message with its body. */
export interface EmailDetail extends EmailSummary {
  bodyText: string;
  /** Untrusted sender HTML. Never render with dangerouslySetInnerHTML. */
  bodyHtml?: string;
  /** The RFC 2822 Message-ID this message replies to, when present. */
  inReplyTo?: string;
  attachments: EmailAttachmentSummary[];
}

export interface EmailThread {
  id: string;
  subject: string;
  /** Oldest first. */
  messages: EmailDetail[];
}

export interface SearchMessagesInput {
  /** Always the authenticated user id — resolved server-side. */
  userId: string;
  query?: string;
  /** Provider mailbox view, e.g. "inbox" | "sent" | "archive" | "drafts". */
  box?: string;
  limit?: number;
  pageToken?: string;
}

export interface SearchMessagesResult {
  messages: EmailSummary[];
  nextPageToken?: string;
}

/**
 * One address this mailbox has actually corresponded with, harvested from
 * message headers. This is the seed of the contact directory: it is *observed*
 * correspondence, not a guess. Addresses that cannot receive a reply
 * (automated senders) are excluded upstream.
 */
export interface EmailCorrespondent {
  email: string;
  /** Best display name seen; falls back to the local-part. */
  name: string;
  /** Messages this mailbox sent to them — a stronger signal than received. */
  sent: number;
  received: number;
  /** ISO timestamp of the most recent message either way. */
  lastSeen: string;
}

export interface EmailProvider {
  readonly kind: EmailProviderKind;
  isConnected(userId: string): Promise<boolean>;
  searchMessages(input: SearchMessagesInput): Promise<SearchMessagesResult>;
  getMessage(input: { userId: string; messageId: string }): Promise<EmailDetail>;
  getThread(input: {
    userId: string;
    threadId: string;
  }): Promise<EmailThread>;
  /** Observed correspondents, most recent first. Backs ContactService. */
  listCorrespondents(input: {
    userId: string;
    limit?: number;
  }): Promise<EmailCorrespondent[]>;
}

/* -------------------------------------------------------------------------- */
/*  Write capability (Phase 6)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The write side of the provider, kept deliberately separate from the read
 * interface so a read-only adapter stays simple and a side effect can never be
 * added to `EmailProvider` by accident.
 *
 * These are reversible mailbox mutations and draft operations only. Sending,
 * forwarding and deleting are *not* here: they are external side effects and
 * arrive in a later phase behind server-verified confirmation.
 */

/** The editable fields of a draft, as supplied by a caller (already normalized). */
export interface EmailDraftInput {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  /** Set when the draft is a reply, so the provider threads it correctly. */
  threadId?: string;
  inReplyTo?: string;
}

/**
 * A stored draft.
 *
 * `version` is an opaque provider revision token used for optimistic
 * concurrency: it changes whenever the provider replaces the draft, so a stale
 * `expectedVersion` can be rejected instead of silently overwriting a newer
 * edit. Callers must treat it as opaque.
 */
export interface EmailDraft extends EmailDraftInput {
  id: string;
  version: string;
  /** ISO timestamp of the provider's last revision. */
  updatedAt: string;
}

export interface EmailWriteProvider {
  getDraft(input: { userId: string; draftId: string }): Promise<EmailDraft>;
  listDrafts(input: { userId: string; limit?: number }): Promise<EmailDraft[]>;
  createDraft(input: {
    userId: string;
    draft: EmailDraftInput;
  }): Promise<EmailDraft>;
  updateDraft(input: {
    userId: string;
    draftId: string;
    draft: EmailDraftInput;
  }): Promise<EmailDraft>;
  archiveMessage(input: { userId: string; messageId: string }): Promise<void>;
  /**
   * Move a message to the trash. Reversible (Gmail keeps trashed mail for 30
   * days and `untrash` restores it), so it is the safe default for "delete".
   */
  trashMessage(input: { userId: string; messageId: string }): Promise<void>;
  /** Restore a message from the trash. */
  untrashMessage(input: { userId: string; messageId: string }): Promise<void>;
  /**
   * Permanently delete a message, bypassing the trash. Irreversible, and it
   * needs the provider's broadest scope (Gmail's full-mailbox grant). Only ever
   * reached behind an explicit, confirmed user action.
   */
  deleteMessage(input: { userId: string; messageId: string }): Promise<void>;
  markRead(input: {
    userId: string;
    messageId: string;
    read: boolean;
  }): Promise<void>;
  /**
   * Star or unstar a message. A reversible mailbox mutation (Gmail's STARRED
   * label), so it stays on the safe/no-confirmation side like `markRead`.
   */
  setStarred(input: {
    userId: string;
    messageId: string;
    starred: boolean;
  }): Promise<void>;
  addLabel(input: {
    userId: string;
    messageId: string;
    label: string;
  }): Promise<void>;
  removeLabel(input: {
    userId: string;
    messageId: string;
    label: string;
  }): Promise<void>;
}

/** An adapter that implements both planes. */
export type FullEmailProvider = EmailProvider & EmailWriteProvider;

/** The subset the mailbox mutator tools need. */
export type EmailMailboxProvider = EmailProvider &
  Pick<
    EmailWriteProvider,
    | "archiveMessage"
    | "trashMessage"
    | "untrashMessage"
    | "deleteMessage"
    | "markRead"
    | "setStarred"
    | "addLabel"
    | "removeLabel"
  >;

/** The subset the draft service needs. */
export type EmailDraftProvider = Pick<
  EmailWriteProvider,
  "getDraft" | "listDrafts" | "createDraft" | "updateDraft"
>;
