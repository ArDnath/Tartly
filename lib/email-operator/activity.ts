import "server-only";

import { and, asc, eq, gt, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { threads } from "@/lib/db/schema";

/**
 * Mirror activity feed for the realtime mail notification.
 *
 * The mail client reads live Gmail, but the *only* signal that new mail
 * arrived is the background sync (Pub/Sub → mirror). This gives the realtime
 * route a cursor over mirrored threads: when `lastMessageAt` advances, the
 * client is told to refresh the live mailbox. It never blocks on sync — an
 * empty or lagging mirror simply produces no event.
 */

export interface ThreadActivity {
  id: string;
  gmailThreadId: string;
  subject: string | null;
  lastMessageAt: Date | null;
  isUnread: boolean;
}

export const MAX_ACTIVITY_BATCH = 50;

export async function listThreadActivitySince(input: {
  userId: string;
  since: Date;
  limit?: number;
}): Promise<ThreadActivity[]> {
  const limit = Math.min(Math.max(input.limit ?? MAX_ACTIVITY_BATCH, 1), 200);
  return db
    .select({
      id: threads.id,
      gmailThreadId: threads.gmailThreadId,
      subject: threads.subject,
      lastMessageAt: threads.lastMessageAt,
      isUnread: threads.isUnread,
    })
    .from(threads)
    .where(
      and(eq(threads.userId, input.userId), gt(threads.lastMessageAt, input.since)),
    )
    .orderBy(asc(threads.lastMessageAt))
    .limit(limit);
}

export type ThreadActivityWithUser = ThreadActivity & { userId: string };

/**
 * Batched form of {@link listThreadActivitySince} for the shared realtime
 * poller: one query for every connected user. The global limit is a safety cap.
 */
export async function listThreadActivitySinceMany(input: {
  userIds: string[];
  since: Date;
  limitPerUser?: number;
}): Promise<ThreadActivityWithUser[]> {
  const userIds = [...new Set(input.userIds.filter(Boolean))];
  if (userIds.length === 0) return [];
  const perUser = Math.min(
    Math.max(input.limitPerUser ?? MAX_ACTIVITY_BATCH, 1),
    200,
  );
  const total = Math.min(perUser * userIds.length, 1000);
  return db
    .select({
      id: threads.id,
      userId: threads.userId,
      gmailThreadId: threads.gmailThreadId,
      subject: threads.subject,
      lastMessageAt: threads.lastMessageAt,
      isUnread: threads.isUnread,
    })
    .from(threads)
    .where(
      and(
        inArray(threads.userId, userIds),
        gt(threads.lastMessageAt, input.since),
      ),
    )
    .orderBy(asc(threads.lastMessageAt))
    .limit(total);
}
