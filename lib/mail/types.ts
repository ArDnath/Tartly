/** Where a message physically lives. A message is in exactly one box. */
export type MailBox =
  | "inbox"
  | "sent"
  | "drafts"
  | "scheduled"
  | "archive"
  | "trash"
  | "spam";

/**
 * A sidebar destination. Most map 1:1 onto a box, but `starred`, `reminders`
 * and `done` are saved views over the same messages — the same split Gmail
 * makes between folders and system labels.
 */
export type MailView =
  | "all"
  | "starred"
  | "reminders"
  | "scheduled"
  | "drafts"
  | "sent"
  | "done"
  | "trash"
  | "spam";

/** Gmail-style category chip shown at the end of a row. */
export type MailTag = "important" | "newsletter" | "calendar" | "other";

/** The active list: either a system view or a user label. */
export type MailFilter =
  | { kind: "view"; value: MailView }
  | { kind: "label"; value: string };

export interface MailAddress {
  name: string;
  email: string;
}

export interface MailAttachment {
  id: string;
  name: string;
  /** Human-readable, e.g. "2.4 MB" — attachments here are never really fetched. */
  size: string;
}

export interface MailMessage {
  id: string;
  /**
   * Gmail's conversation id. Every reply in a conversation shares one
   * `threadId`, which is what lets the list collapse messages into the single
   * row Gmail shows.
   */
  threadId: string;
  box: MailBox;
  from: MailAddress;
  to: MailAddress[];
  cc?: MailAddress[];
  /**
   * The collapsed participant list Gmail prints in the sender column, e.g.
   * "mcuban .. deals, kevin". Falls back to `from.name` when absent.
   */
  senderLine?: string;
  subject: string;
  preview: string;
  /** Plain text. Drives search, the list preview, and reply quoting. */
  body: string;
  /**
   * The sender's own HTML, when the message had an HTML part.
   *
   * Untrusted: it comes from whoever sent the email. Only ever rendered inside
   * the sandboxed frame in `MailHtmlBody`, never with `dangerouslySetInnerHTML`.
   */
  bodyHtml?: string;
  /** ISO timestamp. */
  receivedAt: string;
  tag: MailTag;
  labels: string[];
  unread: boolean;
  starred: boolean;
  /** Set by Snooze — the row leaves the inbox until this passes. */
  reminderAt?: string | null;
  /** Renders the "replied" glyph in the time column. */
  replied?: boolean;
  /** Renders the red "Draft N" marker beside the sender. */
  draftCount?: number;
  attachments?: MailAttachment[];
  /**
   * Bulk-mail unsubscribe headers on the message (Phase 2). Present only when
   * the sender advertised a List-Unsubscribe mechanism; drives the reader's
   * "Unsubscribe" action. Never rendered as raw content.
   */
  unsubscribe?: {
    url?: string;
    mailto?: string;
    oneClick: boolean;
    listId?: string;
  };
}

/** Predicates the filter popover can stack on top of the active view. */
export interface MailQuery {
  search: string;
  unreadOnly: boolean;
  starredOnly: boolean;
  withAttachments: boolean;
  tag: MailTag | null;
}

export const EMPTY_MAIL_QUERY: MailQuery = {
  search: "",
  unreadOnly: false,
  starredOnly: false,
  withAttachments: false,
  tag: null,
};

/** A composed message on its way out of the composer. */
export interface MailDraft {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  /** Phase 6: library assets to attach as files. */
  assetIds?: string[];
  /** Phase 6: library images to render inline. */
  inlineImageIds?: string[];
}

/** A page of the default mailbox, fetched on the server to hydrate the store. */
export interface InitialMailbox {
  messages: MailMessage[];
  labels: string[];
  account: MailAddress;
  /** Cursor for the page after this one, so “load more” works before a refetch. */
  nextPageToken?: string;
}

/**
 * One whole Gmail conversation, oldest message first. This is what the reader
 * opens: the list carries metadata only, so a thread's bodies are fetched the
 * first time it is opened.
 */
export interface MailThread {
  id: string;
  subject: string;
  messages: MailMessage[];
}

/**
 * A conversation collapsed into the one row the list renders, the way Gmail
 * shows threads rather than individual messages. `messages` is every message
 * known for the thread in the current view, newest first.
 */
export interface MailConversation {
  threadId: string;
  subject: string;
  preview: string;
  receivedAt: string;
  /** The conversation is bold if *any* message in it is unread. */
  unread: boolean;
  /** Starred if any message is, since Gmail stars the conversation. */
  starred: boolean;
  hasAttachments: boolean;
  /** Messages known for this thread (newest first). */
  messageCount: number;
  /** Whose people annotate the row, newest first — Gmail's sender column. */
  participants: MailAddress[];
  /** Pre-joined participant names for the row's first column. */
  senderLine: string;
  /** The physical box of the conversation's newest message. */
  box: MailBox;
  tag: MailTag;
  labels: string[];
  replied: boolean;
  draftCount?: number;
  messages: MailMessage[];
}
