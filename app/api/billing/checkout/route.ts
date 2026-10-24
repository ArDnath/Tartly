import type { NextRequest } from "next/server";

import { apiError, ok, withUser } from "@/lib/api/http";
import {
  createCheckoutSession,
  isSimulatedInterval,
} from "@/lib/billing/dodo";
import { isBillingInterval } from "@/lib/billing/plans";
import { publicOrigin } from "@/lib/http/public-origin";
import { billingRepository } from "@/lib/repositories/billing";
import { userRepository } from "@/lib/repositories/users";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/checkout — create a Dodo Checkout Session for the
 * signed-in user.
 *
 * Returns a hosted Dodo `checkoutUrl` the client redirects to (the API key never
 * leaves the server) or, when Dodo is unwired, a signed simulation token for the
 * in-app mock checkout. The user must already be signed in: this is the
 * "Google signup first, then checkout" gate.
 */
export const POST = withUser(async (userId, request: NextRequest) => {
  const body = (await request.json().catch(() => ({}))) as {
    interval?: unknown;
  };
  if (!isBillingInterval(body.interval)) {
    return apiError("bad_request", "Choose a monthly or yearly plan.", 400);
  }

  // In production a missing Dodo product is a hard failure, never a silent
  // fall-through to the in-app simulation (which would fake a payment).
  if (
    process.env.NODE_ENV === "production" &&
    isSimulatedInterval(body.interval)
  ) {
    return apiError(
      "service_unavailable",
      "Checkout is unavailable right now.",
      503,
    );
  }

  const [account, email, name] = await Promise.all([
    billingRepository.ensureAccount(userId),
    userRepository.findEmailById(userId),
    userRepository.findNameById(userId),
  ]);

  const checkout = await createCheckoutSession({
    userId,
    email,
    name,
    interval: body.interval,
    origin: publicOrigin(),
    existingCustomerId: account.dodoCustomerId ?? null,
  });

  return ok(checkout);
});
