/**
 * Conversation grouping for the mail list.
 *
 * Gmail shows one row per conversation, not per message. The list is fetched as
 * individual messages (metadata only), so this module folds whatever messages
 * are loaded into the conversation summaries the rows render. The reader then
 * opens the whole thread from Gmail to get bodies and any messages that the
 * current view did not carry.
 */
import type {
  MailAddress,
  MailConversation,
  MailMessage,
} from "@/lib/mail/types";

/** How many names Gmail prints before it elides the rest with a count. */
const MAX_PARTICIPANTS = 4;

/**
 * `Re: Re: Fwd: Subject` and its friends collapse to the subject a person
 * actually wrote. A thread's subject is the base subject of its messages, so
 * the reply prefixes Gmail hides in the reader don't leak into the list.
 */
const SUBJECT_PREFIX = /^\s*(?:(?:re|fwd|fw|aw|sv)\s*:\s*)+/i;

export function normalizeSubject(subject: string): string {
  const stripped = (subject ?? "").replace(SUBJECT_PREFIX, "").trim();
  return stripped || (subject ?? "").trim() || "(no subject)";
}

/** The conversation a message belongs to. Falls back to the message id when a
 * wire object predates Gmail's `threadId` or arrives without one. */
export function conversationKey(message: MailMessage): string {
  return message.threadId || message.id;
}

const byNewest = (a: MailMessage, b: MailMessage) =>
  new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();

/** Newest inbound/outbound message that hasn't been sent by this mailbox. */
export function lastInbound(conversation: MailConversation): MailMessage | null {
  return (
    conversation.messages.find((message) => message.box !== "sent") ??
    conversation.messages[0] ??
    null
  );
}

function participantLine(participants: MailAddress[]): string {
  if (participants.length === 0) return "";
  const names = participants
    .slice(0, MAX_PARTICIPANTS)
    .map((participant) => participant.name || participant.email);
  const elided = participants.length - names.length;
  return elided > 0 ? `${names.join(", ")} +${elided}` : names.join(", ");
}

/**
 * Fold messages into conversation summaries, newest conversation first.
 *
 * `selfEmail` lets the newest "me" be shown as the mailbox owner rather than
 * their raw address, matching Gmail's "me" label. It is optional so callers
 * that only need counts (the sidebar) can skip it.
 */
export function groupConversations(
  messages: MailMessage[],
  options: { selfEmail?: string | null } = {},
): MailConversation[] {
  const self = options.selfEmail?.trim().toLowerCase();
  const groups = new Map<string, MailMessage[]>();

  for (const message of [...messages].sort(byNewest)) {
    const key = conversationKey(message);
    const bucket = groups.get(key);
    if (bucket) bucket.push(message);
    else groups.set(key, [message]);
  }

  const conversations: MailConversation[] = [];
  for (const [threadId, threadMessages] of groups) {
    const latest = threadMessages[0]!;

    // Participants in the order they appear in the thread, newest first,
    // de-duplicated by address so a five-turn thread only names each person once.
    const seen = new Set<string>();
    const participants: MailAddress[] = [];
    for (const message of threadMessages) {
      const email = message.from.email.trim();
      const normalized = email.toLowerCase();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      participants.push({
        name:
          self && normalized === self
            ? "me"
            : message.from.name || email.split("@")[0] || email,
        email,
      });
    }

    conversations.push({
      threadId,
      subject: normalizeSubject(latest.subject),
      preview: latest.preview,
      receivedAt: latest.receivedAt,
      unread: threadMessages.some((message) => message.unread),
      starred: threadMessages.some((message) => message.starred),
      hasAttachments: threadMessages.some(
        (message) => (message.attachments?.length ?? 0) > 0,
      ),
      messageCount: threadMessages.length,
      participants,
      senderLine: participantLine(participants) || latest.from.name,
      box: latest.box,
      tag: latest.tag,
      labels: [...new Set(threadMessages.flatMap((message) => message.labels))],
      replied: threadMessages.some((message) => message.replied),
      ...(latest.draftCount ? { draftCount: latest.draftCount } : {}),
      messages: threadMessages,
    });
  }

  return conversations;
}

/** Every message id in a conversation — what a batch action operates on. */
export function conversationMessageIds(
  conversation: MailConversation,
): string[] {
  return conversation.messages.map((message) => message.id);
}
