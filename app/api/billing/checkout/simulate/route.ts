import type { NextRequest } from "next/server";

import { apiError, ok, withUser } from "@/lib/api/http";
import { getEntitlement } from "@/lib/billing/entitlements";
import { activateSimulatedSubscription } from "@/lib/billing/service";
import { verifySimCheckout } from "@/lib/billing/sim";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/checkout/simulate — complete a simulation-mode checkout.
 *
 * Only reachable while Dodo is unwired. The signed token binds the activation
 * to the requesting user and a single interval, so a client cannot grant itself
 * a plan it did not start a checkout for.
 */
export const POST = withUser(async (userId, request: NextRequest) => {
  // Simulation is a development-only convenience. A production build must
  // never activate a plan without a verified Dodo payment, even if a signed
  // simulation token from another environment somehow reaches this route.
  if (process.env.NODE_ENV === "production") {
    return apiError("not_found", "Not found.", 404);
  }

  const body = (await request.json().catch(() => ({}))) as { token?: unknown };
  if (typeof body.token !== "string") {
    return apiError("bad_request", "Missing checkout token.", 400);
  }

  const payload = verifySimCheckout(body.token);
  if (!payload || payload.userId !== userId) {
    return apiError("bad_request", "Invalid or expired checkout session.", 400);
  }

  await activateSimulatedSubscription({
    userId,
    interval: payload.interval,
  });

  return ok({ entitlement: await getEntitlement(userId), mode: "sim" });
});
