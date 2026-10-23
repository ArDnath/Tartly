/**
 * Credit pricing & catalogue (client-safe).
 *
 * A "credit" is Tartly's retail unit of AI value. The rule the business runs on:
 *
 *   1 credit = $0.01 of retail AI value.
 *   A purchase grants `paid × 100 × (1 − margin)` credits.
 *
 * With the default 50% margin a **$20 payment buys 1000 credits ($10 of AI
 * value)**; the platform keeps the other half. The retail token rate below sits
 * comfortably above our raw model cost, so the *effective* margin is higher than
 * the headline 50% — the headline is the promise to the customer.
 *
 * Pure and dependency-free so the pricing page, the buy-credits dialog and the
 * server all quote the same numbers.
 */

/** Retail value of one credit, in US dollars. */
export const USD_PER_CREDIT = 0.01;

/** Fraction of a payment the platform keeps. Configurable per deploy. */
export const CREDIT_MARGIN = 0.5;

/** Credits per US dollar of payment (before the margin cut). */
export const CREDITS_PER_USD = 100;

/** Credits granted for a paid amount, after the platform margin. */
export function creditsForPurchase(usd: number): number {
  return Math.max(0, Math.floor(usd * CREDITS_PER_USD * (1 - CREDIT_MARGIN)));
}

/** US dollars a credit balance is worth at retail. */
export function usdForCredits(credits: number): number {
  return credits * USD_PER_CREDIT;
}

export type CreditPack = {
  id: string;
  /** Price in whole US dollars. */
  usd: number;
  /** Credits the buyer receives. */
  credits: number;
  label: string;
  /** "Most popular" / "Best value" badge, when set. */
  badge?: string;
};

/**
 * Top-up packs. Only the packs with a configured Dodo one-time product id are
 * actually purchasable (`DODO_PRODUCT_CREDITS_<ID>`), but the catalogue is
 * always shown so the UI does not shift between environments.
 */
export const CREDIT_PACKS: readonly CreditPack[] = [
  {
    id: "starter",
    usd: 10,
    credits: creditsForPurchase(10),
    label: "Starter",
  },
  {
    id: "plus",
    usd: 20,
    credits: creditsForPurchase(20),
    label: "Plus",
    badge: "Most popular",
  },
  {
    id: "pro",
    usd: 50,
    credits: creditsForPurchase(50),
    label: "Pro",
    badge: "Best value",
  },
] as const;

export function findCreditPack(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((pack) => pack.id === id);
}

/**
 * Monthly credits included with a subscription, derived from the plan price
 * with the same margin. A yearly plan grants the whole year up front.
 */
export const PLAN_CREDIT_GRANTS: Readonly<Record<"month" | "year", number>> = {
  month: creditsForPurchase(25),
  year: creditsForPurchase(240),
};

/* -------------------------------------------------------------------------- */
/*  Usage → credits                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Retail price per **million** tokens, keyed by a case-insensitive model-id
 * substring. The first match wins; anything unmatched uses `DEFAULT_RETAIL`.
 * These are retail rates (what the user's credits pay), not our cost.
 */
export const RETAIL_USD_PER_MILLION: ReadonlyArray<{
  match: string;
  input: number;
  output: number;
}> = [
  { match: "deepseek-v4-pro", input: 2, output: 8 },
  { match: "deepseek-v4.1-flash", input: 1.5, output: 6 },
  { match: "deepseek", input: 1, output: 4 },
];

export const DEFAULT_RETAIL_USD_PER_MILLION = { input: 1, output: 4 };

function retailRate(model: string): { input: number; output: number } {
  const normalized = model.toLowerCase();
  return (
    RETAIL_USD_PER_MILLION.find((entry) => normalized.includes(entry.match)) ??
    DEFAULT_RETAIL_USD_PER_MILLION
  );
}

/**
 * Credits to charge for one model call. Output tokens cost more than input, as
 * the model does more work per output token. Rounds up so a call always costs
 * at least one credit when any tokens moved.
 */
export function creditsForUsage({
  model,
  promptTokens = 0,
  completionTokens = 0,
}: {
  model: string;
  promptTokens?: number;
  completionTokens?: number;
}): number {
  if (promptTokens <= 0 && completionTokens <= 0) return 0;
  const rate = retailRate(model);
  const usd =
    (promptTokens * rate.input + completionTokens * rate.output) / 1_000_000;
  return Math.max(1, Math.ceil(usd / USD_PER_CREDIT));
}

/** Compact display, e.g. `1,250`. */
export function formatCredits(credits: number): string {
  return Math.max(0, Math.floor(credits)).toLocaleString("en-US");
}
