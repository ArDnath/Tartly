import "server-only";

import { and, asc, eq, gt, inArray } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { threads } from "@/lib/db/schema";

/**
 * Read model for the realtime mail-activity feed. The feed only needs a
 * handful of thread columns and a strict `lastMessageAt` cursor, so these are
 * explicit projections rather than full thread rows.
 */

export type ThreadActivityRow = {
  id: string;
  gmailThreadId: string;
  subject: string | null;
  lastMessageAt: Date | null;
  isUnread: boolean;
};

export type ThreadActivityWithUserRow = ThreadActivityRow & { userId: string };

export class ThreadActivityRepository {
  constructor(private readonly database: Database = db) {}

  async listSince(input: {
    userId: string;
    since: Date;
    limit: number;
  }): Promise<ThreadActivityRow[]> {
    return this.database
      .select({
        id: threads.id,
        gmailThreadId: threads.gmailThreadId,
        subject: threads.subject,
        lastMessageAt: threads.lastMessageAt,
        isUnread: threads.isUnread,
      })
      .from(threads)
      .where(
        and(
          eq(threads.userId, input.userId),
          gt(threads.lastMessageAt, input.since),
        ),
      )
      .orderBy(asc(threads.lastMessageAt))
      .limit(input.limit);
  }

  /** Batched form for the shared realtime poller: one query per poll cycle. */
  async listSinceMany(input: {
    userIds: string[];
    since: Date;
    limit: number;
  }): Promise<ThreadActivityWithUserRow[]> {
    return this.database
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
          inArray(threads.userId, input.userIds),
          gt(threads.lastMessageAt, input.since),
        ),
      )
      .orderBy(asc(threads.lastMessageAt))
      .limit(input.limit);
  }
}

export const threadActivityRepository = new ThreadActivityRepository();
