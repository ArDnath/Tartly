import "server-only";

import { nanoid } from "nanoid";

import type { BillingInterval } from "@/lib/db/schema";
import { grantPlanCredits } from "@/lib/billing/credits";
import { billingRepository } from "@/lib/repositories/billing";

/**
 * Billing operations that are not tied to a specific Dodo call — the
 * simulation-mode activation and cancellation, used by the in-app mock checkout
 * while Dodo keys are absent.
 */

/** Period end for a simulated subscription (mirrors the billing cadence). */
function simulatedPeriodEnd(interval: BillingInterval, from = new Date()): Date {
  const end = new Date(from);
  if (interval === "year") {
    end.setFullYear(end.getFullYear() + 1);
  } else {
    end.setMonth(end.getMonth() + 1);
  }
  return end;
}

/** Activate a simulated subscription (simulation checkout completion). */
export async function activateSimulatedSubscription(input: {
  userId: string;
  interval: BillingInterval;
}): Promise<void> {
  await billingRepository.upsertSubscription({
    userId: input.userId,
    dodoSubscriptionId: `sim_sub_${nanoid()}`,
    dodoCustomerId: `sim_cus_${input.userId}`,
    dodoProductId: `sim_product_${input.interval}`,
    status: "active",
    interval: input.interval,
    currentPeriodEnd: simulatedPeriodEnd(input.interval),
    cancelAtPeriodEnd: false,
    canceledAt: null,
  });
  await billingRepository.unlockPaywall(input.userId);
  await grantPlanCredits({
    userId: input.userId,
    subscriptionId: null,
    interval: input.interval,
    periodEnd: null,
  });
}

/** Cancel a simulated subscription immediately (simulation portal). */
export async function cancelSimulatedSubscription(userId: string): Promise<void> {
  await billingRepository.upsertSubscription({
    userId,
    dodoSubscriptionId: null,
    dodoCustomerId: `sim_cus_${userId}`,
    dodoProductId: null,
    status: "cancelled",
    interval: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    canceledAt: new Date(),
  });
  await billingRepository.lockPaywall(userId, "ai");
}
