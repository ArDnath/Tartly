import "server-only";

import { createHash } from "node:crypto";

import { and, eq, lt } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/lib/db";
import { aiCache } from "@/lib/db/schema";

/**
 * Content-addressed AI artifact cache (Phase 2).
 *
 * Expensive-ish, deterministic-enough outputs (thread summaries, meeting briefs,
 * sender categories, …) are computed once and served from Postgres on repeat. It
 * is *never* read on a page render to decide whether to spend tokens — callers
 * write after computing and read before; a miss just means "compute it".
 *
 * Every operation is best-effort: a cache failure must never break the feature
 * it is accelerating, so read/write swallow errors and return a miss/no-op.
 */

export const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Stable content hash so the same inputs always map to one key. */
export function contentHash(...parts: Array<string | number | null | undefined>): string {
  return createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("\u0000"))
    .digest("hex")
    .slice(0, 40);
}

export type CacheEntry<T> = { payload: T; createdAt: Date };

/** Read a non-expired entry. Returns null on miss, expiry, or any error. */
export async function getCached<T>({
  userId,
  type,
  key,
}: {
  userId: string;
  type: string;
  key: string;
}): Promise<T | null> {
  try {
    const rows = await db
      .select({
        payload: aiCache.payload,
        expiresAt: aiCache.expiresAt,
      })
      .from(aiCache)
      .where(
        and(
          eq(aiCache.userId, userId),
          eq(aiCache.cacheType, type),
          eq(aiCache.cacheKey, key),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    return row.payload as T;
  } catch (error) {
    console.warn("[ai/cache] read failed", error);
    return null;
  }
}

/** Upsert an entry with a TTL. Best-effort; returns whether it was written. */
export async function setCached<T>({
  userId,
  type,
  key,
  payload,
  ttlMs = DEFAULT_CACHE_TTL_MS,
}: {
  userId: string;
  type: string;
  key: string;
  payload: T;
  ttlMs?: number;
}): Promise<boolean> {
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + Math.max(ttlMs, 1_000));
    await db
      .insert(aiCache)
      .values({
        id: nanoid(),
        userId,
        cacheType: type,
        cacheKey: key,
        payload: payload as Record<string, unknown>,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [aiCache.userId, aiCache.cacheType, aiCache.cacheKey],
        set: { payload: payload as Record<string, unknown>, expiresAt },
      });
    return true;
  } catch (error) {
    console.warn("[ai/cache] write failed", error);
    return false;
  }
}

export async function deleteCached({
  userId,
  type,
  key,
}: {
  userId: string;
  type: string;
  key: string;
}): Promise<boolean> {
  try {
    const deleted = await db
      .delete(aiCache)
      .where(
        and(
          eq(aiCache.userId, userId),
          eq(aiCache.cacheType, type),
          eq(aiCache.cacheKey, key),
        ),
      )
      .returning({ id: aiCache.id });
    return deleted.length > 0;
  } catch (error) {
    console.warn("[ai/cache] delete failed", error);
    return false;
  }
}

/** Housekeeping: drop every expired row. Safe to run from the daily cron. */
export async function purgeExpiredCache(): Promise<number> {
  try {
    const deleted = await db
      .delete(aiCache)
      .where(lt(aiCache.expiresAt, new Date()))
      .returning({ id: aiCache.id });
    return deleted.length;
  } catch (error) {
    console.warn("[ai/cache] purge failed", error);
    return 0;
  }
}
