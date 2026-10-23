import type {
  BillingInterval,
  CreditLedgerReason,
  SubscriptionStatus,
} from "@/lib/db/schema";

/**
 * Client-safe paywall types. Kept free of `server-only` imports so the paywall
 * UI, store and hooks can share the exact shape the API returns.
 */

export type PaywallReason =
  | "ai"
  | "mail_view"
  | "mail_send"
  | "accounts"
  | "credits";

export type CreditUsage = {
  balance: number;
  lifetimeGranted: number;
  lifetimeSpent: number;
};

export type FreeUsage = {
  mailViewsUsed: number;
  mailViewsLimit: number;
  mailViewsRemaining: number;
  mailSendsUsed: number;
  mailSendsLimit: number;
  mailSendsRemaining: number;
};

export type Entitlement = {
  isSubscriber: boolean;
  status: SubscriptionStatus;
  interval: BillingInterval | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  paywallLocked: boolean;
  paywallReason: PaywallReason | null;
  free: FreeUsage;
  /** AI credit wallet; the meter reads this. */
  credits: CreditUsage;
  billingConfigured: boolean;
};

export type BillingStatusResponse = {
  entitlement: Entitlement;
  plan: {
    id: string;
    name: string;
    tagline: string;
    prices: {
      month: { amountUsd: number; per: "month" };
      year: { amountUsd: number; per: "month"; totalUsd: number };
    };
  };
};

/** The mirrored subscription record, flattened for the billing UI. */
export type BillingSubscription = {
  status: SubscriptionStatus;
  interval: BillingInterval | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  /** When the subscription row was first written (a stand-in for start date). */
  startedAt: string | null;
};

/** One completed one-time credit-pack purchase. */
export type BillingPayment = {
  id: string;
  packId: string;
  usdCents: number;
  credits: number;
  status: string;
  createdAt: string;
};

/** One credit-ledger movement (grant, spend, refund or adjustment). */
export type BillingLedgerEntry = {
  id: string;
  delta: number;
  reason: CreditLedgerReason;
  balanceAfter: number;
  createdAt: string;
};

/**
 * The full billing snapshot for the settings surface: the entitlement the rest
 * of the app gates on, the mirrored subscription, the one-time purchases and the
 * recent credit ledger. Read-only and client-safe.
 */
export type BillingOverview = {
  entitlement: Entitlement;
  plan: BillingStatusResponse["plan"];
  subscription: BillingSubscription | null;
  payments: BillingPayment[];
  ledger: BillingLedgerEntry[];
};
