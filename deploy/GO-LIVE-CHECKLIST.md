# Tartly — Go-live configuration checklist

> **Purpose:** the exact values and external console actions still required
> before `https://tartly.in` can accept real customers and real payments.
>
> **Source of truth for current state:** [`DEPLOYMENT-TRACKER.md`](./DEPLOYMENT-TRACKER.md).
> **Procedure for the host:** [`DEPLOYMENT-GUIDE.md`](./DEPLOYMENT-GUIDE.md) and
> [`RUNBOOK.md`](./RUNBOOK.md).
>
> Last audited: **2026-10-26**. Never put secret values in this file.

---

## 1. Current state (verified 2026-10-26)

| Area | State |
| --- | --- |
| Public edge | ✅ `https://tartly.in` 200, TLS valid, `www` → apex 308 |
| Host | ✅ Hostinger KVM 2, 6 containers up, readiness 200 (`postgres up`, `redis up`) |
| Deployed image | `9e1f951` (host git HEAD `3f610d0`) |
| Database | ✅ Postgres 18 with 5 users, 5 connected accounts, 5 mailboxes |
| Backups | ✅ 6-hourly dump + verified R2 copy; restore drill passed |
| Assets | ✅ Cloudflare R2 (`tartly-assets`), CORS and presigned PUT verified |
| AI | ✅ OpenCode key configured, 2,000 calls/day global budget |
| Dodo Payments | 🔴 **test mode only** — no real charge can be made |
| Dodo webhook | 🔴 signing key empty; endpoint fails closed |
| Dodo credit packs | 🔴 no one-time product IDs |
| Google OAuth | 🟡 redirect URI works; publishing / verification / CASA must be confirmed |
| Google domain ownership | 🔴 no `google-site-verification` TXT record in DNS |
| Real-time Gmail | 🟡 Pub/Sub not configured (daily sync + on-open sync only) |
| External monitoring | 🔴 Healthchecks/UptimeRobot URLs empty |
| CSP | 🟡 report-only (hardening, not a purchase blocker) |

**Important:** the public site is already reachable and the paywall is active.
Dodo is in **test mode**, so a checkout currently does **not** move money. The
application now refuses production checkout unless live mode is fully
configured, so customers cannot accidentally receive a paid plan from a test
payment.

---

## 2. Hard blockers (must be true before charging customers)

### B1. Dodo live mode and live products

Dodo keeps test and live separate. A test key, test products, and test webhooks
do not work in live mode.

**Do in the Dodo dashboard (live mode):**

1. Switch the dashboard to **Live Mode**.
2. Complete account/business verification so live payments and payouts are
   enabled.
3. Create (or copy from test mode) these products, all in **USD**:
   - **Tartly Professional (Monthly)** — recurring, `$25.00` / month.
   - **Tartly Professional (Yearly)** — recurring, `$240.00` / year.
   - **Tartly Credits — Starter** — one-time, `$10.00`.
   - **Tartly Credits — Plus** — one-time, `$20.00`.
   - **Tartly Credits — Pro** — one-time, `$50.00`.
4. Create a **live API key** with the permissions the app needs.
5. Create a **live webhook endpoint**:
   - URL: `https://tartly.in/api/webhooks/dodo`
   - Events: all `subscription.*` events, plus `payment.succeeded` and
     `payment.failed`.
6. Copy the webhook signing secret.

**Set in the repo-root `.env` (the render source of truth):**

```dotenv
DODO_PAYMENTS_API_KEY=<live key>
DODO_PAYMENTS_WEBHOOK_KEY=<live webhook signing secret>
DODO_PAYMENTS_ENVIRONMENT=live_mode
DODO_LIVE_MODE_ENABLED=true
DODO_PRODUCT_MONTHLY=<live monthly product id>
DODO_PRODUCT_YEARLY=<live yearly product id>
DODO_PRODUCT_CREDITS_STARTER=<live starter product id>
DODO_PRODUCT_CREDITS_PLUS=<live plus product id>
DODO_PRODUCT_CREDITS_PRO=<live pro product id>
ALLOW_TEST_CHECKOUT_IN_PRODUCTION=false
```

Then:

```bash
node deploy/scripts/render-env.mjs https://tartly.in
npm run verify:dodo          # read-only: live flags, 5 products, webhook
# copy deploy/app.env + deploy/.env to the host, then recreate web/worker
```

**Verify with a real purchase** (small amount, then refund it):

```text
checkout → Dodo live checkout → return to /mail?billing=success
→ subscriptions row active
→ credits granted for the period
→ billing_webhook_events receives subscription.active and payment.succeeded
→ Settings → Billing shows the plan and renewal date
→ Customer portal opens and can cancel
```

SQL check:

```sql
select event_type, count(*), max(created_at)
from billing_webhook_events
group by 1 order by 3 desc;

select status, interval, current_period_end
from subscriptions
order by created_at desc;
```

> The three existing Dodo subscriptions are **test-mode** records from
> 2026-10-13/24. They are not revenue. Do not treat them as live customers;
> live subscribers start with a new live checkout.

### B2. Google OAuth publishing and verification

Sign-in currently works for the accounts on the project, but that does not
prove new customers can sign in. Check **Google Cloud Console → APIs & Services
→ OAuth consent screen**:

- **Publishing status must not be `Testing`.** In Testing, only listed test
  users can sign in, and refresh tokens expire after 7 days.
- Add the production origin/redirect if not already present:
  - Authorized JavaScript origin: `https://tartly.in`
  - Authorized redirect URI: `https://tartly.in/api/auth/callback/google`
- Set the consent-screen fields exactly:
  - App name `Tartly`
  - Homepage `https://tartly.in`
  - Privacy policy `https://tartly.in/privacy`
  - Terms `https://tartly.in/terms`
  - Authorized domain `tartly.in`
- Because the app requests `gmail.modify` and `https://mail.google.com/`, the
  app needs **restricted-scope verification and an annual CASA assessment**.
  Until that is approved, expect the unverified-app warning and the OAuth user
  cap. Plan the public launch around this timeline.

The full submission pack is in
[`docs/google-oauth-verification.md`](../docs/google-oauth-verification.md).

### B3. Google domain ownership

Google will not approve verification until it can see a verified owner of the
homepage domain.

1. Search Console → **Add property → Domain** → `tartly.in`.
2. Add the `google-site-verification=…` TXT record at Hostinger.
3. Verify in Search Console, then submit the OAuth consent screen.

Current DNS has SPF (`v=spf1 include:_spf.mail.hostinger.com ~all`) and
Hostinger MX, but **no** Google verification TXT record. Do not remove SPF, MX
or DKIM.

### B4. Deploy the verification-ready build

The pending tree removes invented social proof and Outlook claims, adds the
in-product Google privacy notice, fixes the support address, and adds the
production checkout guard. Deploy it as a clean tag (see §5).

---

## 3. Strongly recommended before launch (not purchase blockers)

### R1. External monitoring and alerting

Create:

| Check | Period | Grace | Pinged by |
| --- | --- | --- | --- |
| Tartly readiness | 1 minute | 2 minutes | `/opt/tartly/deploy/scripts/healthcheck.sh` |
| Tartly Postgres backup | 6 hours | 1 hour | `backup-postgres.sh` |

Put the URLs in `/etc/tartly/backup.env` as `HEALTHCHECKS_URL` and
`HEALTHCHECKS_BACKUP_URL` (mode `0600`), then run one manual backup. Add an
independent external uptime monitor on `https://tartly.in/api/health/ready`.

### R2. Real-time Gmail (Pub/Sub)

Without `GOOGLE_PUBSUB_TOPIC`, new mail is processed by the daily safety-net
cron or when a user opens the inbox. The operator still works, but it is not
push-driven. Enable it when you want true real-time triage/autopilot:

```bash
gcloud pubsub topics create gmail-inbox
gcloud pubsub topics add-iam-policy-binding gmail-inbox \
  --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
  --role=roles/pubsub.publisher

gcloud pubsub subscriptions create gmail-push \
  --topic=gmail-inbox \
  --push-endpoint=https://tartly.in/api/webhooks/gmail \
  --push-auth-service-account=<push-sa>@<project>.iam.gserviceaccount.com
```

Then set:

```dotenv
GOOGLE_PUBSUB_TOPIC=projects/<project>/topics/gmail-inbox
GOOGLE_PUBSUB_AUDIENCE=https://tartly.in/api/webhooks/gmail
```

Re-render, copy, recreate web/worker, and send a test email.

### R3. Gmail API quota

The daily backfill has logged `GmailApiError 403 rateLimitExceeded` for some
accounts. It is not a 5xx and does not stop the app, but confirm the Gmail API
quota and watch it after the founder reconnects. If it persists at low volume,
raise the project quota or reduce the backfill page size.

### R4. CSP enforce

`CSP_MODE=report` in production. No `csp.violation` lines were found in the last
7 days while users were active. After one signed-in smoke test, set
`CSP_MODE=enforce`, re-render, recreate web/worker, and verify the header
changes from `content-security-policy-report-only` to
`content-security-policy`.

### R5. Email-body lifecycle and AI concurrency

At 5 users these are not launch blockers, but they are required before roughly
5,000 active users. The schema currently keeps full message bodies; see
`DEPLOYMENT-TRACKER.md` A8/A15 for the 90-day hot-window and archive plan.

### R6. Support mailbox

`support@tartly.in` is used by the landing page, privacy policy, terms and
Dodo. Confirm the Hostinger mailbox exists, is monitored, and can receive mail
before publishing it to customers.

### R7. Legal pages

The Terms describe fees but not renewal/cancellation mechanics or the payment
processor. Before taking live payments, confirm the refund policy and add the
Dodo Payments merchant-of-record language if that is the commercial model you
want. Do not invent a refund window you do not intend to honour.

---

## 4. Environment matrix after go-live

These are the values that must differ from today. Everything else (core app,
R2, AI, cron secret, `BETTER_AUTH_SECRET`, R2, Postgres) is already configured.

| Variable | Production value | Where |
| --- | --- | --- |
| `DODO_PAYMENTS_API_KEY` | live key | root `.env` |
| `DODO_PAYMENTS_WEBHOOK_KEY` | live signing secret | root `.env` |
| `DODO_PAYMENTS_ENVIRONMENT` | `live_mode` | root `.env` |
| `DODO_LIVE_MODE_ENABLED` | `true` | root `.env` |
| `DODO_PRODUCT_MONTHLY` | live product id | root `.env` |
| `DODO_PRODUCT_YEARLY` | live product id | root `.env` |
| `DODO_PRODUCT_CREDITS_STARTER` | live product id | root `.env` |
| `DODO_PRODUCT_CREDITS_PLUS` | live product id | root `.env` |
| `DODO_PRODUCT_CREDITS_PRO` | live product id | root `.env` |
| `ALLOW_TEST_CHECKOUT_IN_PRODUCTION` | `false` | root `.env` |
| `GOOGLE_PUBSUB_TOPIC` | optional, real-time | root `.env` |
| `GOOGLE_PUBSUB_AUDIENCE` | optional, real-time | root `.env` |
| `CSP_MODE` | `enforce` after smoke test | root `.env` |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | optional meta-tag fallback | build-time |

`NEXT_PUBLIC_*` values are baked at build time. Everything else is runtime.

---

## 5. Release procedure (agent-side)

```bash
# 1. Workstation: verify and commit a clean tag
npx tsc --noEmit
npm run lint
npm run test:unit
npm run build

git add -A
git commit -m "release: go-live readiness"
git tag <tag>
git push origin main --tags

# 2. Host: pull the clean tag (deploy key is configured)
ssh deploy@201.18.197.194
cd /opt/tartly && git pull --ff-only

# 3. Pre-deploy backup (mandatory)
cd deploy && ./scripts/backup-postgres.sh

# 4. Render app env from the repo-root .env on the workstation, copy both files
node deploy/scripts/render-env.mjs https://tartly.in
# scp deploy/app.env deploy/.env deploy@201.18.197.194:/opt/tartly/deploy/

# 5. Build, migrate, roll (on the host)
cd /opt/tartly && bash deploy/scripts/deploy.sh

# 6. Smoke
curl -sS https://tartly.in/api/health/ready
curl -sSI https://www.tartly.in | grep -i '^location'   # 308 -> apex
curl -sS -o /dev/null -w '%{http_code}\n' https://tartly.in/api/webhooks/dodo  # 400/405, never 5xx
```

**Rollback:** `cd /opt/tartly/deploy && ./scripts/rollback.sh` swaps the
current/previous tag and re-checks readiness. Migrations are forward-only; use
the pre-deploy dump for a destructive schema release.

---

## 6. Definition of done

- [ ] Live Dodo key, webhook key, live mode and all five product IDs configured.
- [ ] Real live payment succeeds; webhook row and entitlement/credits appear.
- [ ] Refund of that live test payment processed.
- [ ] Google consent screen is published for all users (not `Testing`).
- [ ] Search Console domain TXT record verified.
- [ ] Restricted-scope verification / CASA submitted (or accepted risk and user cap documented).
- [ ] Clean tag deployed; readiness 200; checkout 503 no longer (it succeeds).
- [ ] Healthchecks readiness + backup heartbeat firing; external uptime monitor live.
- [ ] Support mailbox monitored.
- [ ] Rollback target recorded in the tracker.

---

## 7. What is intentionally not required to take the first customers

- Outlook / Microsoft Entra (`MICROSOFT_*` blank; Outlook is hidden).
- Gmail Pub/Sub — real-time is better, but daily sync + on-open sync works.
- ImageKit videos — endpoint set and optional.
- Semantic search, campaigns, attachment scanning — feature-gated off.
- GHCR CI/CD — on-host build works and is documented.
- 10k-user capacity work — first node target is ~1-2k peak sessions.
