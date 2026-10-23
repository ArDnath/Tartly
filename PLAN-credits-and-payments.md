# Tartly — Payments, Credits & AI Profit Plan

**Status:** **shipped** (schema migrated; unit tests + build green) · **Owner:** CEO/eng · **Rule:** additive, production-ready.

This is the working spec for turning the paywall into a production payment + credit
system and squeezing maximum margin out of the AI.

## Decisions (CEO call)

1. **Subscription stays the gate; credits become the meter.**
   - Professional ($25/mo, $20/mo billed yearly) is the only way to unlock AI + unlimited mail.
   - Every subscriber gets a **monthly credit grant**; the AI *spends* credits per token.
   - A subscriber whose credits run out can **buy top-up credit packs** at any time.
2. **Credit margin = 50%+ (configurable).**
   - `1 credit = $0.01` of retail AI value.
   - A purchase grants `paid × 100 × (1 − margin)` credits. With `margin = 0.5`, **$20 → 1000 credits ($10)**.
   - The retail token rate is deliberately above our raw DeepSeek cost, so the *effective*
     margin is higher than 50%; the customer-facing value is what is halved.
3. **Model = DeepSeek V4** (the cheapest capable family on the OpenCode gateway).
   - `fast` → `deepseek-v4-flash`, `standard` → `deepseek-v4.1-flash`, `reasoning` → `deepseek-v4-pro`.
   - A fallback chain keeps the app up if one model is unavailable.
4. **Web search is a per-turn agent toggle** in the composer. Off by default keeps requests
   small; on unlocks the `search_web` / `open_web_page` / `research_*` tools (Tavily-backed).
5. **No dev test mode.** The paywall test button, dev cookie, dev auto-unlock and the
   simulation checkout are removed from the production surface.

## What ships

| Area | Change |
|---|---|
| Paywall | Remove dev test mode (button, cookie, dev unlock, `paywall-store` dev flags). |
| Checkout | Live Dodo only; **month/year toggle inside the checkout UI**. |
| Return | Dodo `return_url`/`cancel_url` hit `/api/billing/return`, which reconciles then **immediately redirects to `/mail`** (success or failure). |
| Credits | `credit_wallets` + `credit_ledger` + `credit_purchases`; grant on subscription and on credit-pack payment; spend on every AI call. |
| Meter | Credit meter in the app chrome (sidebar), fed by `/api/billing/status`. |
| Top-ups | `/api/billing/credits/checkout` → Dodo one-time payment → webhook grants credits; "Buy credits" dialog. |
| Model | DeepSeek V4 defaults + fallback chains. |
| Web search | Composer toggle → `webSearch` body flag → research tools included/excluded. |

See `PLAN-production-hardening.md` for repo conventions (Drizzle migrations, `lib/env.ts`, `.env.example`).
