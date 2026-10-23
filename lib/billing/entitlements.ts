import "server-only";

import {
  freeMailSendLimit,
  freeMailViewLimit,
  isDodoConfigured,
  isPaywallGatedEmail,
  paywallGatedEmails,
} from "@/lib/env";
import { billingRepository } from "@/lib/repositories/billing";
import { getCreditSummary } from "@/lib/billing/credits";
import { userRepository } from "@/lib/repositories/users";
import type { SubscriptionStatus } from "@/lib/db/schema";
import type { CreditUsage, Entitlement, PaywallReason } from "@/lib/billing/paywall-types";

export type { Entitlement, FreeUsage, PaywallReason } from "@/lib/billing/paywall-types";

/**
 * The single authority for "what is this user allowed to do".
 *
 * A subscription is `active` or `trialing`; everything else is free tier. A
 * free tier gets a lifetime allowance of `FREE_MAIL_VIEW_LIMIT` distinct
 * messages and `FREE_MAIL_SEND_LIMIT` outbound sends, and no AI at all.
 *
 * Every denial also *locks the paywall* server-side (`billing_accounts`), so
 * the wall is durable: it comes back on every reload until a subscription
 * clears it. Client state is never trusted for this.
 */

/** Dodo statuses that count as entitled. */
const ACTIVE_STATUSES = new Set<SubscriptionStatus>(["active", "past_due"]);

export function isActiveSubscriptionStatus(status: string | null | undefined): boolean {
  return Boolean(status && ACTIVE_STATUSES.has(status as SubscriptionStatus));
}

/**
 * Whether a mirrored subscription grants access right now.
 *
 * An `active` (or `past_due`, i.e. inside a grace period) subscription is
 * entitled. So is a subscription that has been cancelled but is scheduled to run
 * to the end of its paid period (`cancel_at_next_billing_date` with a future
 * `currentPeriodEnd`): the customer keeps what they paid for until it lapses.
 * Everything else — `on_hold`, `paused`, `failed`, `expired`, a past deadline —
 * is not.
 */
export function subscriptionIsEntitled(subscription: {
  status: string | null | undefined;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: Date | string | null;
}): boolean {
  if (isActiveSubscriptionStatus(subscription.status)) return true;
  if (!subscription.cancelAtPeriodEnd) return false;
  const end = subscription.currentPeriodEnd;
  if (!end) return false;
  const endMs = end instanceof Date ? end.getTime() : Date.parse(end);
  return Number.isFinite(endMs) && endMs > Date.now();
}

function clampRemaining(limit: number, used: number): number {
  return Math.max(limit - used, 0);
}

/**
 * The entitlement for an account that is exempt from the paywall. Reported as an
 * active subscriber so every gate (AI, mail reads, sends) and the UI wall treat
 * it as fully entitled, without writing a subscription row.
 */
function unrestrictedEntitlement(credits: CreditUsage): Entitlement {
  const viewsLimit = freeMailViewLimit();
  const sendsLimit = freeMailSendLimit();
  return {
    isSubscriber: true,
    status: "active",
    interval: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    paywallLocked: false,
    paywallReason: null,
    free: {
      mailViewsUsed: 0,
      mailViewsLimit: viewsLimit,
      mailViewsRemaining: viewsLimit,
      mailSendsUsed: 0,
      mailSendsLimit: sendsLimit,
      mailSendsRemaining: sendsLimit,
    },
    credits,
    billingConfigured: isDodoConfigured(),
  };
}

/** Read-only entitlement snapshot. Does not mutate anything. */
export async function getEntitlement(userId: string): Promise<Entitlement> {
  const credits = await getCreditSummary(userId);

  // Paywall allowlist: when configured, only the listed accounts are gated.
  // Everyone else is exempt — no wall, no free-tier limits.
  if (paywallGatedEmails().length > 0) {
    const email = await userRepository.findEmailById(userId);
    if (!isPaywallGatedEmail(email)) return unrestrictedEntitlement(credits);
  }

  const [account, subscription, mailViewsUsed, mailSendsUsed] =
    await Promise.all([
      billingRepository.getAccount(userId),
      billingRepository.getSubscription(userId),
      billingRepository.countMailViews(userId),
      billingRepository.countMailSends(userId),
    ]);

  const status = (subscription?.status ?? "none") as SubscriptionStatus;
  const isSubscriber = subscriptionIsEntitled({
    status,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd,
    currentPeriodEnd: subscription?.currentPeriodEnd,
  });
  const viewsLimit = freeMailViewLimit();
  const sendsLimit = freeMailSendLimit();

  return {
    isSubscriber,
    status,
    interval: subscription?.interval ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    // Once subscribed the lock is meaningless; report false so the UI clears.
    paywallLocked: !isSubscriber && Boolean(account?.paywallLockedAt),
    paywallReason: (account?.paywallReason as PaywallReason | null) ?? null,
    free: {
      mailViewsUsed,
      mailViewsLimit: viewsLimit,
      mailViewsRemaining: clampRemaining(viewsLimit, mailViewsUsed),
      mailSendsUsed,
      mailSendsLimit: sendsLimit,
      mailSendsRemaining: clampRemaining(sendsLimit, mailSendsUsed),
    },
    credits,
    billingConfigured: isDodoConfigured(),
  };
}

/** Persist the paywall lock. Coalesced so the first trigger sticks. */
export async function lockPaywall(
  userId: string,
  reason: PaywallReason,
): Promise<void> {
  await billingRepository.ensureAccount(userId);
  await billingRepository.lockPaywall(userId, reason);
}

export type AiAccessResult =
  | { allowed: true; entitlement: Entitlement }
  | { allowed: false; entitlement: Entitlement };

/** AI is subscriber-only. On denial the paywall lock is persisted. */
export async function checkAiAccess(userId: string): Promise<AiAccessResult> {
  const entitlement = await getEntitlement(userId);
  if (entitlement.isSubscriber) return { allowed: true, entitlement };
  await lockPaywall(userId, "ai");
  return { allowed: false, entitlement };
}

export type MailViewResult = {
  allowed: boolean;
  /** The message had already been counted — no new allowance consumed. */
  alreadyViewed: boolean;
  entitlement: Entitlement;
};

/**
 * Consume one distinct mail view.
 *
 * A subscriber is always allowed. A free user is allowed while their distinct
 * count is under the limit; the insert is idempotent, so re-opening a message
 * is free. If the insert pushes the count over the cap it is rolled back, so a
 * denied open leaves usage untouched but still locks the paywall.
 */
export async function consumeMailView(
  userId: string,
  gmailMessageId: string,
): Promise<MailViewResult> {
  const before = await getEntitlement(userId);
  if (before.isSubscriber) {
    return { allowed: true, alreadyViewed: false, entitlement: before };
  }

  const inserted = await billingRepository.addMailView(userId, gmailMessageId);
  if (!inserted) {
    // Already counted earlier — a re-open, always allowed.
    return { allowed: true, alreadyViewed: true, entitlement: before };
  }

  const after = await getEntitlement(userId);
  if (after.free.mailViewsUsed > after.free.mailViewsLimit) {
    // Over the cap: undo the reservation and wall the user.
    await billingRepository.removeMailView(userId, gmailMessageId);
    await lockPaywall(userId, "mail_view");
    const entitlement = await getEntitlement(userId);
    return { allowed: false, alreadyViewed: false, entitlement };
  }

  return { allowed: true, alreadyViewed: false, entitlement: after };
}

/**
 * Whether a free user may open any further mail at all (used to cap a list
 * response). Subscribers and users under the cap get `true`.
 */
export async function mayViewMoreMail(userId: string): Promise<boolean> {
  const entitlement = await getEntitlement(userId);
  if (entitlement.isSubscriber) return true;
  return entitlement.free.mailViewsRemaining > 0;
}

export type MailSendReservation = {
  allowed: boolean;
  /** Present for a free user; release it if the send ultimately fails. */
  eventId: string | null;
  entitlement: Entitlement;
};

/**
 * Reserve one outbound send. A subscriber is always allowed and no row is
 * written. A free user gets an append-only reservation that is rolled back if
 * it would exceed the lifetime cap; the caller releases it if the actual send
 * fails, so a failed attempt costs the user nothing.
 */
export async function reserveMailSend(
  userId: string,
  kind: "send" | "reply",
): Promise<MailSendReservation> {
  const before = await getEntitlement(userId);
  if (before.isSubscriber) {
    return { allowed: true, eventId: null, entitlement: before };
  }

  if (before.free.mailSendsRemaining <= 0) {
    await lockPaywall(userId, "mail_send");
    return { allowed: false, eventId: null, entitlement: before };
  }

  const eventId = await billingRepository.recordMailSend({ userId, kind });
  const after = await getEntitlement(userId);
  if (after.free.mailSendsUsed > after.free.mailSendsLimit) {
    await billingRepository.removeMailSend(eventId);
    await lockPaywall(userId, "mail_send");
    return { allowed: false, eventId: null, entitlement: before };
  }

  return { allowed: true, eventId, entitlement: after };
}

/** Release a reservation after a failed send. */
export async function releaseMailSend(eventId: string | null): Promise<void> {
  if (!eventId) return;
  await billingRepository.removeMailSend(eventId);
}
