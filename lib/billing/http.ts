import "server-only";

import { apiError } from "@/lib/api/http";
import type { Entitlement, PaywallReason } from "@/lib/billing/entitlements";

/**
 * The one `402` shape for a blocked action. `details` carries the reason and a
 * fresh entitlement snapshot so the client can render (and persist) the paywall
 * without a second round trip.
 */
export function paymentRequired(
  entitlement: Entitlement,
  reason: PaywallReason,
) {
  return apiError(
    "payment_required",
    "A Tartly subscription is required to continue.",
    402,
    undefined,
    { reason, entitlement },
  );
}
