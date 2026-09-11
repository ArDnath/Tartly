import "server-only";

import { redis } from "@/lib/redis";

/**
 * Per-user send throttle, matching topple's `rateLimit` on `/send`.
 *
 * A fixed one-minute window on an Upstash counter. Fails *open*: Redis being
 * unreachable must never stop a user sending mail, so we allow the call and
 * only log.
 */
const WINDOW_SECONDS = 60;
const LIMIT = Number(process.env.MAIL_SEND_RATE_LIMIT ?? 30);

export async function allowMailSend(userId: string): Promise<boolean> {
  try {
    const window = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
    const key = `mail-send:${userId}:${window}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, WINDOW_SECONDS);
    return count <= LIMIT;
  } catch (error) {
    console.warn("[mail/rate-limit] counter unavailable; allowing send", error);
    return true;
  }
}
