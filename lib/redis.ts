import { Redis } from "@upstash/redis";

import { env } from "@/lib/env";

/**
 * Raw Upstash Redis client.
 *
 * Automatic (de)serialization is disabled on purpose: Better Auth's
 * `secondaryStorage` contract stores and expects plain JSON strings.
 * Auto-parsing would turn a stored JSON string into an object (and could
 * coerce numeric-looking strings), corrupting session/verification records.
 */
export const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
  automaticDeserialization: false,
});

export async function disconnectRedis(): Promise<void> {
  // @upstash/redis is HTTP-based; no explicit disconnect needed.
}
