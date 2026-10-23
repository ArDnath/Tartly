import { NextResponse } from "next/server";
import type DodoPayments from "dodopayments";

import {
  applyDodoSubscription,
  constructDodoWebhookEvent,
  grantCreditsFromPayment,
  syncDodoSubscription,
  type DodoWebhookEvent,
} from "@/lib/billing/dodo";
import { billingRepository } from "@/lib/repositories/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/dodo — the authoritative subscription feed.
 *
 * The raw body is verified against the webhook signing key with
 * `webhooks.unwrap()` (Standard Webhooks: the signature covers
 * `webhook-id.webhook-timestamp.raw-body`); an unverified event is rejected, so
 * this endpoint cannot be used to grant a subscription. Deliveries are
 * deduplicated by the unique `webhook-id` header, and the idempotency claim is
 * released if handling throws so Dodo's retry is processed.
 *
 * This route is intentionally outside `withUser`: it is called by Dodo, not a
 * signed-in browser.
 */
export async function POST(request: Request): Promise<Response> {
  const webhookId = request.headers.get("webhook-id");
  const signature = request.headers.get("webhook-signature");
  const timestamp = request.headers.get("webhook-timestamp");
  if (!webhookId || !signature || !timestamp) {
    return NextResponse.json(
      { error: "Missing webhook headers" },
      { status: 400 },
    );
  }

  let event: DodoWebhookEvent;
  try {
    event = constructDodoWebhookEvent(await request.text(), {
      "webhook-id": webhookId,
      "webhook-signature": signature,
      "webhook-timestamp": timestamp,
    });
  } catch (error) {
    console.error(
      "[dodo-webhook] signature verification failed",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Claim the delivery atomically. A redelivery loses the insert and is
  // acknowledged without side effects.
  const firstDelivery = await billingRepository.markWebhookEventProcessed(
    webhookId,
    event.type,
  );
  if (!firstDelivery) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await handleEvent(event);
  } catch (error) {
    // Release the claim so the retry Dodo triggers actually applies.
    await billingRepository.removeWebhookEvent(webhookId).catch(() => {});
    console.error(
      "[dodo-webhook] handler failed",
      event.type,
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleEvent(event: DodoWebhookEvent): Promise<void> {
  // Every subscription lifecycle event carries the full, latest subscription
  // snapshot, so they all reduce to the same idempotent mirror.
  if (event.type.startsWith("subscription.")) {
    await applyDodoSubscription(event.data as DodoPayments.Subscription);
    return;
  }

  // Access is granted by `subscription.active`, not by payment events. For a
  // subscription payment we still reconcile as a safety net (e.g. a delayed
  // subscription event). A one-time payment with a credit product grants
  // credits (idempotent on the payment id).
  if (event.type === "payment.succeeded") {
    const payment = event.data as DodoPayments.Payment;
    await grantCreditsFromPayment(payment);
    const subscriptionId =
      payment.subscription_id ?? payment.subscription_ids?.[0] ?? null;
    if (subscriptionId) await syncDodoSubscription(subscriptionId);
    return;
  }

  if (event.type === "payment.failed") {
    const payment = event.data as DodoPayments.Payment;
    const subscriptionId =
      payment.subscription_id ?? payment.subscription_ids?.[0] ?? null;
    if (subscriptionId) await syncDodoSubscription(subscriptionId);
    return;
  }

  // Other event types are acknowledged but need no handling.
}
