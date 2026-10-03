import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { threadStates, threads } from "@/lib/db/schema";

/** Persistence for per-thread `thread_states` (the triage result). */

export type ThreadState = typeof threadStates.$inferSelect;

export type ThreadStateBucket = {
  category: string | null;
  replyStatus: string | null;
  n: number;
};

export class ThreadStateRepository {
  constructor(private readonly database: Database = db) {}

  async findByThreadId(threadId: string): Promise<ThreadState | undefined> {
    const rows = await this.database
      .select()
      .from(threadStates)
      .where(eq(threadStates.threadId, threadId))
      .limit(1);
    return rows[0];
  }

  /** Grouped triage buckets for threads active since `since` (report metrics). */
  async countByCategoryAndReplyStatus(input: {
    userId: string;
    since: Date;
  }): Promise<ThreadStateBucket[]> {
    const rows = await this.database
      .select({
        category: threadStates.category,
        replyStatus: threadStates.replyStatus,
        n: sql<number>`count(*)::int`,
      })
      .from(threadStates)
      .innerJoin(threads, eq(threads.id, threadStates.threadId))
      .where(
        and(
          eq(threads.userId, input.userId),
          gte(threads.lastMessageAt, input.since),
        ),
      )
      .groupBy(threadStates.category, threadStates.replyStatus);
    return rows.map((row) => ({ ...row, n: Number(row.n) }));
  }
}

export const threadStateRepository = new ThreadStateRepository();
