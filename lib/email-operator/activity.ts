import "server-only";

import { threadActivityRepository } from "@/lib/repositories/thread-activity";

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
  return threadActivityRepository.listSince({
    userId: input.userId,
    since: input.since,
    limit,
  });
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
  return threadActivityRepository.listSinceMany({
    userIds,
    since: input.since,
    limit: total,
  });
}
