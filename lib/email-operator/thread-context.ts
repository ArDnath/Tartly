import "server-only";

import { nanoid } from "nanoid";

import {
  contactPersistenceRepository,
  type Contact,
} from "@/lib/repositories/contact-persistence";
import { messageRepository, type Message } from "@/lib/repositories/messages";
import { threadRepository, type Thread } from "@/lib/repositories/threads";

export type ThreadRow = Thread;
export type MessageRow = Message;
export type ContactRow = Contact;

/** Creates/updates a contact keyed on (userId, email). */
export async function upsertContact({
  userId,
  email,
  name,
  source = "gmail",
}: {
  userId: string;
  email: string;
  name?: string | null;
  source?: string;
}): Promise<ContactRow> {
  const normalizedEmail = email.toLowerCase();
  return contactPersistenceRepository.upsert({
    id: nanoid(),
    userId,
    email: normalizedEmail,
    name,
    source,
  });
}

export type ThreadContext = {
  thread: ThreadRow;
  history: MessageRow[];
  /** The most recent inbound message (what we are replying to). */
  latestInbound: MessageRow | null;
  contact: ContactRow | null;
};

/**
 * Loads everything a step needs about a thread: the thread row, a bounded
 * message history, the latest inbound message and the sender's contact record.
 * Returns null when the thread does not belong to the user.
 */
export async function loadThreadContext({
  userId,
  threadId,
  historyLimit = 6,
}: {
  userId: string;
  threadId: string;
  historyLimit?: number;
}): Promise<ThreadContext | null> {
  const thread = await threadRepository.findByIdForUser(userId, threadId);
  if (!thread) return null;

  const history = await messageRepository.listOldestByThread(
    threadId,
    historyLimit,
  );

  const latestInbound =
    [...history].reverse().find((message) => message.direction === "inbound") ??
    null;

  let contact: ContactRow | null = null;
  if (latestInbound?.fromAddr) {
    contact = await upsertContact({
      userId,
      email: latestInbound.fromAddr,
    });
  }

  return { thread, history, latestInbound, contact };
}
