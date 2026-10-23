import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";
import type { BillingInterval } from "@/lib/db/schema";

/**
 * Signed tokens for simulation-mode checkout.
 *
 * When Dodo is not configured, `/api/billing/checkout` issues one of these
 * instead of a hosted checkout URL. The in-app mock checkout posts it back to
 * activate a subscription. It is HMAC-signed with the auth secret and expires,
 * so a client can only activate a plan for *itself*, and only shortly after
 * asking for checkout — the same trust boundary a real single-use session URL
 * gives.
 */

const TTL_MS = 30 * 60 * 1000;

type SimPayload = {
  userId: string;
  interval: BillingInterval;
  exp: number;
};

function secret(): string {
  return env.BETTER_AUTH_SECRET;
}

function sign(encoded: string): string {
  return createHmac("sha256", secret()).update(encoded).digest("base64url");
}

export function signSimCheckout(input: {
  userId: string;
  interval: BillingInterval;
}): string {
  const payload: SimPayload = {
    userId: input.userId,
    interval: input.interval,
    exp: Date.now() + TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifySimCheckout(token: string): SimPayload | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as SimPayload;
    if (
      typeof payload.userId !== "string" ||
      (payload.interval !== "month" && payload.interval !== "year") ||
      typeof payload.exp !== "number" ||
      payload.exp < Date.now()
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
