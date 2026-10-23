import "server-only";

import { listCreditLedger } from "@/lib/billing/credits";
import { getEntitlement } from "@/lib/billing/entitlements";
import { BILLING_PLAN } from "@/lib/billing/plans";
import type { BillingOverview } from "@/lib/billing/paywall-types";
import { billingRepository } from "@/lib/repositories/billing";
import { creditRepository } from "@/lib/repositories/credits";

/**
 * The read model behind the Billing settings surface.
 *
 * Assembles the entitlement (the same snapshot every gate reads), the mirrored
 * subscription, the one-time credit-pack purchases and the recent credit ledger
 * into a single client-safe payload. Read-only: nothing here mutates billing
 * state, so it is safe to call on every settings render.
 */
const LEDGER_LIMIT = 25;
const PURCHASE_LIMIT = 25;

export async function getBillingOverview(
  userId: string,
): Promise<BillingOverview> {
  const [entitlement, subscription, purchases, ledger] = await Promise.all([
    getEntitlement(userId),
    billingRepository.getSubscription(userId),
    creditRepository.listPurchases(userId, PURCHASE_LIMIT),
    listCreditLedger(userId, LEDGER_LIMIT),
  ]);

  return {
    entitlement,
    plan: BILLING_PLAN,
    subscription: subscription
      ? {
          status: subscription.status,
          interval: subscription.interval,
          currentPeriodEnd:
            subscription.currentPeriodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          canceledAt: subscription.canceledAt?.toISOString() ?? null,
          startedAt: subscription.createdAt?.toISOString() ?? null,
        }
      : null,
    payments: purchases.map((purchase) => ({
      id: purchase.id,
      packId: purchase.packId,
      usdCents: purchase.usdCents,
      credits: purchase.credits,
      status: purchase.status,
      createdAt: purchase.createdAt.toISOString(),
    })),
    ledger: ledger.map((entry) => ({
      id: entry.id,
      delta: entry.delta,
      reason: entry.reason,
      balanceAfter: entry.balanceAfter,
      createdAt: entry.createdAt.toISOString(),
    })),
  };
}
