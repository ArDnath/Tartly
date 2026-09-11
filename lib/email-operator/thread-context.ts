import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/lib/db";
import { contacts, messages, threads } from "@/lib/db/schema";

export type ThreadRow = typeof threads.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type ContactRow = typeof contacts.$inferSelect;

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
  const inserted = await db
    .insert(contacts)
    .values({
      id: nanoid(),
      userId,
      email: normalizedEmail,
      name: name ?? null,
      nameLower: name?.toLowerCase() ?? null,
      source,
    })
    .onConflictDoUpdate({
      target: [contacts.userId, contacts.email],
      set: {
        ...(name ? { name, nameLower: name.toLowerCase() } : {}),
        updatedAt: new Date(),
      },
    })
    .returning();

  return inserted[0];
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
  const threadRows = await db
    .select()
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.userId, userId)))
    .limit(1);

  const thread = threadRows[0];
  if (!thread) return null;

  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(asc(messages.sentAt))
    .limit(historyLimit);

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
