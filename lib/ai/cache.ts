import "server-only";

import { createHash } from "node:crypto";

import { nanoid } from "nanoid";

import { aiCacheRepository } from "@/lib/repositories/ai-cache";
import { redis } from "@/lib/redis";

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
    const row = await aiCacheRepository.findEntry({ userId, type, key });
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
    await aiCacheRepository.upsert({
      id: nanoid(),
      userId,
      cacheType: type,
      cacheKey: key,
      payload: payload as Record<string, unknown>,
      expiresAt,
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
    return await aiCacheRepository.deleteEntry({ userId, type, key });
  } catch (error) {
    console.warn("[ai/cache] delete failed", error);
    return false;
  }
}

/** Housekeeping: drop every expired row. Safe to run from the daily cron. */
export async function purgeExpiredCache(): Promise<number> {
  try {
    return await aiCacheRepository.deleteExpired(new Date());
  } catch (error) {
    console.warn("[ai/cache] purge failed", error);
    return 0;
  }
}

/* -------------------------------------------------------------------------- */
/*  Single-flight / stampede guard                                            */
/* -------------------------------------------------------------------------- */

/**
 * In-process dedupe of identical in-flight computes. When a popular key expires
 * and many requests miss at once, they all await the same promise instead of
 * fanning out N identical model calls.
 */
const flights = new Map<string, Promise<unknown>>();

/** How long a cross-instance compute lock may be held before it self-expires. */
const STAMPEDE_LOCK_TTL_MS = 30_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function acquireStampedeLock(lockKey: string): Promise<boolean> {
  try {
    const result = await redis.set(lockKey, "1", {
      nx: true,
      px: STAMPEDE_LOCK_TTL_MS,
    });
    return result === "OK";
  } catch {
    // Redis unavailable: don't claim a lock, but do compute (local single-flight
    // still dedupes within this instance).
    return false;
  }
}

async function releaseStampedeLock(lockKey: string): Promise<void> {
  try {
    await redis.del(lockKey);
  } catch {
    // Self-expires via the lock TTL.
  }
}

/**
 * Run `compute` at most once for `key` at a time.
 *
 * Local callers share one promise. Cross-instance callers contend on a
 * best-effort Redis lock; the loser waits briefly so the winner can populate
 * the cache, then runs `compute` anyway if the recheck still misses. `compute`
 * is expected to re-read the cache first (so the wait pays off) and to write the
 * result. A cache failure therefore degrades to duplicate work, never a hang.
 */
export async function singleFlight<T>(
  key: string,
  compute: () => Promise<T>,
): Promise<T> {
  const existing = flights.get(key);
  if (existing) return existing as Promise<T>;

  const flight = (async () => {
    const lockKey = `aicache:lock:${key}`;
    const locked = await acquireStampedeLock(lockKey);
    if (!locked) {
      await sleep(150 + Math.floor(Math.random() * 250));
    }
    try {
      return await compute();
    } finally {
      if (locked) await releaseStampedeLock(lockKey);
    }
  })();

  flights.set(key, flight);
  try {
    return await flight;
  } finally {
    flights.delete(key);
  }
}
