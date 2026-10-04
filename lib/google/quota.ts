import "server-only";

import {
  googleCircuitFailureThreshold,
  googleCircuitOpenMs,
  googleConnectionUnitsPerMin,
  googleMaxConcurrentPerConnection,
  googleMaxRetries,
  googleProjectUnitsPerMin,
  googleQuotaProjectKey,
  googleRetryBaseMs,
  googleRetryMaxMs,
} from "@/lib/env";
import { redis } from "@/lib/redis";

/**
 * Google API quota governance (Gmail + Calendar).
 *
 * Google enforces two independent ceilings on the same OAuth project:
 *   - a **project** ceiling (all connections in the Cloud project), and
 *   - a **per-user** ceiling (one connected Google account).
 *
 * A single busy or misbehaving mailbox can exhaust either and take down every
 * other user, so requests pass through three Redis-backed controls before they
 * reach Google:
 *
 *   1. Token buckets — smooth the request rate per connection and per project.
 *   2. A concurrency semaphore per connection — bound in-flight requests so one
 *      mailbox cannot occupy the whole worker pool.
 *   3. A circuit breaker per connection — after repeated transient failures a
 *      connection is short-circuited instead of burning worker capacity.
 *
 * Everything is **best-effort**: Redis being unreachable fails open (we log and
 * proceed), because the Redis speed layer must never become a second outage.
 * Google's own 429/5xx responses are retried here with full-jitter backoff.
 *
 * This module is transport-agnostic: it runs a caller-supplied `run()` and
 * returns its `Response`, so both the Gmail and Calendar clients share it.
 */

/* -------------------------------------------------------------------------- */
/*  Errors                                                                     */
/* -------------------------------------------------------------------------- */

export type GoogleQuotaScope = "connection" | "project";

/** The local token bucket is empty; the caller should retry after a delay. */
export class GoogleQuotaExceededError extends Error {
  readonly scope: GoogleQuotaScope;
  readonly retryAfterMs: number;

  constructor(scope: GoogleQuotaScope, retryAfterMs: number) {
    super(
      `Google ${scope} quota is exhausted; retry in ~${Math.ceil(
        retryAfterMs / 1000,
      )}s.`,
    );
    this.name = "GoogleQuotaExceededError";
    this.scope = scope;
    this.retryAfterMs = retryAfterMs;
  }
}

/** The connection is short-circuited after repeated transient failures. */
export class GoogleCircuitOpenError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super(
      `Google connection is temporarily unavailable (circuit open); retry in ~${Math.ceil(
        retryAfterMs / 1000,
      )}s.`,
    );
    this.name = "GoogleCircuitOpenError";
    this.retryAfterMs = retryAfterMs;
  }
}

/* -------------------------------------------------------------------------- */
/*  Pure helpers (exported for tests)                                          */
/* -------------------------------------------------------------------------- */

/** Token-bucket refill rate, in units per millisecond. */
export function refillPerMs(capacityPerMin: number): number {
  return capacityPerMin / 60_000;
}

/**
 * Full-jitter exponential backoff. Caps the exponential delay, then picks a
 * random point below it, so a fleet of retrying instances does not synchronise
 * on the same retry instant.
 */
export function fullJitterDelayMs(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.floor(random() * exponential);
}

/** Google reasons that indicate rate limiting rather than an auth failure. */
const RATE_LIMIT_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "RESOURCE_EXHAUSTED",
  "quotaExceeded",
]);

/**
 * Whether a Google response should be retried. 429 and 5xx are transient; a 403
 * is retryable only when its machine-readable reason says the quota was hit
 * (a 403 with a scope/API-disabled reason is permanent).
 */
export function isRetryableGoogleStatus(
  status: number,
  reasons: readonly string[] = [],
): boolean {
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  if (status === 403 && reasons.some((reason) => RATE_LIMIT_REASONS.has(reason))) {
    return true;
  }
  return false;
}

/**
 * Rough Gmail quota-unit cost per method, from Google's documented table. It is
 * intentionally conservative: over-counting costs only throughput, never
 * correctness. Unknown paths default to the common 5-unit read cost.
 */
export function gmailQuotaUnits(path: string, method = "GET"): number {
  const route = path.split("?")[0] ?? path;
  if (route === "/messages/send") return 100;
  if (route === "/messages/batchModify") return 50;
  if (route === "/messages" || route.startsWith("/messages/")) return 5;
  if (route.startsWith("/threads")) return 10;
  if (route === "/drafts") return method === "POST" ? 10 : 5;
  if (route.startsWith("/drafts/")) {
    if (method === "POST") return 10;
    if (method === "PUT" || method === "PATCH") return 15;
    if (method === "DELETE") return 10;
    return 5;
  }
  if (route.startsWith("/labels")) return 1;
  if (route === "/watch" || route === "/profile") return 1;
  if (route.startsWith("/history")) return 2;
  return 5;
}

/**
 * Calendar calls are billed by queries/minute, not units; treat each as one.
 * The arguments mirror {@link gmailQuotaUnits} so both share a call shape.
 */
export function calendarQuotaUnits(path: string, method = "GET"): number {
  void path;
  void method;
  return 1;
}

/* -------------------------------------------------------------------------- */
/*  Redis keys                                                                 */
/* -------------------------------------------------------------------------- */

function bucketKey(scope: GoogleQuotaScope, id: string): string {
  return `gq:${scope}:${id}`;
}

function semaphoreKey(connectionId: string): string {
  return `gq:sem:${connectionId}`;
}

function circuitOpenKey(connectionId: string): string {
  return `gq:circ:open:${connectionId}`;
}

function circuitFailKey(connectionId: string): string {
  return `gq:circ:fail:${connectionId}`;
}

/** Bucket state outlives a couple of refill periods so a quiet key can expire. */
const BUCKET_TTL_MS = 3 * 60 * 1000;
/** Semaphore slot lease: a crashed process must not hold slots forever. */
const SEMAPHORE_TTL_SECONDS = 60;
/** Window in which consecutive failures are counted toward the breaker. */
const CIRCUIT_FAILURE_WINDOW_SECONDS = 60;

/* -------------------------------------------------------------------------- */
/*  Redis primitives                                                           */
/* -------------------------------------------------------------------------- */

const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])
local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then tokens = capacity end
if ts == nil then ts = now end
if now > ts then
  tokens = math.min(capacity, tokens + (now - ts) * refill)
  ts = now
end
local allowed = 0
local wait = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  if refill > 0 then wait = math.ceil((cost - tokens) / refill) else wait = 60000 end
end
redis.call('HMSET', key, 'tokens', tokens, 'ts', ts)
redis.call('PEXPIRE', key, ttl)
return {allowed, wait}
`;

type BucketResult = { allowed: boolean; waitMs: number };

async function takeTokens({
  key,
  capacityPerMin,
  cost,
}: {
  key: string;
  capacityPerMin: number;
  cost: number;
}): Promise<BucketResult> {
  const raw = (await redis.eval(
    TOKEN_BUCKET_LUA,
    [key],
    [
      String(capacityPerMin),
      String(refillPerMs(capacityPerMin)),
      String(Date.now()),
      String(cost),
      String(BUCKET_TTL_MS),
    ],
  )) as [number, number] | null;

  if (!raw) return { allowed: true, waitMs: 0 };
  return { allowed: raw[0] === 1, waitMs: Number(raw[1] ?? 0) };
}

/**
 * Consume one unit from both buckets. Throws when either is empty; the scope
 * on the error tells a caller which ceiling it hit.
 */
export async function consumeGoogleQuota({
  connectionId,
  projectKey = googleQuotaProjectKey(),
  units,
}: {
  connectionId: string;
  projectKey?: string;
  units: number;
}): Promise<void> {
  const connection = await takeTokens({
    key: bucketKey("connection", connectionId),
    capacityPerMin: googleConnectionUnitsPerMin(),
    cost: units,
  });
  if (!connection.allowed) {
    throw new GoogleQuotaExceededError("connection", connection.waitMs);
  }

  const project = await takeTokens({
    key: bucketKey("project", projectKey),
    capacityPerMin: googleProjectUnitsPerMin(),
    cost: units,
  });
  if (!project.allowed) {
    throw new GoogleQuotaExceededError("project", project.waitMs);
  }
}

async function tryAcquireSemaphore(connectionId: string): Promise<boolean> {
  const key = semaphoreKey(connectionId);
  const max = googleMaxConcurrentPerConnection();
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, SEMAPHORE_TTL_SECONDS);
  if (count > max) {
    await redis.decr(key);
    return false;
  }
  return true;
}

async function releaseSemaphore(connectionId: string): Promise<void> {
  try {
    const value = await redis.decr(semaphoreKey(connectionId));
    if (value < 0) await redis.set(semaphoreKey(connectionId), 0);
  } catch {
    // The slot expires via TTL; nothing to do.
  }
}

/** Wait (bounded) for a slot; fail open after the deadline. */
async function acquireSemaphore(connectionId: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  for (;;) {
    if (await tryAcquireSemaphore(connectionId)) return;
    if (Date.now() >= deadline) return; // fail open rather than stall the request
    await sleep(20 + Math.floor(Math.random() * 60));
  }
}

async function circuitIsOpen(connectionId: string): Promise<number> {
  const open = await redis.get<string>(circuitOpenKey(connectionId));
  return open ? googleCircuitOpenMs() : 0;
}

async function recordCircuitFailure(connectionId: string): Promise<void> {
  const failKey = circuitFailKey(connectionId);
  const count = await redis.incr(failKey);
  if (count === 1) await redis.expire(failKey, CIRCUIT_FAILURE_WINDOW_SECONDS);
  if (count >= googleCircuitFailureThreshold()) {
    await redis.set(circuitOpenKey(connectionId), 1, {
      px: googleCircuitOpenMs(),
    });
    await redis.del(failKey);
    console.warn("[google/quota] circuit opened", { connectionId, failures: count });
  }
}

async function recordCircuitSuccess(connectionId: string): Promise<void> {
  await redis.del(circuitFailKey(connectionId));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* -------------------------------------------------------------------------- */
/*  Guard                                                                      */
/* -------------------------------------------------------------------------- */

export type GoogleApi = "gmail" | "calendar";

export type GoogleGuardOptions = {
  api: GoogleApi;
  connectionId: string;
  /** Quota units this call costs (see {@link gmailQuotaUnits}). */
  units: number;
  /** Short, content-free label for logs/metrics. */
  label: string;
  run: () => Promise<Response>;
};

/**
 * Run one Google request under the full guard. Returns the final response
 * (possibly after retries); auth failures (401/403 non-rate-limit) pass through
 * untouched so the caller's reconnect logic still sees them.
 */
export async function runWithGoogleGuard({
  api,
  connectionId,
  units,
  label,
  run,
}: GoogleGuardOptions): Promise<Response> {
  try {
    const openMs = await circuitIsOpen(connectionId);
    if (openMs) throw new GoogleCircuitOpenError(openMs);
  } catch (error) {
    if (error instanceof GoogleCircuitOpenError) throw error;
    // Redis down: skip the breaker.
  }

  await acquireSemaphore(connectionId).catch(() => undefined);

  const maxRetries = googleMaxRetries();
  const baseMs = googleRetryBaseMs();
  const maxMs = googleRetryMaxMs();

  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await consumeGoogleQuota({ connectionId, units });
      } catch (error) {
        if (error instanceof GoogleQuotaExceededError) throw error;
        // Redis down: proceed without the bucket.
      }

      let response: Response | null = null;
      try {
        response = await run();
      } catch (error) {
        if (attempt < maxRetries) {
          await sleep(fullJitterDelayMs(attempt, baseMs, maxMs));
          continue;
        }
        await recordCircuitFailure(connectionId).catch(() => undefined);
        throw error;
      }

      if (isRetryableGoogleStatus(response.status)) {
        if (attempt < maxRetries) {
          await sleep(fullJitterDelayMs(attempt, baseMs, maxMs));
          continue;
        }
        await recordCircuitFailure(connectionId).catch(() => undefined);
        console.warn("[google/quota] retries exhausted", {
          api,
          connectionId,
          label,
          status: response.status,
        });
        return response;
      }

      if (response.ok) {
        await recordCircuitSuccess(connectionId).catch(() => undefined);
      }
      return response;
    }
  } finally {
    await releaseSemaphore(connectionId).catch(() => undefined);
  }
}

/** Test seam: forget local state is Redis-owned, so nothing to reset in-process. */
export const __testing = { takeTokens, acquireSemaphore, releaseSemaphore };
