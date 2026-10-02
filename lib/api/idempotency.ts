import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { redis } from "@/lib/redis";

/**
 * HTTP idempotency for mutating requests (Phase B).
 *
 * When a client sends `Idempotency-Key`, the first request runs and its JSON
 * response is stored `(userId, key)` for a TTL; a retry with the same key
 * replays the stored status/body instead of re-running the handler. A Redis
 * `SET NX` lock makes concurrent duplicates with the same key fail fast (409)
 * rather than execute twice.
 *
 * Best-effort by construction: if Redis is unavailable the request proceeds
 * uninstrumented, so idempotency can never take the API down. Responses over
 * the size cap and non-JSON (streamed) responses are not stored.
 */

export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
/** Must exceed the slowest handler we protect; released early on completion. */
const LOCK_TTL_SECONDS = 60;
const MAX_STORED_BODY_BYTES = 64 * 1024;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

type StoredResponse = { status: number; contentType: string | null; body: string };

export type IdempotentOutcome =
  | { kind: "replay"; response: Response }
  | { kind: "in_flight" }
  | { kind: "proceed"; finish: (response: Response) => Promise<void> };

function digest(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 40);
}

function storageKey(userId: string, key: string): string {
  return `idem:${userId}:${digest(key)}`;
}

function lockKey(key: string): string {
  return `${key}:lock`;
}

async function readStored(key: string): Promise<StoredResponse | null> {
  try {
    const raw = await redis.get<string>(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredResponse;
    if (typeof parsed.body !== "string" || typeof parsed.status !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function toResponse(stored: StoredResponse): Response {
  return new Response(stored.body, {
    status: stored.status,
    headers: {
      "content-type": stored.contentType ?? "application/json; charset=utf-8",
    },
  });
}

async function releaseLock(key: string, token: string): Promise<void> {
  try {
    await redis.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) end return 0`,
      [key],
      [token],
    );
  } catch {
    // Self-expires via the lock TTL.
  }
}

/** Claim an idempotency key, replay a completed response, or fail fast. */
export async function beginIdempotent({
  userId,
  key,
}: {
  userId: string;
  key: string;
}): Promise<IdempotentOutcome> {
  const recordKey = storageKey(userId, key);

  const existing = await readStored(recordKey);
  if (existing) return { kind: "replay", response: toResponse(existing) };

  const token = randomUUID();
  let acquired: boolean;
  try {
    acquired =
      (await redis.set(lockKey(recordKey), token, {
        nx: true,
        ex: LOCK_TTL_SECONDS,
      })) === "OK";
  } catch {
    // Redis down: run the request, don't pretend it is idempotent.
    return { kind: "proceed", finish: async () => {} };
  }

  if (!acquired) {
    // It may have completed between our read and the lock attempt.
    const raced = await readStored(recordKey);
    if (raced) return { kind: "replay", response: toResponse(raced) };
    return { kind: "in_flight" };
  }

  return {
    kind: "proceed",
    finish: async (response: Response) => {
      try {
        const contentType = response.headers.get("content-type");
        if (response.status < 500 && contentType?.includes("application/json")) {
          const body = await response.clone().text();
          if (Buffer.byteLength(body) <= MAX_STORED_BODY_BYTES) {
            const stored: StoredResponse = {
              status: response.status,
              contentType,
              body,
            };
            await redis.set(recordKey, JSON.stringify(stored), {
              ex: IDEMPOTENCY_TTL_SECONDS,
            });
          }
        }
      } catch {
        // A cache write failure must not fail the request.
      } finally {
        await releaseLock(lockKey(recordKey), token);
      }
    },
  };
}
