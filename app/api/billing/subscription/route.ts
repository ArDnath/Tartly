import { ok, withUser } from "@/lib/api/http";
import { getBillingOverview } from "@/lib/billing/overview";

export const dynamic = "force-dynamic";

/**
 * GET /api/billing/subscription — the signed-in user's payment status.
 *
 * Returns the entitlement plus the mirrored subscription, one-time payments and
 * recent credit ledger the Billing settings surface renders. Read-only and
 * user-scoped (the id always comes from the session), so it is safe to poll
 * after a checkout return to reflect a fresh charge.
 */
export const GET = withUser(async (userId) => {
  return ok(await getBillingOverview(userId));
});
