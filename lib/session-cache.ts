import "server-only";

import { redis } from "@/lib/redis";

/**
 * Short-lived "this user actually exists" memo (Phase B).
 *
 * `getSession` confirms the session's user still exists so a stale JWE cookie
 * cache or Redis session cannot authenticate a deleted user. That check is one
 * Postgres `SELECT` per authenticated request; caching the positive result in
 * Redis collapses it to one lookup per user per TTL. Only existence is cached
 * (never absence), so a recreated user is never locked out. The TTL bounds how
 * long a user deleted out-of-band stays authenticated; an in-app delete calls
 * `invalidateSessionUserCache` for immediate revocation.
 *
 * Best-effort: a Redis failure returns `false`, which simply falls back to the
 * database probe.
 */

export const SESSION_USER_CACHE_TTL_SECONDS = 60;

function sessionUserKey(userId: string): string {
  return `session:user-exists:${userId}`;
}

/** Whether the positive existence probe is already cached. */
export async function isSessionUserCached(userId: string): Promise<boolean> {
  try {
    const value = await redis.get<string>(sessionUserKey(userId));
    return value === "1";
  } catch {
    return false;
  }
}

export async function cacheSessionUser(userId: string): Promise<void> {
  try {
    await redis.set(sessionUserKey(userId), "1", {
      ex: SESSION_USER_CACHE_TTL_SECONDS,
    });
  } catch {
    // Non-fatal: the database remains the source of truth.
  }
}

export async function invalidateSessionUserCache(userId: string): Promise<void> {
  try {
    await redis.del(sessionUserKey(userId));
  } catch {
    // Non-fatal.
  }
}
