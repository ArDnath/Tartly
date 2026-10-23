import type { NextRequest } from "next/server";

import { apiError, ok, withUser } from "@/lib/api/http";
import {
  getEntitlement,
  lockPaywall,
  type PaywallReason,
} from "@/lib/billing/entitlements";

export const dynamic = "force-dynamic";

const REASONS = new Set<PaywallReason>([
  "ai",
  "mail_view",
  "mail_send",
  "accounts",
  "credits",
]);

function isReason(value: unknown): value is PaywallReason {
  return typeof value === "string" && REASONS.has(value as PaywallReason);
}

/**
 * POST /api/billing/paywall — persist the paywall lock.
 *
 * The client blocks locally the moment a free user tries a gated action, so it
 * still needs a server call to make the wall durable. The lock is coalesced, so
 * calling this repeatedly (every reload, every attempt) is harmless.
 */
export const POST = withUser(async (userId, request: NextRequest) => {
  const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
  if (!isReason(body.reason)) {
    return apiError("bad_request", "Unknown paywall reason.", 400);
  }
  await lockPaywall(userId, body.reason);
  return ok({ entitlement: await getEntitlement(userId) });
});
