import "server-only";

import { and, desc, eq, notInArray } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { digestItems, digests } from "@/lib/db/schema";

/**
 * Persistence for the inbox digest (`digests` / `digest_items`) (SKILL §1.1).
 *
 * One method = one atomic storage operation. Period math, grouping and the
 * narrative stay in `lib/ai/features/digest.ts`; retention orchestration (keep
 * the newest N) stays there too and composes the two methods below.
 */

export type Digest = typeof digests.$inferSelect;
export type NewDigest = typeof digests.$inferInsert;
export type DigestItem = typeof digestItems.$inferSelect;
export type NewDigestItem = typeof digestItems.$inferInsert;

export class DigestRepository {
  constructor(private readonly database: Database = db) {}

  async insertDigest(values: NewDigest): Promise<void> {
    await this.database.insert(digests).values(values);
  }

  async insertItems(values: NewDigestItem[]): Promise<void> {
    if (values.length === 0) return;
    await this.database.insert(digestItems).values(values);
  }

  /** The ids of a user's newest digests, newest first (retention window). */
  async listRecentIds(userId: string, limit: number): Promise<string[]> {
    const rows = await this.database
      .select({ id: digests.id })
      .from(digests)
      .where(eq(digests.userId, userId))
      .orderBy(desc(digests.generatedAt))
      .limit(limit);
    return rows.map((row) => row.id);
  }

  async deleteAllExcept(userId: string, keepIds: string[]): Promise<void> {
    await this.database
      .delete(digests)
      .where(and(eq(digests.userId, userId), notInArray(digests.id, keepIds)));
  }

  async findLatest(userId: string): Promise<Digest | undefined> {
    const rows = await this.database
      .select()
      .from(digests)
      .where(eq(digests.userId, userId))
      .orderBy(desc(digests.generatedAt))
      .limit(1);
    return rows[0];
  }

  async listItems(digestId: string): Promise<DigestItem[]> {
    return this.database
      .select()
      .from(digestItems)
      .where(eq(digestItems.digestId, digestId))
      .orderBy(desc(digestItems.priority));
  }
}

export const digestRepository = new DigestRepository();
