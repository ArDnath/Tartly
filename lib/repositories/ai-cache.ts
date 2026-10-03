import "server-only";

import { and, eq, lt } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { aiCache } from "@/lib/db/schema";

/**
 * Persistence for the content-addressed `ai_cache` table (SKILL §1.1).
 *
 * One method = one atomic storage operation. TTL policy and best-effort error
 * swallowing stay in `lib/ai/cache.ts`; this repository only speaks SQL.
 */

export type AiCacheEntry = { payload: unknown; expiresAt: Date };
export type NewAiCacheEntry = typeof aiCache.$inferInsert;

export class AiCacheRepository {
  constructor(private readonly database: Database = db) {}

  async findEntry(input: {
    userId: string;
    type: string;
    key: string;
  }): Promise<AiCacheEntry | undefined> {
    const rows = await this.database
      .select({ payload: aiCache.payload, expiresAt: aiCache.expiresAt })
      .from(aiCache)
      .where(
        and(
          eq(aiCache.userId, input.userId),
          eq(aiCache.cacheType, input.type),
          eq(aiCache.cacheKey, input.key),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async upsert(values: NewAiCacheEntry): Promise<void> {
    await this.database
      .insert(aiCache)
      .values(values)
      .onConflictDoUpdate({
        target: [aiCache.userId, aiCache.cacheType, aiCache.cacheKey],
        set: { payload: values.payload, expiresAt: values.expiresAt },
      });
  }

  async deleteEntry(input: {
    userId: string;
    type: string;
    key: string;
  }): Promise<boolean> {
    const deleted = await this.database
      .delete(aiCache)
      .where(
        and(
          eq(aiCache.userId, input.userId),
          eq(aiCache.cacheType, input.type),
          eq(aiCache.cacheKey, input.key),
        ),
      )
      .returning({ id: aiCache.id });
    return deleted.length > 0;
  }

  async deleteExpired(now: Date): Promise<number> {
    const deleted = await this.database
      .delete(aiCache)
      .where(lt(aiCache.expiresAt, now))
      .returning({ id: aiCache.id });
    return deleted.length;
  }
}

export const aiCacheRepository = new AiCacheRepository();
