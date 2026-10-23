# 2026-10-14 — Replace Stripe with Dodo Payments (test mode)

## What changed

The entire payment layer was Stripe-specific (Stripe SDK, Embedded Checkout,
Stripe price ids, Stripe customer/portal/webhook). It is replaced end to end by
Dodo Payments (Merchant of Record), running against the Dodo **test** host.

- **SDK.** `stripe`, `@stripe/stripe-js` and `@stripe/react-stripe-js` are
  removed; `dodopayments` is added. `lib/billing/stripe.ts` is deleted and
  replaced by `lib/billing/dodo.ts` (lazy client, hosted checkout session,
  customer portal, subscription mirror, typed webhook verification).
- **Checkout.** `POST /api/billing/checkout` creates a Dodo Checkout Session and
  returns a single-use hosted `checkoutUrl`; `/checkout` redirects the browser to
  Dodo's PCI-compliant page and returns to `/pricing/success`. The API key never
  reaches the browser and no card data touches our origin.
- **Return-URL reconcile.** `POST /api/billing/sync` re-fetches the subscription
  or payment from Dodo server-side using the id from the redirect, confirms it
  belongs to the signed-in user, and mirrors it. The redirect itself is never
  trusted; this is what makes the flow work where a webhook cannot reach (local
  dev), while webhooks stay authoritative in production.
- **Webhooks.** `POST /api/webhooks/dodo` verifies the Standard Webhooks
  signature with `webhooks.unwrap()` against the raw body, dedupes on the unique
  `webhook-id` (claim released on failure so retries apply), and mirrors every
  `subscription.*` event. `payment.succeeded`/`payment.failed` reconcile their
  subscription as a safety net.
- **Customer linking.** A Dodo customer is created once (get-or-create by email)
  and stored on `billing_accounts.dodo_customer_id` before checkout, so
  subscription events resolve to the user even when session metadata is not
  copied onto the subscription.
- **Schema.** `stripe_customer_id` → `dodo_customer_id`,
  `stripe_subscription_id` → `dodo_subscription_id`, `stripe_price_id` →
  `dodo_product_id`; indexes renamed to match. New `billing_webhook_events`
  table for idempotency. Statuses now mirror Dodo (`pending`, `active`,
  `past_due`, `on_hold`, `paused`, `cancelled`, `failed`, `expired`).
- **Entitlement.** `subscriptionIsEntitled()` treats `active`/`past_due` as
  entitled and keeps access for a scheduled cancellation until `currentPeriodEnd`
  passes.
- **CSP.** Stripe script/frame/connect/image hosts removed; Dodo is a top-level
  redirect, so no origin allowances are needed.
- **Env.** `STRIPE_*` keys are replaced by `DODO_PAYMENTS_API_KEY`,
  `DODO_PAYMENTS_WEBHOOK_KEY`, `DODO_PAYMENTS_ENVIRONMENT`,
  `DODO_PRODUCT_MONTHLY`, `DODO_PRODUCT_YEARLY`, `DODO_LIVE_MODE_ENABLED`.

## Security posture

- The environment is pinned to `test_mode` unless **both**
  `DODO_PAYMENTS_ENVIRONMENT="live_mode"` and `DODO_LIVE_MODE_ENABLED="true"` are
  set; a missing/misspelled value can never reach the live API.
- A key that self-identifies as live (`dodo_live_…`) is refused while locked.
- Webhooks fail closed (400) without a signing key; an unverified event can never
  grant a subscription.
- Portal customer ids are resolved server-side from the signed-in user, never
  from the client.

## Not changed

- Plan pricing and the free-tier allowances ($25/mo, $20/mo yearly; 5 views, 5
  sends lifetime).
- The paywall lock semantics, entitlement shape and all AI/mail gates.
- The simulation-mode fallback for local runs with no Dodo key.

## Follow-up (manual)

Set `DODO_PAYMENTS_WEBHOOK_KEY` from a Dodo webhook endpoint pointed at
`${BETTER_AUTH_URL}/api/webhooks/dodo` (events: `subscription.*`, `payment.*`).
Until then the success-page reconcile keeps checkout working end to end.
