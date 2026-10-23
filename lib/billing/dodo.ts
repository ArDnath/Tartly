import "server-only";

import DodoPayments from "dodopayments";

import {
  dodoApiKey,
  dodoCreditProductId,
  dodoEnvironment,
  dodoProductId,
  dodoWebhookKey,
  isDodoConfigured,
} from "@/lib/env";
import { signSimCheckout } from "@/lib/billing/sim";
import { subscriptionIsEntitled } from "@/lib/billing/entitlements";
import {
  CREDIT_PACKS,
  findCreditPack,
  type CreditPack,
} from "@/lib/billing/credit-config";
import { grantPlanCredits, grantPurchaseCredits } from "@/lib/billing/credits";
import { billingRepository } from "@/lib/repositories/billing";
import {
  SUBSCRIPTION_STATUSES,
  type BillingInterval,
  type SubscriptionStatus,
} from "@/lib/db/schema";

/**
 * Dodo Payments server integration.
 *
 * The client is created lazily so importing this module never requires a key
 * (the app boots and runs in simulation mode without one). Every call that needs
 * Dodo checks `isDodoConfigured()` first; a missing product id for the requested
 * interval degrades to simulation rather than throwing.
 *
 * Security posture: the environment is pinned to the test host unless live mode
 * is explicitly enabled (see `dodoEnvironment`), the webhook is verified with the
 * signing key before anything is trusted, and the API key never leaves the
 * server.
 */

let cached: DodoPayments | null = null;

/**
 * The Dodo client, or `null` when billing is not configured. This is the single
 * choke point for the test-mode lock: `isDodoConfigured()` refuses a key that
 * self-identifies as live unless live mode is explicitly enabled, so every
 * caller (checkout, portal, webhook) falls back to simulation rather than
 * charging.
 */
function getDodo(): DodoPayments | null {
  if (!isDodoConfigured()) return null;
  const key = dodoApiKey();
  if (!key) return null;
  if (!cached) {
    cached = new DodoPayments({
      bearerToken: key,
      environment: dodoEnvironment(),
      webhookKey: dodoWebhookKey(),
    });
  }
  return cached;
}

/** True when this interval cannot use Dodo (no key or no product configured). */
export function isSimulatedInterval(interval: BillingInterval): boolean {
  return !isDodoConfigured() || !dodoProductId(interval);
}

export type HostedCheckout = {
  mode: "live" | "sim";
  sessionId: string;
  /** Dodo-hosted checkout URL; only present in live mode. */
  checkoutUrl: string | null;
  /** Signed token for the in-app simulated checkout; only in sim mode. */
  simToken: string | null;
};

/**
 * The Dodo customer id for this user, creating one on first use. Linking the
 * customer up front (before checkout) is what lets later webhook and return-URL
 * events resolve back to the user even when Dodo does not copy our session
 * metadata onto the subscription.
 */
export async function ensureDodoCustomer(input: {
  userId: string;
  email: string | null;
  name: string | null;
  existingCustomerId: string | null;
}): Promise<string | null> {
  if (input.existingCustomerId) return input.existingCustomerId;
  const dodo = getDodo();
  if (!dodo || !input.email) return null;
  // Dodo matches an existing customer by email by default, so this is
  // effectively "get-or-create" — no duplicate customer per checkout.
  const customer = await dodo.customers.create({
    email: input.email,
    name: input.name?.trim() || input.email,
    metadata: { userId: input.userId },
  });
  await billingRepository.setDodoCustomerId(input.userId, customer.customer_id);
  return customer.customer_id;
}

/**
 * Create a Dodo Checkout Session for a subscription — or a signed simulation
 * token when Dodo is not wired.
 *
 * Returns a hosted `checkoutUrl` the caller redirects to; the browser never sees
 * the API key. Confirmation of payment always comes from the webhook (or a
 * server-side reconcile on return), never from the redirect itself.
 */
export async function createCheckoutSession(input: {
  userId: string;
  email: string | null;
  name: string | null;
  interval: BillingInterval;
  origin: string;
  existingCustomerId: string | null;
}): Promise<HostedCheckout> {
  const productId = dodoProductId(input.interval);
  const dodo = getDodo();

  // Without a client or a product id we cannot create a real session — fall
  // back to the in-app simulation rather than a broken checkout.
  if (!dodo || !productId) {
    return {
      mode: "sim",
      sessionId: `sim_${input.userId}_${input.interval}`,
      checkoutUrl: null,
      simToken: signSimCheckout({
        userId: input.userId,
        interval: input.interval,
      }),
    };
  }

  const customerId = await ensureDodoCustomer({
    userId: input.userId,
    email: input.email,
    name: input.name,
    existingCustomerId: input.existingCustomerId,
  });

  const session = await dodo.checkoutSessions.create({
    product_cart: [{ product_id: productId, quantity: 1 }],
    ...(customerId
      ? { customer: { customer_id: customerId } }
      : input.email
        ? { customer: { email: input.email } }
        : {}),
    // Attached to the resulting payment; also carried on the subscription when
    // Dodo supports it. Customer linking still works via the stored customer id.
    metadata: { userId: input.userId, interval: input.interval },
    return_url: `${input.origin}/api/billing/return`,
    cancel_url: `${input.origin}/api/billing/return?status=cancelled`,
    customization: { theme: "dark" },
  });

  if (!session.checkout_url) {
    throw new Error("Dodo checkout session did not return a URL");
  }

  return {
    mode: "live",
    sessionId: session.session_id,
    checkoutUrl: session.checkout_url,
    simToken: null,
  };
}

/** A Dodo-hosted customer portal for managing/canceling a subscription. */
export async function createPortalSession(input: {
  customerId: string;
  origin: string;
}): Promise<string | null> {
  const dodo = getDodo();
  if (!dodo) return null;
  const session = await dodo.customers.customerPortal.create(input.customerId, {
    return_url: `${input.origin}/settings`,
  });
  return session.link;
}

/** The typed union of every Dodo webhook payload. */
export type DodoWebhookEvent = DodoPayments.UnwrapWebhookEvent;

/**
 * Verify and parse a Dodo webhook request. Throws on an invalid signature.
 * `headers` must be the raw `webhook-id` / `webhook-signature` /
 * `webhook-timestamp` values and `rawBody` the exact bytes received — never a
 * re-serialized JSON object.
 */
export function constructDodoWebhookEvent(
  rawBody: string,
  headers: Record<string, string>,
): DodoWebhookEvent {
  const dodo = getDodo();
  const key = dodoWebhookKey();
  if (!dodo || !key) {
    throw new Error("Dodo webhook is not configured");
  }
  return dodo.webhooks.unwrap(rawBody, { headers, key });
}

/** Coerce a Dodo status string to our mirrored status (unknown → `none`). */
function statusOf(value: string): SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(value)
    ? (value as SubscriptionStatus)
    : "none";
}

/** Dodo's capitalized intervals → our lowercase interval. */
function intervalOf(value: string): BillingInterval | null {
  if (value === "Year") return "year";
  if (value === "Month") return "month";
  return null;
}

function dateOf(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Resolve which of our users a Dodo subscription belongs to. Metadata first
 * (set at checkout), then our existing row for this subscription, then the
 * customer we linked before checkout. Each lookup only runs when the previous
 * one came up empty.
 */
async function resolveUserId(
  subscription: DodoPayments.Subscription,
): Promise<string | null> {
  const metadataUserId =
    typeof subscription.metadata?.userId === "string"
      ? subscription.metadata.userId
      : null;
  if (metadataUserId) return metadataUserId;

  const existingSubscription =
    await billingRepository.findSubscriptionByDodoId(
      subscription.subscription_id,
    );
  if (existingSubscription?.userId) return existingSubscription.userId;

  const customerId = subscription.customer?.customer_id ?? null;
  if (!customerId) return null;
  const existingAccount =
    await billingRepository.findAccountByDodoCustomerId(customerId);
  return existingAccount?.userId ?? null;
}

/**
 * Mirror a Dodo subscription into our table and update the paywall lock. Safe to
 * call repeatedly: the row is upserted and the lock is derived from the status.
 */
export async function applyDodoSubscription(
  subscription: DodoPayments.Subscription,
): Promise<void> {
  const userId = await resolveUserId(subscription);
  const customerId = subscription.customer?.customer_id ?? null;

  if (!userId) {
    console.error(
      "[billing] Dodo subscription event without a resolvable user",
      subscription.subscription_id,
    );
    return;
  }

  const status = statusOf(subscription.status);
  const currentPeriodEnd = dateOf(subscription.next_billing_date);
  const cancelAtPeriodEnd = subscription.cancel_at_next_billing_date ?? false;

  await billingRepository.upsertSubscription({
    userId,
    dodoSubscriptionId: subscription.subscription_id,
    dodoCustomerId: customerId,
    dodoProductId: subscription.product_id ?? null,
    status,
    interval: intervalOf(subscription.payment_frequency_interval),
    currentPeriodEnd,
    cancelAtPeriodEnd,
    canceledAt: dateOf(subscription.cancelled_at),
  });

  if (customerId) {
    await billingRepository.setDodoCustomerId(userId, customerId);
  }

  // An entitled subscription clears the paywall lock; one that has genuinely
  // lapsed leaves the wall up. A scheduled cancellation (`cancel_at_next_
  // billing_date`) keeps access until the period actually ends.
  if (subscriptionIsEntitled({ status, cancelAtPeriodEnd, currentPeriodEnd })) {
    await billingRepository.unlockPaywall(userId);
    // Grant the period's AI credits (idempotent per subscription + period).
    await grantPlanCredits({
      userId,
      subscriptionId: subscription.subscription_id,
      interval: intervalOf(subscription.payment_frequency_interval),
      periodEnd: currentPeriodEnd,
    });
  } else {
    await billingRepository.lockPaywall(userId, "ai");
  }
}

/**
 * Retrieve a subscription from Dodo by id, verify it and mirror it. Used by the
 * post-checkout reconcile and the payment-event safety net, so the app is
 * correct even where webhooks cannot reach (e.g. local development).
 *
 * When `expectedUserId` is given the subscription is only applied if it resolves
 * to that user, so the reconcile endpoint can never write another account's row.
 */
export async function syncDodoSubscription(
  subscriptionId: string,
  expectedUserId?: string,
): Promise<{ userId: string | null; applied: boolean }> {
  const dodo = getDodo();
  if (!dodo) return { userId: null, applied: false };
  const subscription = await dodo.subscriptions.retrieve(subscriptionId);
  const userId = await resolveUserId(subscription);
  if (!userId) return { userId: null, applied: false };
  if (expectedUserId && userId !== expectedUserId) {
    return { userId, applied: false };
  }
  await applyDodoSubscription(subscription);
  return { userId, applied: true };
}

/** Resolve a payment to the subscription it started, then mirror that. */
export async function syncDodoPayment(
  paymentId: string,
  expectedUserId?: string,
): Promise<{ userId: string | null; applied: boolean }> {
  const dodo = getDodo();
  if (!dodo) return { userId: null, applied: false };
  const payment = await dodo.payments.retrieve(paymentId);
  const subscriptionId =
    payment.subscription_id ?? payment.subscription_ids?.[0] ?? null;
  if (!subscriptionId) return { userId: null, applied: false };
  return syncDodoSubscription(subscriptionId, expectedUserId);
}

/* -------------------------------------------------------------------------- */
/*  Credit packs (one-time payments)                                           */
/* -------------------------------------------------------------------------- */

/**
 * Create a Dodo Checkout Session for a one-time credit pack. Returns the hosted
 * URL, or `null` when billing is unconfigured or the pack has no product id.
 */
export async function createCreditCheckoutSession(input: {
  userId: string;
  email: string | null;
  name: string | null;
  pack: CreditPack;
  origin: string;
  existingCustomerId: string | null;
}): Promise<{ checkoutUrl: string | null }> {
  const productId = dodoCreditProductId(input.pack.id);
  const dodo = getDodo();
  if (!dodo || !productId) return { checkoutUrl: null };

  const customerId = await ensureDodoCustomer({
    userId: input.userId,
    email: input.email,
    name: input.name,
    existingCustomerId: input.existingCustomerId,
  });

  const session = await dodo.checkoutSessions.create({
    product_cart: [{ product_id: productId, quantity: 1 }],
    ...(customerId
      ? { customer: { customer_id: customerId } }
      : input.email
        ? { customer: { email: input.email } }
        : {}),
    metadata: { userId: input.userId, packId: input.pack.id, kind: "credits" },
    return_url: `${input.origin}/api/billing/return`,
    cancel_url: `${input.origin}/api/billing/return?status=cancelled`,
    customization: { theme: "dark" },
  });

  return { checkoutUrl: session.checkout_url ?? null };
}

/** Map a Dodo one-time product id back to its credit pack, if any. */
export function creditPackForProductId(
  productId: string | null | undefined,
): CreditPack | null {
  if (!productId) return null;
  for (const pack of CREDIT_PACKS) {
    if (dodoCreditProductId(pack.id) === productId) return pack;
  }
  return null;
}

/** Resolve the owning user for a one-time payment. */
async function resolveUserIdForPayment(
  payment: DodoPayments.Payment,
): Promise<string | null> {
  const metadataUserId =
    typeof payment.metadata?.userId === "string"
      ? payment.metadata.userId
      : null;
  if (metadataUserId) return metadataUserId;

  const customerId = payment.customer?.customer_id ?? null;
  if (!customerId) return null;
  const existingAccount =
    await billingRepository.findAccountByDodoCustomerId(customerId);
  return existingAccount?.userId ?? null;
}

/**
 * Grant credits for a successful one-time payment. The pack is resolved from the
 * payment's product id (authoritative) with the metadata pack id as a fallback,
 * so a dropped metadata field cannot lose a purchase. Idempotent on the payment
 * id.
 */
export async function grantCreditsFromPayment(
  payment: DodoPayments.Payment,
): Promise<boolean> {
  const productId = payment.product_cart?.[0]?.product_id ?? null;
  const metadataPackId =
    typeof payment.metadata?.packId === "string"
      ? payment.metadata.packId
      : null;
  const pack =
    creditPackForProductId(productId) ??
    (metadataPackId ? findCreditPack(metadataPackId) ?? null : null);
  if (!pack) return false;

  const userId = await resolveUserIdForPayment(payment);
  if (!userId) {
    console.error(
      "[billing] Dodo credit payment without a resolvable user",
      payment.payment_id,
    );
    return false;
  }

  const usdCents =
    typeof payment.total_amount === "number" && payment.total_amount > 0
      ? Math.round(payment.total_amount)
      : pack.usd * 100;

  return grantPurchaseCredits({
    userId,
    dodoPaymentId: payment.payment_id,
    packId: pack.id,
    usdCents,
    credits: pack.credits,
  });
}

/**
 * Retrieve a one-time payment and grant its credits. Used by the post-checkout
 * return so a credit purchase lands instantly even where webhooks cannot reach
 * (local development). Never trusts the redirect: the payment is re-fetched
 * server-side and checked against the signed-in user.
 */
export async function syncDodoCreditPayment(
  paymentId: string,
  expectedUserId?: string,
): Promise<{ applied: boolean }> {
  const dodo = getDodo();
  if (!dodo) return { applied: false };
  const payment = await dodo.payments.retrieve(paymentId);
  const userId = await resolveUserIdForPayment(payment);
  if (expectedUserId && userId && userId !== expectedUserId) {
    return { applied: false };
  }
  const applied = await grantCreditsFromPayment(payment);
  return { applied };
}
