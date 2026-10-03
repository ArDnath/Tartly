import "server-only";

import { and, eq, gt } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { researchCache } from "@/lib/db/schema";

/**
 * Persistence for the per-user `research_cache`. Postgres-first, keyed on
 * `(user_id, cache_key)` with a TTL check at read time.
 */

export type ResearchCache = typeof researchCache.$inferSelect;
export type NewResearchCache = typeof researchCache.$inferInsert;

export class ResearchCacheRepository {
  constructor(private readonly database: Database = db) {}

  async findResult(input: {
    userId: string;
    cacheKey: string;
    now: Date;
  }): Promise<Record<string, unknown> | null> {
    const rows = await this.database
      .select({ result: researchCache.result })
      .from(researchCache)
      .where(
        and(
          eq(researchCache.userId, input.userId),
          eq(researchCache.cacheKey, input.cacheKey),
          gt(researchCache.expiresAt, input.now),
        ),
      )
      .limit(1);
    return rows[0]?.result ?? null;
  }

  async upsert(values: NewResearchCache): Promise<void> {
    await this.database
      .insert(researchCache)
      .values(values)
      .onConflictDoUpdate({
        target: [researchCache.userId, researchCache.cacheKey],
        set: {
          provider: values.provider,
          query: values.query,
          result: values.result,
          expiresAt: values.expiresAt,
        },
      });
  }
}

export const researchCacheRepository = new ResearchCacheRepository();
