import type { NextRequest } from "next/server";

import { apiError, ok, withUser } from "@/lib/api/http";
import { getEntitlement } from "@/lib/billing/entitlements";
import { syncDodoPayment, syncDodoSubscription } from "@/lib/billing/dodo";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/sync — reconcile a just-completed checkout.
 *
 * The browser redirect back from Dodo is *not* proof of payment, so we never
 * trust its query parameters directly: we take the id it carries, re-fetch the
 * resource from Dodo with our secret key, confirm it belongs to the signed-in
 * user, and mirror it. This is what makes the flow work end-to-end where a
 * webhook cannot reach the server (e.g. local development); in production the
 * webhook remains the authoritative, real-time feed and this is simply a
 * belt-and-braces fast path for the success page.
 */
export const POST = withUser(async (userId, request: NextRequest) => {
  const body = (await request.json().catch(() => ({}))) as {
    subscriptionId?: unknown;
    paymentId?: unknown;
  };
  const subscriptionId =
    typeof body.subscriptionId === "string" ? body.subscriptionId : null;
  const paymentId =
    typeof body.paymentId === "string" ? body.paymentId : null;

  if (!subscriptionId && !paymentId) {
    return apiError("bad_request", "Missing checkout reference.", 400);
  }

  const result = subscriptionId
    ? await syncDodoSubscription(subscriptionId, userId)
    : await syncDodoPayment(paymentId as string, userId);

  // Resolved to a different account: refuse without revealing anything.
  if (result.userId && result.userId !== userId) {
    return apiError("forbidden", "This checkout does not belong to you.", 403);
  }

  return ok({
    entitlement: await getEntitlement(userId),
    reconciled: result.applied,
  });
});
