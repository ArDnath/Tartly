import "server-only";

import { redis } from "@/lib/redis";

/**
 * Per-subject fixed-window rate limiter backed by Upstash Redis.
 *
 * Why fixed-window: it is a single counter per (scope, subject, window), which
 * keeps the hot path to one Redis round trip and the state tiny. Sliding-window
 * accuracy is not worth a second trip at this scale.
 *
 * It **fails open**: if Redis is unreachable we allow the request and log. A
 * rate limiter must never become the outage that takes the API down with it —
 * the same rule the existing mail-send limiter follows.
 */

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets; only meaningful when blocked. */
  retryAfterSeconds: number;
};

export function resolveLimit(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * Consumes one unit for `subject` in `scope` and reports whether it is allowed.
 * The key is namespaced `ratelimit:<scope>:<subject>:<window>` so operations
 * can see, and flush, one scope without touching the others.
 */
export async function checkRateLimit({
  subject,
  limit,
  windowSeconds = 60,
  scope = "api",
}: {
  subject: string;
  limit: number;
  windowSeconds?: number;
  scope?: string;
}): Promise<RateLimitResult> {
  if (!Number.isFinite(limit) || limit <= 0) {
    return { allowed: true, limit, remaining: 0, retryAfterSeconds: 0 };
  }

  const windowId = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `ratelimit:${scope}:${subject}:${windowId}`;

  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSeconds);
    }

    const allowed = count <= limit;
    const elapsedInWindow = Math.floor(Date.now() / 1000) % windowSeconds;
    return {
      allowed,
      limit,
      remaining: Math.max(limit - count, 0),
      retryAfterSeconds: allowed
        ? 0
        : Math.max(windowSeconds - elapsedInWindow, 1),
    };
  } catch (error) {
    console.warn("[rate-limit] counter unavailable; allowing request", error);
    return { allowed: true, limit, remaining: limit, retryAfterSeconds: 0 };
  }
}
