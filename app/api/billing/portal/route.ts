import type { NextRequest } from "next/server";

import { apiError, ok, withUser } from "@/lib/api/http";
import { isDodoConfigured } from "@/lib/env";
import { getEntitlement } from "@/lib/billing/entitlements";
import { cancelSimulatedSubscription } from "@/lib/billing/service";
import { createPortalSession } from "@/lib/billing/dodo";
import { billingRepository } from "@/lib/repositories/billing";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/portal — manage an existing subscription.
 *
 * Live mode returns a Dodo Customer Portal URL. Simulation mode has no portal,
 * so it performs the equivalent action directly: cancel the subscription.
 *
 * The customer id is resolved server-side from the signed-in user's billing
 * account; it is never accepted from the client.
 */
export const POST = withUser(async (userId, request: NextRequest) => {
  if (isDodoConfigured()) {
    const account = await billingRepository.getAccount(userId);
    if (!account?.dodoCustomerId) {
      return apiError(
        "bad_request",
        "You don't have a billing account to manage yet.",
        400,
      );
    }
    const url = await createPortalSession({
      customerId: account.dodoCustomerId,
      origin: request.nextUrl.origin,
    });
    if (!url) {
      return apiError(
        "upstream_error",
        "Could not open the billing portal. Try again shortly.",
        502,
      );
    }
    return ok({ url, mode: "live" as const });
  }

  // Simulation mode: no Dodo portal exists, so cancel directly.
  await cancelSimulatedSubscription(userId);
  return ok({
    url: null,
    mode: "sim" as const,
    entitlement: await getEntitlement(userId),
  });
});
