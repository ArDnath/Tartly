import "server-only";

import { and, count, desc, eq, isNull } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { replyMemories } from "@/lib/db/schema";

/**
 * Persistence for `reply_memories` (SKILL §1.1).
 *
 * One method = one atomic storage operation. Extraction, dedupe, ranking and
 * selection stay in `lib/ai/features/reply-memory.ts`.
 */

export type ReplyMemory = typeof replyMemories.$inferSelect;
export type NewReplyMemory = typeof replyMemories.$inferInsert;

export class ReplyMemoryRepository {
  constructor(private readonly database: Database = db) {}

  async insert(values: NewReplyMemory): Promise<void> {
    await this.database.insert(replyMemories).values(values);
  }

  /** Active (non-archived) memories, newest first. */
  async listActive(userId: string, limit: number): Promise<ReplyMemory[]> {
    return this.database
      .select()
      .from(replyMemories)
      .where(
        and(eq(replyMemories.userId, userId), isNull(replyMemories.archivedAt)),
      )
      .orderBy(desc(replyMemories.updatedAt))
      .limit(limit);
  }

  async archive(input: {
    userId: string;
    memoryId: string;
    now: Date;
  }): Promise<boolean> {
    const updated = await this.database
      .update(replyMemories)
      .set({ archivedAt: input.now })
      .where(
        and(
          eq(replyMemories.id, input.memoryId),
          eq(replyMemories.userId, input.userId),
        ),
      )
      .returning({ id: replyMemories.id });
    return updated.length > 0;
  }

  async countActive(userId: string): Promise<number> {
    const rows = await this.database
      .select({ value: count() })
      .from(replyMemories)
      .where(
        and(eq(replyMemories.userId, userId), isNull(replyMemories.archivedAt)),
      );
    return Number(rows[0]?.value ?? 0);
  }
}

export const replyMemoryRepository = new ReplyMemoryRepository();
