import "server-only";

import {
  PLAN_CREDIT_GRANTS,
  creditsForUsage,
} from "@/lib/billing/credit-config";
import { paywallGatedEmails } from "@/lib/env";
import { creditRepository } from "@/lib/repositories/credits";
import type { BillingInterval } from "@/lib/db/schema";

/**
 * The credit system's server authority.
 *
 * A wallet holds a balance; the ledger holds every movement. Grants are
 * idempotent by key (a subscription period, a Dodo payment id) so a redelivered
 * webhook can never double-credit. Every AI call spends credits after it
 * completes; enforcement reads the balance before a call runs.
 */

export type CreditSummary = {
  balance: number;
  lifetimeGranted: number;
  lifetimeSpent: number;
};

export async function getCreditSummary(
  userId: string,
): Promise<CreditSummary> {
  const wallet = await creditRepository.getWallet(userId);
  return {
    balance: wallet?.balance ?? 0,
    lifetimeGranted: wallet?.lifetimeGranted ?? 0,
    lifetimeSpent: wallet?.lifetimeSpent ?? 0,
  };
}

/**
 * Whether the user may start another AI call. Fails **open** on a transient DB
 * error: a credit read must never take the assistant down.
 */
export async function hasCredits(userId: string): Promise<boolean> {
  // Paywall allowlist mode ("building"): exempt accounts are never
  // credit-blocked. Mirrors `unrestrictedEntitlement` in entitlements.ts.
  if (paywallGatedEmails().length > 0) return true;
  try {
    return (await creditRepository.getBalance(userId)) > 0;
  } catch (error) {
    console.warn("[credits] balance read failed; allowing call", error);
    return true;
  }
}

/**
 * Grant the subscription's periodic credit allowance. Keyed on the subscription
 * id + period end so each paid period credits exactly once.
 */
export async function grantPlanCredits(input: {
  userId: string;
  subscriptionId: string | null;
  interval: BillingInterval | null;
  periodEnd: Date | null;
}): Promise<void> {
  const interval = input.interval ?? "month";
  const credits = PLAN_CREDIT_GRANTS[interval];
  if (credits <= 0) return;
  const period = input.periodEnd?.toISOString() ?? "once";
  const key = `plan:${input.subscriptionId ?? input.userId}:${interval}:${period}`;
  await creditRepository.applyDelta({
    userId: input.userId,
    delta: credits,
    reason: "grant_plan",
    idempotencyKey: key,
    metadata: {
      subscriptionId: input.subscriptionId,
      interval,
      periodEnd: input.periodEnd?.toISOString() ?? null,
    },
  });
}

/** Grant a one-time credit-pack purchase. Keyed on the Dodo payment id. */
export async function grantPurchaseCredits(input: {
  userId: string;
  dodoPaymentId: string;
  packId: string;
  usdCents: number;
  credits: number;
}): Promise<boolean> {
  if (input.credits <= 0) return false;
  const isNew = await creditRepository.recordPurchase({
    userId: input.userId,
    dodoPaymentId: input.dodoPaymentId,
    packId: input.packId,
    usdCents: input.usdCents,
    credits: input.credits,
  });
  await creditRepository.applyDelta({
    userId: input.userId,
    delta: input.credits,
    reason: "grant_purchase",
    idempotencyKey: `purchase:${input.dodoPaymentId}`,
    metadata: {
      packId: input.packId,
      usdCents: input.usdCents,
    },
  });
  return isNew;
}

/**
 * Charge credits for a completed model call. Best-effort: a ledger failure must
 * never fail the AI feature (the call already produced value).
 */
export async function chargeAiCredits(input: {
  userId?: string;
  feature: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
}): Promise<void> {
  if (!input.userId) return;
  const credits = creditsForUsage({
    model: input.model,
    promptTokens: input.promptTokens ?? 0,
    completionTokens: input.completionTokens ?? 0,
  });
  if (credits <= 0) return;
  try {
    await creditRepository.applyDelta({
      userId: input.userId,
      delta: -credits,
      reason: "usage",
      metadata: {
        feature: input.feature,
        model: input.model,
        promptTokens: input.promptTokens ?? 0,
        completionTokens: input.completionTokens ?? 0,
      },
    });
  } catch (error) {
    console.warn("[credits] failed to charge usage", error);
  }
}

/** Pull a page of credit movements for a settings/history view. */
export async function listCreditLedger(userId: string, limit = 25) {
  return creditRepository.listLedger(userId, limit);
}
