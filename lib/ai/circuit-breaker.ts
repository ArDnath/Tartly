import "server-only";

import { redis } from "@/lib/redis";

/**
 * Per-provider circuit breaker (A6).
 *
 * After `failureThreshold` consecutive failures a provider is "open" for
 * `openMs`; while open, callers skip it and serve their deterministic fallback
 * instead of hammering a dead upstream. State lives in Redis (shared across
 * serverless instances) and the breaker **fails open**: if Redis is unreachable
 * we report "closed" and let the call through.
 */

export const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 5;
export const DEFAULT_CIRCUIT_OPEN_MS = 60_000;

export interface CircuitStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  openMs?: number;
  now?: () => number;
}

export interface CircuitBreaker {
  isOpen(providerId: string): Promise<boolean>;
  recordFailure(providerId: string): Promise<void>;
  recordSuccess(providerId: string): Promise<void>;
  /** Test/ops helper: clear all state for a provider. */
  reset(providerId: string): Promise<void>;
}

function failureKey(providerId: string): string {
  return `ai-circuit:fail:${providerId}`;
}

function openKey(providerId: string): string {
  return `ai-circuit:open:${providerId}`;
}

export function createCircuitBreaker(
  store: CircuitStore,
  options: CircuitBreakerOptions = {},
): CircuitBreaker {
  const failureThreshold =
    options.failureThreshold ?? DEFAULT_CIRCUIT_FAILURE_THRESHOLD;
  const openMs = options.openMs ?? DEFAULT_CIRCUIT_OPEN_MS;
  const now = options.now ?? (() => Date.now());

  return {
    async isOpen(providerId) {
      try {
        const openUntil = await store.get(openKey(providerId));
        if (!openUntil) return false;
        const until = Number.parseInt(openUntil, 10);
        if (!Number.isFinite(until)) return false;
        return now() < until;
      } catch {
        return false;
      }
    },

    async recordFailure(providerId) {
      try {
        if (await this.isOpen(providerId)) return;

        const raw = await store.get(failureKey(providerId));
        const count = Number.parseInt(raw ?? "0", 10) || 0;
        const next = count + 1;

        if (next >= failureThreshold) {
          await store.set(
            openKey(providerId),
            String(now() + openMs),
            Math.max(1, Math.ceil(openMs / 1000)),
          );
          await store.del(failureKey(providerId));
          return;
        }

        // The failure window is twice the open window so a couple of isolated
        // failures don't trip the breaker hours later.
        await store.set(
          failureKey(providerId),
          String(next),
          Math.max(1, Math.ceil((openMs * 2) / 1000)),
        );
      } catch {
        // Fail open — observability must never break the call path.
      }
    },

    async recordSuccess(providerId) {
      try {
        await store.del(failureKey(providerId));
        await store.del(openKey(providerId));
      } catch {
        // Fail open.
      }
    },

    async reset(providerId) {
      await this.recordSuccess(providerId);
    },
  };
}

/** Redis-backed store. Upstash's `set` accepts `ex` via the plain overload. */
const redisCircuitStore: CircuitStore = {
  get: (key) => redis.get<string>(key),
  async set(key, value, ttlSeconds) {
    await redis.set(key, value, { ex: ttlSeconds });
  },
  del: (key) => redis.del(key),
};

/**
 * The process-wide breaker. Thresholds come from env so they can be tuned
 * without a redeploy; both are clamped to sane ranges.
 */
function resolveEnvInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const circuitBreaker = createCircuitBreaker(redisCircuitStore, {
  failureThreshold: resolveEnvInt(
    process.env.AI_CIRCUIT_FAILURE_THRESHOLD,
    DEFAULT_CIRCUIT_FAILURE_THRESHOLD,
  ),
  openMs: resolveEnvInt(
    process.env.AI_CIRCUIT_OPEN_MS,
    DEFAULT_CIRCUIT_OPEN_MS,
  ),
});
