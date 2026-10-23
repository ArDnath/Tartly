import { ok, withUser } from "@/lib/api/http";
import { getEntitlement } from "@/lib/billing/entitlements";
import { BILLING_PLAN } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";

/**
 * GET /api/billing/status — the signed-in user's entitlement plus the plan
 * metadata the paywall and checkout render. Read-only; safe to poll and to
 * fetch on every app load (this is what makes the wall survive reloads).
 */
export const GET = withUser(async (userId) => {
  const entitlement = await getEntitlement(userId);
  return ok({ entitlement, plan: BILLING_PLAN });
});
