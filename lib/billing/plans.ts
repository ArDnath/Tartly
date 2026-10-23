import type { BillingInterval } from "@/lib/db/schema";

/**
 * The single paid plan. Prices are display metadata only — the real amount
 * charged comes from the Dodo product configured for the interval. Keeping the
 * numbers here lets the paywall, the pricing page and the checkout summary
 * agree without reading Dodo on every render.
 *
 * Matches the marketing pricing table: $25 billed monthly, or $20/month when
 * billed yearly ($240 charged once a year).
 */
export const BILLING_PLAN = {
  id: "professional",
  name: "Professional",
  tagline: "Your inbox, handled by an AI operator.",
  prices: {
    month: { amountUsd: 25, per: "month" as const },
    year: { amountUsd: 20, per: "month" as const, totalUsd: 240 },
  },
} as const;

export type PlanInterval = BillingInterval;

export function isBillingInterval(value: unknown): value is PlanInterval {
  return value === "month" || value === "year";
}

/** Human label for an interval, e.g. "billed monthly" / "billed yearly". */
export function intervalLabel(interval: PlanInterval): string {
  return interval === "year" ? "billed yearly" : "billed monthly";
}
