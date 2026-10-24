# Tartly — Deployment Tracker

> **This is the state file. Read it before touching the server, and update it after every action.**
> A new agent session must be able to resume from §3 without asking the user to repeat anything.

| Field | Value |
| --- | --- |
| Last updated | **2026-10-24 09:12 UTC** |
| Environment | Production (first node) |
| Canonical origin | `https://tartly.in` |
| Host | `srv2076028.hstgr.cloud` · `201.18.197.194` · Mumbai 2 |
| Provider / plan | Hostinger KVM 2 — 2 vCPU, 8 GB RAM, 100 GB NVMe, 8 TB/mo |
| OS | Ubuntu 26.04.1 LTS (`resolute`), kernel 7.0.0-34 |
| Runtime | Docker 29.9.2 · Compose v5.6.1 · Caddy 2.11.7 |
| Deployed tag | `9e1f951` (clean tree; previous `d95dbb5`) |
| Host git HEAD | `9e1f951` (clean; matches the image) |
| Data | 4 users · 4 connected accounts · 4 mailboxes · 59 threads · 133 messages |
| Public traffic | **LIVE** — apex + www resolve here (TTL 300); Let's Encrypt valid to 2027-01-21; readiness 200 over HTTPS |
| Deployment guide | [`DEPLOYMENT-GUIDE.md`](./DEPLOYMENT-GUIDE.md) |
| Ops runbook | [`RUNBOOK.md`](./RUNBOOK.md) |

---

## 0. Paste this into a new agent session

```text
You are taking over the Tartly production deployment on Hostinger VPS
201.18.197.194 (srv2076028.hstgr.cloud).

FIRST, before any command:
1. Read deploy/DEPLOYMENT-TRACKER.md in full.
2. Read deploy/DEPLOYMENT-GUIDE.md (at least the stage you are about to run).
3. Read deploy/RUNBOOK.md for day-2 operations.

HARD RULES
- Never print, echo, or commit secrets. deploy/app.env and deploy/.env are 0600.
- Never run destructive commands without explicit user approval:
  `docker compose down -v`, `DROP DATABASE`, restore, secret rotation, DNS changes.
- Only SSH as `deploy` (key-only). Root login by password is disabled.
- Change one thing, verify it, then update this tracker. Do not improvise.
- If a step fails, stop, record the failure in §7, and follow the stage's
  failure-mode section in the guide.

RESUME PROTOCOL: run §3 of the tracker verbatim.
CURRENT BLOCKER: none for public HTTPS. Site is live on `9e1f951`.
LAST FIX: onboarding Gmail-connect redirected to `https://0.0.0.0:3000`
because routes used `request.nextUrl.origin`. Now uses
`lib/http/public-origin.ts` (`BETTER_AUTH_URL`). Verified 2026-10-24 09:01 UTC.
NEXT ACTION: founder completes Google sign-in → Gmail connect → onboarding on
`https://tartly.in` (reload `/onboarding` if the old tab is stuck). That unblocks
CSP enforce and the R2 UI smoke test. Then founder-gated items: Dodo webhook key
+ test payment, Healthchecks/R2 monitoring URLs, Pub/Sub topic if in scope.
Agent-side work remaining: email-body retention (A8) and AI/SSE
concurrency caps (A15).
```

---

## 1. Status legend

| Marker | Meaning |
| --- | --- |
| ✅ | Done and verified (evidence in §7) |
| 🟡 | Partially done — works, but a hardening/ops gap remains |
| ⛔ | Blocked on an external actor (DNS, Google, user decision) |
| ⬜ | Not started |
| 🔴 | Decision required from the user |
| ⚠️ | Known risk accepted for now — see §6 |

---

## 2. Stage board

> **Two numbering systems, on purpose.** This board is a *status view* of
> workstreams. `DEPLOYMENT-GUIDE.md` numbers the *procedural stages* 0–15. Use
> the guide to execute and this board to report. When they disagree about
> status, the board wins.

| # | Stage | Status | Gate / evidence | Blocker |
| --- | --- | --- | --- | --- |
| 0 | Context, architecture, SLOs | ✅ | Guide §1–2 | — |
| 1 | Prerequisites & accounts | 🟡 | Domain bought; Google/Dodo accounts exist | R2 not created |
| 2 | Host bootstrap (OS, Docker, swap, sysctl) | ✅ | `bootstrap.sh` exit 0, 2026-10-23 07:38 | — |
| 3 | SSH hardening (key-only) | ✅ | `sshd -T`: `passwordauthentication no` | — |
| 4 | Firewall, fail2ban, upgrades, time | ✅ | UFW active; 22/80/443 only; fail2ban 0 banned | — |
| 5 | Secrets & environment | ✅ | `app.env` 46 vars, 0600; rendered file hash matches the server byte-for-byte; `BETTER_AUTH_SECRET` now 32 chars (high-entropy, no boot warning); autopilot/assets flags explicit | remaining launch keys are feature-gated (see A12) |
| 6 | Postgres 18 + Redis + Upstash shim | ✅ | both healthy; ready=200 | — |
| 7 | Image build (web + worker) | ✅ | tag `9e1f951`; clean tree; web-1/web-2 healthy | — |
| 8 | Migrations (26) | ✅ | `db:migrate` complete (no-op on `9e1f951` release) | — |
| 9 | Data cutover from Neon | ✅ | counts match source (3/3/3/4/4); live data now 4/4/4/59/133 | — |
| 10 | Rolling release (2 web replicas) | ✅ | `9e1f951` 09:09 UTC; web-1/web-2 healthy, worker started, ready 200 | — |
| 11 | Backup + restore drill | ✅ | offsite dump in R2 + SHA-256 match; scratch restore 1 s, counts 3/3/3/4/4 | — |
| 12 | DNS → this host | ✅ | apex + www `201.18.197.194`, TTL 300; verified 2026-10-23 19:11 UTC | — |
| 13 | TLS / Caddy / HTTP-3 | ✅ | LE cert notAfter 2027-01-21; HTTP/2 200; www→apex 308; `alt-svc: h3` | — |
| 14 | Google OAuth redirect URIs | 🟡 | Google login page returns 200 for the production client with no `redirect_uri_mismatch`; console allow-list is in place. **Onboarding return bug fixed in `d95dbb5`** (was redirecting to `https://0.0.0.0:3000/onboarding`). End-to-end sign-in + consent screen + Gmail connect still need the founder | founder login |
| 15 | Dodo webhook + live/test payment | ⬜ | `DODO_PAYMENTS_WEBHOOK_KEY` empty (route 400, fails closed) | keys |
| 16 | R2 asset storage + CORS | ✅ | driver `s3`; `npm run verify:r2` passed PUT/HEAD/GET/DELETE + CORS 204 + presigned PUT 200 against `tartly-assets`; authenticated UI upload is an optional founder smoke test | — |
| 17 | Offsite backups (R2) | 🟡 | 6-hourly cron + manual run verified in `r2:tartly-backups/postgres/`; `HEALTHCHECKS_*` still empty | Healthchecks URLs |
| 18 | External monitoring / alerts | 🟡 | local `healthcheck.sh` every minute now covers readiness + disk 60/75/85 + RAM 80/90 + cert <30/<14 d; **no external heartbeat or uptime monitor** (`HEALTHCHECKS_*` empty) | user |
| 19 | Security audit & dependency scan | 🟡 | host hardened; `npm audit --omit=dev` re-run 2026-10-24: 23 (7 high). Direct `zod` HIGH patched in `9e1f951`; `linkify-it` not reachable; `undici`/`@vercel/blob` chains accepted (trusted upstream, blob driver unused); web image 1 CRITICAL (`zlib1g` will_not_fix); worker 4 (Go stdlib inside esbuild — dev tool) | accepted / document |
| 20 | Performance baseline (k6) | 🟡 | off-box edge smoke recorded (§7.1); authenticated 400 RPS / 2k SSE baseline still needs a dedicated Google test account | test account |
| 21 | CI/CD (GHCR + Actions) | ⬜ | deploys are rsync + on-host build; host Git deploy key now works | — |
| 22 | Scale plan (10k users → 1M RPS) | ✅ | guide §2.7, §6.9, §16.2b; decisions D11–D14 | — |
| 23 | 10k-user capacity + storage lifecycle | 🟡 | `body_text` capped 64 KiB / `body_html` 128 KiB at ingest (5 tests); 90-day archive/re-fetch still not implemented (A8) | retention job |
| 24 | Clean git baseline / reproducible deploy | ✅ | `9e1f951` image from clean tree; host HEAD `9e1f951`; host deploy key authenticates to GitHub | — |

**Launch gate:** stages 12, 13, 14 (console) and 16 are ✅ and the site is already serving. The remaining stage-14 step is the founder's real sign-in + Gmail connect, which also gates CSP enforce.

---

## 3. Resume protocol (run in order)

```bash
# 1. Reachability + identity
ssh -o BatchMode=yes deploy@201.18.197.194 'hostname; uptime -p'

# 2. Container state
ssh deploy@201.18.197.194 'cd /opt/tartly/deploy && docker compose --env-file .env ps'

# 3. Readiness (DB + Redis inside the app)
ssh deploy@201.18.197.194 'cd /opt/tartly/deploy && \
  docker compose --env-file .env exec -T web-1 \
  node -e "fetch(\"http://127.0.0.1:3000/api/health/ready\").then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)})"'

# 4. Recent errors (ignore Better Auth secret warning until rotated)
ssh deploy@201.18.197.194 'cd /opt/tartly/deploy && \
  docker compose --env-file .env logs --since 30m web-1 web-2 worker caddy 2>&1 \
  | grep -iE "error|fatal|panic" | tail -20'

# 5. Capacity + disk
ssh deploy@201.18.197.194 'free -h; df -h /; docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"'

# 6. DNS + public edge
node -e "require('dns').promises.resolve4('tartly.in').then(console.log)"   # 201.18.197.194
curl -sS https://tartly.in/api/health/ready                                  # 200 + postgres/redis up
curl -sSI https://www.tartly.in | grep -i '^location'                       # 308 -> apex

# 7. Then read §4 and execute the first unchecked action.
```

**Do not** rebuild or recreate containers without first re-rendering from the root `.env` (see §5). Caddy is already live; a DNS regression is a stop condition.

---

## 4. Next actions (ordered, critical path first)

### A1 — Start TLS after DNS ✅
**Owner:** agent · **Done:** 2026-10-23 09:44 UTC. DNS returned `201.18.197.194` for apex and www, Caddy started, ACME issued both certificates on the first attempt.
**Verified:** HTTP/2 200; ready 200 (`postgres up`, `redis up`); HSTS present; HTTP/3 OK; www → apex **308** (Caddyfile changed from `permanent` (301) to explicit `308` and reloaded).
```bash
curl -sSI https://tartly.in | head -20
curl -sS  https://tartly.in/api/health/ready
curl -sSI https://www.tartly.in | grep -i '^location'
openssl s_client -connect tartly.in:443 -servername tartly.in </dev/null 2>/dev/null | openssl x509 -noout -dates -issuer
```
**Expected:** `200` ready JSON; `308` www→apex; certificate issued by Let's Encrypt; HSTS present.

### A2 — Google OAuth redirect 🟡 → end-to-end verify
**Owner:** founder login · **Console state (verified 2026-10-23 19:39 UTC):** following `POST /api/auth/sign-in/social` → `accounts.google.com` returns **HTTP 200** with a "Sign in" page and no `redirect_uri_mismatch` / `invalid_client`. The allow-list entry for `https://tartly.in/api/auth/callback/google` is therefore live.
**Still needed:** a real sign-in and Gmail connect. If the consent screen is still in "Testing", only listed test users can complete it; publish the app or add the founder as a test user. Google verification is also what stops refresh tokens expiring after 7 days.
**Fixed 2026-10-24:** the Gmail-connect landing used to send the browser to
`https://0.0.0.0:3000/onboarding` after OAuth (the standalone bind address). It
now returns to `https://tartly.in`. Users parked mid-flow should reload
`https://tartly.in/onboarding` to continue.
```bash
curl -sS -o /dev/null -w '%{http_code}\n' 'https://tartly.in/api/auth/callback/google'   # 302/400, not 404
```

### A3 — Rotate `BETTER_AUTH_SECRET` ✅
**Owner:** agent · **Done:** before 2026-10-23 18:57 UTC (observed in the running `1d44127` containers; the 19-char value is gone).
**Evidence:** root `.env` and `app.env` both carry a 32-char, non-hex, high-entropy value; no Better Auth low-entropy warning in 24 h of logs; renders byte-identical to the server (`sha256 bc2b30df…`).
**Impact:** every Gmail/Outlook refresh token encrypted with the old secret is undecryptable, so connected users reconnect once. With 3 accounts this is expected; verify on the first real sign-in.
**Note:** if the founder did not approve this rotation, record it in writing here — do not rotate again.

### A3b — Patch critical runtime advisories ✅
**Owner:** agent · **Done:** 2026-10-23 10:12 UTC, tag `8453e0d`.
**What changed:** `next` 16.3.5 → 16.4.2 (critical RCE/SSRF advisories; `npm audit` criticals 2 → 0), non-breaking `npm audit fix` (dompurify, sharp, source-map-js), canonical `app/settings/[[...section]]` route required by Next 16.4 strict interception matching (shared section registry), and the Caddy www 308 fix.
**Evidence:** `tsc --noEmit` clean; 267/267 unit tests pass; web + worker images build; rolling deploy healthy; public ready 200; web-image CRITICALs 3 → 1 (`zlib1g`, Debian `will_not_fix`). Lint still reports one pre-existing error in untouched `components/marketing/landing/home-content.tsx` (`react-hooks/set-state-in-effect`) — recorded, not fixed in the security change.
**Rollback:** `.deploy/previous-tag` = `1d44127`; `./scripts/rollback.sh`.

### A4 — R2 asset storage ✅
**Owner:** user provides credentials · **Full procedure:** [`R2-SETUP.md`](./R2-SETUP.md).
**Verified 2026-10-23 19:37 UTC:** `ASSET_STORAGE_DRIVER=s3`, `ASSETS_ENABLED=true`, `ASSET_BLOB_ACCESS=private`, bucket `tartly-assets`. `npm run verify:r2` (from the workstation, using the repo-root `.env`) passed:
- `PUT` 200 → `HEAD` 200 (42 bytes) → `GET` 200 (bytes match) → `DELETE` 204
- CORS preflight 204 with `access-control-allow-origin: https://tartly.in`
- presigned `PUT` (signed like the browser, including `content-length`) 200
**Remaining (optional):** one signed-in upload from `/settings/assets` to confirm the authenticated finalize step; the storage path itself is proven.
**Note:** the app ships its own SigV4 signer (`lib/assets/storage.ts`); no AWS SDK is required in the runner image. The host has no npm outside the containers, so use rclone for backup verification (R2-SETUP §6).

### A5 — Offsite backups + monitoring 🟡
**Owner:** agent after R2 · **Full procedure:** [`R2-SETUP.md`](./R2-SETUP.md) §5.
**R2 (done 2026-10-23 19:03 UTC):** `/etc/tartly/backup.env` is filled (0600); `backup-postgres.sh` uploaded `tartly-20261023T190309Z.dump.zst` to `r2:tartly-backups/postgres/`; a re-download matched the local SHA-256 and passed `zstd -t`. A second 6-hourly cron dump landed at 19:07 UTC.
**Still missing:** `HEALTHCHECKS_URL` and `HEALTHCHECKS_BACKUP_URL` are empty (length 0), so no heartbeat fires. Create the two checks (readiness 1 min / backup 6 h + 1 h grace), add the ping URLs, then run `./scripts/backup-postgres.sh` once.
**Note:** the 2026-10-23 18:15 cron run logged `offsite disabled` before the credentials were in place; the 19:03 manual run is the first verified offsite copy.

### A6 — Commit the working tree ✅
**Owner:** agent · Done 2026-10-23 08:53 UTC. Two commits (`4dee51b` app snapshot, `633219b`/`83ccc5a` deploy docs), pushed to `ArDnath/Tartly`, fast-forwarded on the host via a git bundle, clean tag `83ccc5a` deployed. The pre-pull rsynced tree is retained as `stash@{0}` on the host.

### A7 — Performance baseline ⬜
**Owner:** agent · See guide §15. Record results here. No tuning before measurement.

### A8 — Email-body lifecycle 🟡
**Owner:** agent + user decision · **Why:** the schema stores full `bodyText` + `bodyHtml` per message (`lib/db/schema.ts:536–537`). Measured ~24–32 kB/message; at 10k users × 10–30 messages/day that is 3–10 GB/day, which fills 100 GB in weeks.
**Done 2026-10-23 19:24 UTC:** hard storage ceilings at ingest — `body_text` 64 KiB, `body_html` 128 KiB, cut on a line/tag boundary with a visible marker (`lib/gmail/body.ts`, wired in `lib/gmail/sync.ts`). 5 new unit tests; full suite 273/273; deployed as `f1ed59a`. This bounds the pathological multi-MB newsletter case, not the average.
**Still to implement before ~5k active users:**
1. Measure: `./scripts/capacity-report.sh` (DB size, per-row bytes, top tables) — done 2026-10-23 19:03 (13 MB DB, 24 kB/message).
2. Strip base64 inline images/tracking pixels at ingest (not done: stripping without R2 extraction would break inline images).
3. Keep a hot window (~90 days) in Postgres; archive older bodies to R2 or re-fetch from Gmail on thread open.
4. Alert at 60/75/85% disk and on DB size (healthcheck now logs 60/75/85; remote alert needs Healthchecks).
**Gate:** projected 90-day disk use < 60%.

### A9 — RPO ≤ 6 h 🟡
**Owner:** agent after R2 · **Why:** nightly dumps give a 24 h RPO, which is too much state to lose at 10k users.
**Do:** raise dump frequency to 6 h (cheap while the DB is small), or add WAL archiving (`pgBackRest`/WAL-G) to R2 for PITR. Reduce local retention to 2–3 d once the DB exceeds 5 GB.

**2026-10-23 10:13 UTC:** `/etc/cron.d/tartly` now runs `backup-postgres.sh` every 6 h (`15 */6 * * *`); cron reloaded. RPO is now ≤6 h **locally only** — offsite still needs R2 credentials, so a host loss still loses everything.

### A10 — GHCR + Actions ⬜
**Owner:** agent + user secrets · **Why:** on-host builds steal the same 2 vCPU that serves requests. Publish `web` and `worker` images to GHCR and let the host only pull + migrate + roll. Keep `deploy.sh` as the emergency fallback.

### A11 — Add the server deploy key ✅
**Owner:** user (GitHub) · **Done:** the key is now a read-only deploy key on `ArDnath/Tartly`; verified from the host on 2026-10-23 19:04 UTC:
```
ssh deploy@201.18.197.194 'ssh -T git@github.com'
# Hi ArDnath/Tartly! You've successfully authenticated, but GitHub does not provide shell access.
```
Future deploys are `git pull --ff-only && bash deploy/scripts/deploy.sh`. The host HEAD is `f1ed59a` and the deployed image is `f1ed59a`; the deploy key is now the primary path.

### A12 — Complete the launch env 🟡
**Owner:** user (values) + agent (apply) · **Source of truth is the repo-root `.env`**, not the server file. Edit it, run `node deploy/scripts/render-env.mjs https://tartly.in`, copy `deploy/app.env` + `deploy/.env` to the host, then recreate web/worker. Never paste secrets into chat.

**Verified correct (2026-10-23 09:20 UTC):** `DATABASE_URL` → `postgres:5432/tartly` and its password matches `.env`; Redis → `redis-http:80` and its token matches; `BETTER_AUTH_URL`/`PUBLIC_URL` → `https://tartly.in`; the client bundle contains `tartly.in` and zero `localhost:3000`; Dodo is `test_mode` with live disabled; CSP is report-only; contract validation is enforce. `TAG` is now the deployed tag, not `latest`.

> **TAG trap (found 2026-10-23 10:22 UTC):** `render-env.mjs` preserves `TAG` from the local `deploy/.env`. After every deploy, update the local `TAG` to the live tag *before* re-rendering, or copying the rendered `deploy/.env` to the host will silently point Compose at the previous image. Local and server `deploy/.env` now match (`TAG=f1ed59a`). Root `.env` origins were also corrected from `localhost:3000` to `https://tartly.in`; the renderer overrides them, but the stale values were a trap.

| Missing / weak | Where | Needed for | Owner |
| --- | --- | --- | --- |
| ~~`BETTER_AUTH_SECRET` 19 chars~~ **rotated to 32 chars** | root `.env` → render | security | ✅ done |
| `DODO_PAYMENTS_WEBHOOK_KEY` empty | root `.env` | paid orders → entitlements | user (Dodo dashboard) |
| ~~`S3_*` / `ASSET_STORAGE_DRIVER`~~ **wired** | root `.env` | uploads | ✅ done (UI smoke test pending) |
| `GOOGLE_PUBSUB_TOPIC`, `GOOGLE_PUBSUB_AUDIENCE` | root `.env` | real-time Gmail/Outlook sync | user (Google Cloud) |
| `AI_GLOBAL_DAILY_BUDGET`, `AI_DAILY_BUDGET`, `AGENT_MAX_TOKENS_PER_RUN` | root `.env` | platform cost ceiling | ✅ global 2,000/day; per-user default 500; 200k tokens/run |
| `DODO_PRODUCT_CREDITS_STARTER/PLUS/PRO` | root `.env` | credit packs | user (Dodo) |
| `MICROSOFT_CLIENT_ID/SECRET/TENANT_ID` + `NEXT_PUBLIC_MICROSOFT_CONNECT_ENABLED` | root `.env` + `deploy/.env` (build) | Outlook | user (Entra) |
| `NEXT_PUBLIC_CAL_BOOKING_LINK`, `NEXT_PUBLIC_BOOKING_URL`, `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | root `.env` | booking / SEO (optional) | user |
| `CSP_MODE=enforce` | root `.env` | security hardening | agent **after** the signed-in smoke test |
| `HEALTHCHECKS_URL`, `HEALTHCHECKS_BACKUP_URL` | `/etc/tartly/backup.env` | offsite heartbeat + alerting | user (A5) |
| ~~Deploy key~~ **added** | GitHub repo settings | `git pull` on the host | ✅ done |

**Deliberately empty and fine:** `DATABASE_REPLICA_URL` (no replica), `BLOB_READ_WRITE_TOKEN` (not using Vercel Blob), `ASSET_EXTRACT_KEY`/`CLAMAV_HOST` (scanning/extraction off), `AI_PROVIDER` (uses `AI_BASE_URL`/`OPENCODE_*`), `CAMPAIGNS_ENABLED`/`SEMANTIC_SEARCH_ENABLED` (ship off).

### A13 — Restore drill ✅
**Owner:** agent · **Done:** 2026-10-23 19:07 UTC. Took a fresh dump (`tartly-20261023T190729Z.dump.zst`, 104 KB), created a scratch database `tartly_restore_drill`, restored it with `pg_restore --single-transaction`, and verified `3 users / 3 accounts / 3 mailboxes / 4 threads / 4 messages` — identical to production. Restore took **1 s**; scratch DB dropped afterwards. Production was never stopped or written to.

### A14 — CSP enforce ⬜ (blocked on a signed-in smoke test)
**Owner:** agent after A2 · **Why wait:** the policy is currently `report`; the public marketing pages are intentionally skipped (static render cannot carry a nonce), so `/` will never show the header. The authenticated app pages (`/auth`, `/mail`, `/assistant`, `/settings`, `/billing`) do.
**Do:** with the founder signed in, open those pages and confirm zero `csp.violation` log lines for real flows, then set `CSP_MODE=enforce` in the root `.env`, re-render, copy, and recreate web/worker. Evidence: response header changes from `content-security-policy-report-only` to `content-security-policy`, and the flows still work.

### A15 — Email-body lifecycle + AI/SSE caps 🟡
**Owner:** agent · **Why:** two §16.2b preconditions. `messages.body_text`/`body_html` were stored unbounded; there is no global AI/SSE concurrency cap (only per-minute rate limits: 300 API / 20 agent / 30 asset).
**Done:** storage caps at ingest (A8) — `body_text` 64 KiB / `body_html` 128 KiB, deployed `f1ed59a`. `AGENT_MAX_TOKENS_PER_RUN` already has a 200k default; per-user AI budget defaults to 500 calls/day.
**Still to do:** (1) a 90-day hot window with archive/re-fetch; (2) strip base64 inline images without breaking rendering; (3) per-user stream cap (2–3) and global AI generation cap (50–100) with a queue; (4) founder sets `AI_GLOBAL_DAILY_BUDGET`. Do this as a tested code change, not an env tweak.

### A16 — Rollback drill ✅
**Owner:** agent · **Done:** 2026-10-23 19:32 UTC. `deploy/scripts/rollback.sh` now updates `.env`'s `TAG`, force-recreates web-1/web-2/worker, waits for both replicas to be healthy, verifies `/api/health/ready`, and **swaps** the current/previous pointers so the operation is reversible.
**Evidence:** `f1ed59a → 1d44127` (ready 200) → `1d44127 → f1ed59a` (ready 200). Production is back on `f1ed59a`; `.deploy/previous-tag` is `1d44127`.
**Note:** migrations are forward-only; this drill involved no schema change. A release with a destructive migration must use the pre-deploy dump instead.

### A17 — Onboarding redirect to `0.0.0.0:3000` ✅
**Owner:** agent · **Done:** 2026-10-24 08:59 UTC, tag `d95dbb5`.
**Symptom:** after Google sign-in → Gmail connect on `/onboarding`, the browser
landed on `https://0.0.0.0:3000/onboarding` and Firefox showed
`connectionFailure`. Reproduced from the Caddy access log:
`GET /api/onboarding/sync-email/complete` → `307 Location: https://0.0.0.0:3000/onboarding`
(2026-10-24 08:52:49 UTC).
**Root cause:** `const origin = request.nextUrl.origin` in the onboarding
completion route. The Next.js standalone server binds to `0.0.0.0:3000`, so
behind Caddy the framework-visible origin is the bind address, not the public
host. The same pattern was feeding Dodo checkout/portal return URLs.
**Fix:** `lib/http/public-origin.ts` derives the origin from `BETTER_AUTH_URL`
and is used by the onboarding completion route and all billing origin/return
paths. Unit test added.
**Verified:** `tsc --noEmit` clean; 276/276 unit tests; deployed clean tag
`d95dbb5`; `/api/onboarding/sync-email/complete` now → `307 https://tartly.in/auth`;
`/api/billing/return` → `307 https://tartly.in/mail?billing=…`; ready 200;
web-1/web-2 healthy.
**Rollback:** `./scripts/rollback.sh` → `f1ed59a` (reintroduces the bug).
**Still needed:** one real logged-in Gmail connect to confirm the browser stays
on `tartly.in` through the whole flow.

### A18 — Dependency re-audit (2026-10-24) 🟡
**Owner:** agent · **Why:** the advisory database changed since the 19:34 UTC run
on 2026-10-23, so the previous "2 high" number is stale.
**Result:** `npm audit --omit=dev` → **23 vulnerabilities (7 high, 9 moderate, 7 low)**.
- **Fixed now:** `zod` 4.6.5 → **4.6.7** — direct dependency, HIGH
  `GHSA-mrhx-c7xc-m3w5` (memory exhaustion on oversized constrained
  collections), reachable through request validation. Deployed in `9e1f951`
  with `tsc` + 276/276 tests + npm 10.9.9 lockfile check.
- **Accepted:** `linkify-it` via `ansi-to-react` (`linkify` stays off);
  `undici` 7.29.1 / 6.29.0 (only trusted HTTPS upstreams; no user-controlled
  response bodies); `@vercel/blob` → `@vercel/oidc` → nested `zod` (blob driver
  is unused in production — `ASSET_STORAGE_DRIVER=s3` / R2).
- **Dev-only:** `esbuild`, `drizzle-kit`, `vitest` (not in the runner image).
**Rule:** no `npm audit fix --force` on production; one tested bump per release.
**Cheap future win:** removing the unused `@vercel/blob` dependency would drop
the `@vercel/oidc`/`undici@6`/nested-`zod` chain. Do it as its own tested
release, not during an incident.

---

## 5. Decisions log

| # | Decision | Options | Default taken | Status |
| --- | --- | --- | --- | --- |
| D1 | Database location | local Postgres vs Neon | **local Postgres 18** (latency, cost) | ✅ |
| D2 | Postgres major | 16 / 17 / 18 | **18** — Neon is 18.6; pg_dump 17 cannot read it | ✅ |
| D3 | Redis | Upstash SaaS vs local + SRH shim | **local Redis + `serverless-redis-http`** | ✅ |
| D4 | Asset storage | Vercel Blob vs R2 vs MinIO | **R2** (user choice) — not yet configured | 🔴 |
| D5 | Edge | Caddy vs Nginx vs Traefik | **Caddy** (auto-TLS, HTTP/3, SSE-safe) | ✅ |
| D6 | Deploy mechanism | on-host build vs GHCR | **on-host build now**, GHCR later | 🟡 |
| D7 | Cloudflare proxy | DNS-only vs proxied | **DNS-only initially** (free plan 100 s cap truncates SSE) | ✅ |
| D8 | `BETTER_AUTH_SECRET` | preserve vs rotate | **rotated to a 32-char high-entropy value** before 18:57 UTC on 2026-10-23; connected mailboxes must reconnect once | ✅ |
| D9 | Hostinger daily backups | buy vs rely on dumps | rely on nightly dumps + weekly snapshot | 🟡 |
| D10 | Autopilot at launch | on vs off | **`AUTOPILOT_ENABLED=false` explicitly** — unset means allowed at the env level (per-mailbox policies still default off) | ✅ |
| D11 | Workload target | 10k users vs 10k concurrent RPS | **10k active users**: ~1–2k peak concurrent sessions, ≤400 API RPS. 10k simultaneous requests is Stage C, not this box | ✅ |
| D12 | Data placement at 10k | local vs managed Postgres/Redis | **local Postgres 18 + local Redis** until a trigger fires (guide §6.9: 2nd app node, DB >20 GB, CPU >60%, RPO <24 h) | ✅ |
| D13 | Email body storage | PG forever vs trim + archive | **trim HTML at ingest, ~90-day hot window, archive/re-fetch older bodies** — measured ~32 kB/message makes 100 GB the binding constraint | 🟡 |
| D14 | Backup RPO at 10k | 24 h dumps vs PITR | **24 h now; 6 h dumps or WAL/PITR before 10k users** | 🟡 |
| D15 | Deploy provenance | dirty rsync vs git tag | **clean tag `f1ed59a`**; host HEAD `f1ed59a`; host deploy key authenticates | ✅ |
| D16 | Launch feature defaults | implicit vs explicit | **`ASSETS_ENABLED=false` until R2 is configured; `AUTOPILOT_ENABLED=false`** | ✅ |
| D17 | Env source of truth | server `app.env` vs repo-root `.env` | **repo-root `.env` → `render-env.mjs` → copy `app.env` + `.env`**; never hand-edit the server | ✅ |
| D18 | AI/SSE concurrency at launch | global semaphore now vs after measurement | **ship with the existing guards** — 20 agent runs/min/user, 200k tokens/run, 500 calls/day/user, 5-min SSE lifetime — and add a global generation semaphore only when load/provider 429s show it is the constraint. Global daily ceiling is **2,000 calls** | 🟡 |
| D19 | Gmail Pub/Sub at launch | include vs defer | **defer** — launch with manual/periodic sync; do not half-configure the webhook. Revisit when the email operator is ready | ✅ |
| D20 | Absolute URL origin | `request.nextUrl.origin` vs env canonical origin | **`BETTER_AUTH_URL` via `lib/http/public-origin.ts`** — the standalone server's request origin is its bind address (`0.0.0.0:3000`), which broke onboarding and would break billing returns | ✅ |

---

## 6. Risk register

| Risk | Impact | Likelihood | Mitigation | Status |
| --- | --- | --- | --- | --- |
| ~~Weak `BETTER_AUTH_SECRET`~~ | session forgery / token decrypt risk | — | rotated to 32 chars; old tokens invalidated | ✅ |
| Single node | full outage on host failure | medium | 6-hourly dump + verified offsite copy + restore drill §7; scale plan §16 | ⚠️ |
| RPO 24 h | up to a day of data loss | — | cron every 6 h; local + R2 verified | ✅ |
| ~~Offsite backup disabled~~ | host loss = total loss | — | R2 upload + SHA-256 match verified 2026-10-23 19:03 | ✅ |
|~~Uploads disabled~~ **R2 verified** | core feature gap | — | storage path, CORS and presigned PUT verified; UI finalize optional | ✅ |
| Uncommitted deploy | rollback ambiguity | — | clean tag `f1ed59a`; previous-tag `1d44127`; host tree clean | ✅ |
| ~~Absolute redirects from bind address~~ | OAuth onboarding dead-ends at `https://0.0.0.0:3000`; checkout returns broken | — | fixed in `d95dbb5`: `lib/http/public-origin.ts` from `BETTER_AUTH_URL`; verified on the redirect boundary | ✅ |
| No external monitoring | silent outage | medium | `healthcheck.sh` runs, but `HEALTHCHECKS_*` empty and no uptime monitor | ⬜ |
| AI provider outage | drafts/chat fail | medium | fallback chain env + circuit breaker (code) | ⚠️ |
| Gmail OAuth verification | sign-in blocked for new users; refresh tokens expire after 7 days in Testing | medium | redirect URI accepted; publish the consent screen / add test users; verify end-to-end | 🟡 |
| DB connection exhaustion | 5xx under load | low | pools 8/8/4 vs 120 max; PgBouncer later | ✅ |
| Disk fill (logs/images) | outage | low | Docker log caps; 85/92% alerts | 🟡 |
| **Email-body growth vs 100 GB disk** | disk full → outage + failed backups | **high** | trim HTML, 90-day hot window, archive to R2; alerts at 60/75/85% (A8/A15) | 🔴 |
| 14 local dumps on the same disk | backup consumes the disk it protects | medium | R2 is now the backup of record; local retention is 3 days (currently 7 files because manual runs are preserved) | 🟡 |
| Unbounded AI/SSE concurrency | OOM, provider 429 storms | medium | **AI spend capped**: global 2,000 calls/day + per-user 500 + 200k tokens/run; per-minute agent limit 20; global generation semaphore deferred to measured 429s | 🟡 |
| Gmail/AI provider quotas at 10k | sync/send/draft failures | medium | quota math in guide §16.2b; backoff + fallback chain | ⬜ |
| Dodo webhook unverified | paid orders not activated | medium | configure before enabling live mode; `billing_webhook_events` is empty | ⬜ |
| Dodo API key may belong to the live environment | test checkout could 401/403, or a live key could be sent to the test host | medium | key is opaque (len 65, no `dodo_*` prefix); founder must confirm it is a **test** key in the dashboard before the payment test | ⬜ |
| **Critical runtime advisories (`next` 16.3.5 RCE, `dompurify` XSS)** | remote compromise / stored XSS | **high** while public | patched in `8453e0d`; re-scan of `1d44127` shows only Debian `zlib1g` `will_not_fix` + dev-only Go stdlib in esbuild | ✅ |
| `linkify-it` quadratic DoS via `ansi-to-react` | browser CPU spike on crafted terminal text | low | **not reachable**: `Ansi` defaults `linkify=false` and the only usage omits the prop; no runtime call path | ⚠️ |
| `zod` memory exhaustion (GHSA-mrhx-c7xc-m3w5) | DoS via oversized constrained collections in request validation | medium | **fixed** in `9e1f951`: direct `zod` 4.6.5 → 4.6.7; tsc + 276 tests | ✅ |
| `undici` DoS / SRI advisories (transitive) | upstream-response DoS; only on calls to configured AI/base URLs | low | comes via `ai`/`@ai-sdk` and `@vercel/blob`; endpoints are trusted HTTPS, blob driver unused (`ASSET_STORAGE_DRIVER=s3`); revisit in the next dependency refresh | ⚠️ |
| `@vercel/blob` → `@vercel/oidc` / CLI-config `zod` | tooling-only chain; blob driver unused in production | low | dynamic import only when `ASSET_STORAGE_DRIVER=blob`; R2/S3 is the live driver | ⚠️ |

---

## 7. Verification ledger

| UTC time | Action | Result | Evidence |
| --- | --- | --- | --- |
| 2026-10-23 07:38 | Host bootstrap | ✅ | UFW active; Docker 29.9.2; 4 GB swap; fail2ban active |
| 2026-10-23 07:41 | First release (`a14f782-dirty-20261023074103`) | ✅ | web-1/web-2 healthy; worker started |
| 2026-10-23 07:44 | Ready probe | ✅ | `200 {"status":"ready","postgres":"up","redis":"up"}` |
| 2026-10-23 07:47 | Postgres 17 → 18 + redeploy | ✅ | mismatch with Neon 18.6 resolved |
| 2026-10-23 07:48 | Neon → local import | ✅ | 26 migrations; 2 users / 2 accounts / 3 messages |
| 2026-10-23 07:49 | SSH key-only | ✅ | `passwordauthentication no`; password attempt denied |
| 2026-10-23 07:51 | Backup + restore drill | ✅ | 101 KB dump; restore returned 2/2/3 |
| 2026-10-23 08:18 | Snapshot | ✅ | all 6 containers up; UFW 22/80/443; fail2ban 0 banned |
| — | TLS | ⛔ | DNS apex `2.57.91.91` |
| — | Public HTTP | ⛔ | Caddy stopped by design |
| 2026-10-23 08:46 | Capacity audit | ✅ | RAM 1.3 GiB used / 6.4 GiB available; disk 16/96 GB; DB 13 MB; messages 96 kB for 3 rows (~32 kB/msg); all containers 0% CPU |
| 2026-10-23 08:53 | Pre-deploy backup | ✅ | 101 KB dump `tartly-20261023T085308Z.dump.zst` |
| 2026-10-23 08:53 | Clean rebuild + rolling release | ✅ | tag `83ccc5a`; web-1/web-2 healthy; worker started; Caddy skipped (DNS) |
| 2026-10-23 08:54 | Post-deploy readiness | ✅ | `200 {"status":"ready","postgres":{"up":34ms},"redis":{"up":23ms}}` |
| 2026-10-23 08:54 | Data counts | ✅ | 2 users / 2 accounts / 2 mailboxes / 3 threads / 3 messages |
| 2026-10-23 08:56 | Host state after deploy | ✅ | disk 22/96 GB (build cache 5.8 GB); all containers healthy/idle |
| 2026-10-23 09:22 | Env wiring audit | ✅ | PG `postgres:5432/tartly` + Redis `redis-http:80`; passwords/tokens match; client bundle has `tartly.in`, no `localhost` |
| 2026-10-23 09:24 | Launch defaults applied | ✅ | `AUTOPILOT_ENABLED=false`, `ASSETS_ENABLED=false`; `TAG=83ccc5a`; web-1/web-2 healthy, ready 200 |
| 2026-10-23 09:43 | Resume protocol | ✅ | host up 2h52m; 6 containers up; ready 200 (pg 10 ms, redis 7 ms); no error/fatal/panic in 30 m; RAM 1.6/7.7 GiB; disk 22/96 GB |
| 2026-10-23 09:43 | DNS cutover verified | ✅ | `resolve4('tartly.in')` and `www` both `201.18.197.194`; host public IP `201.18.197.194` |
| 2026-10-23 09:44 | Caddy started + ACME | ✅ | `certificate obtained successfully` for `tartly.in` and `www.tartly.in`; account `acct/3899380782` |
| 2026-10-23 09:44 | Public edge verification | ✅ | apex HTTP/2 `200`; HSTS `max-age=63072000`; ready `200` pg+redis up; HTTP/3 OK; http→https `308` |
| 2026-10-23 09:46 | www redirect corrected | ✅ | Caddyfile `permanent` (301) → explicit `308`; reloaded; `HTTP/2 308 location: https://tartly.in/` |
| 2026-10-23 09:49 | SSH/firewall re-audit | ✅ | UFW active (22/80/443 + 443/udp); fail2ban sshd 0 banned; `passwordauthentication no`, `permitrootlogin prohibit-password`; clock synced |
| 2026-10-23 09:50 | Dependency audit | 🔴 | `npm audit`: 38 (2 critical, 15 high). Critical: `next` RCE advisories, `dompurify` XSS. Prod-relevant highs: `sharp`, `source-map-js` |
| 2026-10-23 09:51 | Image scan (`83ccc5a`) | 🔴 | web `57` (56 H, 1 C) / worker `26` (25 H, 1 C); criticals include `next` GHSA-2464 (RCE) and Debian `zlib1g` (will_not_fix). Dev-only noise excluded from decisions |
| 2026-10-23 10:07 | Security patch tested | ✅ | `next@16.4.2`; `tsc --noEmit` clean; 267/267 unit tests pass; web + worker images build (local); `npm audit` criticals 2 → 0 |
| 2026-10-23 10:08 | Pre-deploy backup | ✅ | `tartly-20261023T100818Z.dump.zst` (104K), `zstd -t` ok |
| 2026-10-23 10:12 | Rolling release `8453e0d` | ✅ | migrations complete; web-1/web-2 healthy; worker up; Caddy reloaded; public ready 200 |
| 2026-10-23 10:12 | Post-patch public verify | ✅ | home 200 (HTTP/2), auth 200, www 308, api 404, Google callback 302, Dodo webhook 405 (route exists), CSP sink 204 |
| 2026-10-23 10:12 | Post-patch image scan | ✅ | web CRITICALs 3 → 1 (`zlib1g` CVE-2023-45853, `will_not_fix` in Debian base); no `next` criticals remain |
| 2026-10-23 10:13 | Backup cadence | ✅ | `/etc/cron.d/tartly` backup `15 2 * * *` → `15 */6 * * *`; cron restarted; local RPO ≤6 h (offsite still unconfigured) |
| 2026-10-23 10:15 | Env source-of-truth audit | 🟡 | root `.env` had `BETTER_AUTH_URL`/`NEXT_PUBLIC_*` = localhost:3000 while server app.env was correct; root fixed to `https://tartly.in`. Renderer would have corrected it, but the mismatch was a trap |
| 2026-10-23 10:18 | Secret file permissions | ✅ | root `.env` and `.env.local` were `0644` → `0600`; `git check-ignore` confirms all env files ignored; `.dockerignore` excludes `.env*` and `deploy/` |
| 2026-10-23 10:20 | OAuth wiring probe | ✅ | `POST /api/auth/sign-in/social` returns a Google URL with `redirect_uri=https://tartly.in/api/auth/callback/google`, client_id and state present — only the console allow-list entry remains |
| 2026-10-23 18:15 | 6-hourly backup cron | 🟡 | dump ok (104K) but log says `offsite disabled` — R2 creds landed at 18:53 |
| 2026-10-23 18:53 | R2 backup env installed | ✅ | `/etc/tartly/backup.env` 0600; R2 keys + bucket + endpoint set; `HEALTHCHECKS_*` still empty |
| 2026-10-23 18:57 | Release `1d44127` | ✅ | R2 asset driver + CSP `connect-src`; web-1/web-2 healthy; worker up; env hash matches workstation |
| 2026-10-23 19:03 | First verified offsite backup | ✅ | `r2:tartly-backups/postgres/tartly-20261023T190309Z.dump.zst`; re-download SHA-256 equals local; `zstd -t` OK (one transient 501 on attempt 1, attempt 2 succeeded) |
| 2026-10-23 19:04 | SSH / firewall / deploy key audit | ✅ | UFW active 22/80/443 + 443/udp; fail2ban sshd 0 banned; `passwordauthentication no`; GitHub deploy key authenticates; no 3000/5432/6379 open from outside |
| 2026-10-23 19:07 | Restore drill | ✅ | fresh dump 104 KB → scratch DB; restore 1 s; counts 3/3/3/4/4 match production; scratch dropped |
| 2026-10-23 19:08 | R2 asset bucket + CORS | ✅ | `tartly-assets` reachable with app creds (empty); preflight `204`, `access-control-allow-origin: https://tartly.in`, methods PUT/GET/HEAD |
| 2026-10-23 19:09 | Dependency audit | 🟡 | `npm audit`: 21 total, 0 critical, 2 high (`linkify-it` via `ansi-to-react`, runtime; rest dev-only). No auto-upgrade |
| 2026-10-23 19:10 | Image scan `1d44127` | 🟡 | web 1 CRITICAL (`zlib1g` will_not_fix), 67 HIGH; worker 4 CRITICAL (1 zlib + 3 Go stdlib in esbuild), 124 HIGH; fixable highs are dev tooling |
| 2026-10-23 19:11 | Public edge verification | ✅ | apex DNS + www `201.18.197.194`, TTL 300; HTTP/2 200; ready 200; www 308; cert notAfter 2027-01-21; auth callback 302; cron/metrics 401; Dodo webhook 400 (fails closed) |
| 2026-10-23 19:15 | Env parity check | ✅ | `render-env.mjs` output SHA-256 `bc2b30df…` equals the server `app.env`; 46 vars; `BETTER_AUTH_SECRET` 32 chars; no low-entropy boot warning in 24 h |
| 2026-10-23 19:18 | Healthcheck hardening | ✅ | `healthcheck.sh` now covers readiness, disk 60/75/85, memory 80/90, TLS <30/<14 d; `bash -n` clean; live run exit 0 (disk 38%, mem 25%, cert 89 d) |
| 2026-10-23 19:20 | Edge smoke baseline | 🟡 | off-box autocannon from the workstation; see §7.1. Client uplink-bound at high concurrency; not a capacity proof |
| 2026-10-23 19:24 | Body-cap change tested | ✅ | `tsc --noEmit` clean; changed-file eslint clean; `vitest` 273/273 (5 new body-cap tests) |
| 2026-10-23 19:27 | Release `f1ed59a` | ✅ | migrations complete; web-1/web-2 healthy; worker up; Caddy reloaded; public ready 200; `.deploy/previous-tag` = `1d44127` |
| 2026-10-23 19:32 | Rollback drill | ✅ | `rollback.sh` rewritten (updates `.env` TAG, swaps pointers, waits healthy, verifies ready); `f1ed59a → 1d44127` ready 200, then `1d44127 → f1ed59a` ready 200; production ends on `f1ed59a` |
| 2026-10-23 19:34 | Production-only audit | 🟡 | `npm audit --omit=dev`: 2 high + 8 moderate, all `linkify-it` via `ansi-to-react`; `Ansi` defaults `linkify=false` and the sole usage omits it → not reachable |
| 2026-10-23 19:35 | Billing state probe | 🟡 | Dodo key is opaque (no `dodo_test_`/`dodo_live_` prefix), len 65; `DODO_PAYMENTS_ENVIRONMENT=test_mode`, live disabled, webhook key empty; 1 subscription / 2 billing accounts / 0 webhook events → no verified test payment yet |
| 2026-10-23 19:37 | R2 full verification | ✅ | `npm run verify:r2`: assets PUT 200 → HEAD 200 → GET 200 (bytes match) → DELETE 204; CORS preflight 204 `https://tartly.in`; presigned PUT 200 |
| 2026-10-23 19:39 | Google OAuth console probe | ✅ | sign-in start → `accounts.google.com` returns HTTP 200 "Sign in"; no `redirect_uri_mismatch`/`invalid_client`; page references `tartly` |
| 2026-10-23 19:42 | Functional edge probes | ✅ | http→https 308; `/privacy`, `/terms`, `/pricing` 200; signed-out `/mail` 307 → `/auth?next=/mail`; unknown path 307 (guard, not 404) — accurate 404 requires a session |
| 2026-10-23 19:46 | AI spend ceiling applied | ✅ | founder chose 2,000/day; `AI_GLOBAL_DAILY_BUDGET=2000` rendered, copied, web-1→web-2→worker recreated; container sees 2000; ready 200. Pub/Sub deferred (D19) |
| 2026-10-24 08:55 | Resume protocol | ✅ | host up 1 d 2 h; 6 containers up; ready 200 (pg 2 ms, redis 5 ms); no error/fatal/panic in 30 m; RAM 2.1/7.7 GiB; disk 37/96 GB (39%) |
| 2026-10-24 08:56 | Capacity report | ✅ | DB 15 MB; 133 messages at 8.7 kB avg; 12/120 connections; cache hit 99.93%; Redis 1.26 MB; 12 local dumps (warn: keep ≤3) |
| 2026-10-24 08:57 | Onboarding redirect reproduced | 🔴 | Caddy log: `GET /api/onboarding/sync-email/complete` → `307 Location: https://0.0.0.0:3000/onboarding` (08:52:49 UTC); root cause `request.nextUrl.origin` |
| 2026-10-24 08:58 | Pre-deploy backup | ✅ | `tartly-20261024T085820Z.dump.zst`; R2 attempt 1 returned 501, attempt 2 succeeded (known transient) |
| 2026-10-24 09:01 | Release `d95dbb5` (canonical-origin fix) | ✅ | `tsc --noEmit` clean; 276/276 unit tests; web-1/web-2 healthy; worker up; ready 200; onboarding redirect → `https://tartly.in/auth`; billing return → `https://tartly.in/mail?billing=…` |
| 2026-10-24 09:00 | Gmail quota observation | 🟡 | `[cron/daily] backfill failed … GmailApiError 403 rateLimitExceeded` for 2 accounts; sync continues, no 5xx. Watch after the founder reconnects; if it persists, confirm per-project Gmail quota |
| 2026-10-24 09:06 | Production dependency re-audit | 🟡 | `npm audit --omit=dev`: 23 (7 high). New vs 19:34: `zod` 4.6.5 (direct, HIGH), `undici` 7.29.1 / 6.29.0 (transitive, HIGH), `@vercel/blob` chain. Direct zod patched below; rest recorded |
| 2026-10-24 09:09 | Release `9e1f951` (zod 4.6.7) | ✅ | `tsc --noEmit` clean; 276/276 unit tests; lockfile regenerated with npm 10.9.9 + `ci --dry-run` clean; web-1/web-2 healthy; worker up; ready 200 |
| 2026-10-24 09:12 | Post-release verification | ✅ | ready 200; onboarding callback `307 → https://tartly.in/auth` (no `0.0.0.0`); www `308`; cert valid to 2027-01-21; `BETTER_AUTH_URL` inside web-1 = `https://tartly.in`; zero error/fatal/panic in 10 m; disk 45/96 GB (47% after two builds) |

### 7.1 Off-box edge smoke (2026-10-23 19:20 UTC)

Workstation → `https://tartly.in` over the public internet. Autocannon, 15 s per
run, no session. This measures the edge + public paths from one client, **not**
the §15 authenticated workload.

| Path | Concurrency | RPS | p50 | p97.5 | p99 | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/health/live` | 5 | 54 | 89 ms | 118 ms | 131 ms | 0 |
| `/` (landing) | 5 | 32 | 147 ms | 178 ms | 596 ms | 0 |
| `/api/health/live` | 50 | 485 | 1009 ms | 1652 ms | 2225 ms | 0 |
| `/` (landing) | 50 | 113 | 3968 ms | 7245 ms | 7674 ms | 0 |

The 50-connection runs are **client-uplink-bound**: health (no DB, no render)
already showed ~1 s p50, so the latency is the test path, not the server. The
c=5 numbers are the useful public-edge floor. A real baseline needs the §15 k6
script, a dedicated test session, and a generator with more upstream capacity.

---

## 8. Deployment history

| Tag | Time (UTC) | Contents | Notes |
| --- | --- | --- | --- |
| `a14f782-dirty-20261023074103` | 07:41 | working tree, Postgres 17 | superseded by PG18 |
| `a14f782-dirty-20261023074724` | 07:47 | working tree, Postgres 18 | rollback baseline |
| `83ccc5a` | 08:53 | clean git tree (app snapshot + deploy docs) | previous; Caddy skipped (DNS) |
| `8453e0d` | 10:12 | next@16.4.2 security patch + canonical settings route + www 308 | previous; rollback target |
| `1d44127` | 18:57 | R2 asset wiring (S3 driver + CSP `connect-src`), R2 setup docs, split backup heartbeat from readiness ping | previous |
| `f1ed59a` | 19:27 | 64 KiB text / 128 KiB HTML body caps at ingest + 5 tests | previous; clean tree; rollback target is `1d44127` |
| `d95dbb5` | 2026-10-24 08:59 | canonical public origin for onboarding + billing redirects (`lib/http/public-origin.ts`) + unit test | previous; clean tree; rollback target is `f1ed59a` |
| `9e1f951` | 2026-10-24 09:09 | zod 4.6.5 → 4.6.7 (HIGH GHSA-mrhx-c7xc-m3w5) | **current**; clean tree; rollback target is `d95dbb5` |
| `a14f782` (HEAD) | 2026-10-07 | last upstream commit | baseline before the snapshot |

---

## 9. Access & secrets map (no values)

| Item | Location | Owner | Notes |
| --- | --- | --- | --- |
| SSH key | `~/.ssh/id_ed25519` on this workstation | user | key-only; root + `deploy` |
| `deploy/app.env` | server `/opt/tartly/deploy/app.env` | deploy | 0600; 46 vars; **not in git**; hash matches the workstation render |
| Root `.env` (source of truth) | workstation repo root | user | 0600; gitignored; never commit |
| `deploy/.env` | server `/opt/tartly/deploy/.env` | deploy | 0600; Postgres/Redis secrets; `TAG=f1ed59a` |
| Backup R2 creds | server `/etc/tartly/backup.env` | deploy | 0600; R2 wired; Healthchecks URLs still empty |
| Git remote | `git@github.com:ArDnath/Tartly.git` | user | private |
| GitHub deploy key (host) | `deploy@…:~/.ssh/id_ed25519_github` | user | **active**; read-only deploy key; `ssh -T` verified |
| Hostinger panel | hPanel | user | DNS, snapshots, console |
| Google Cloud | console | user | OAuth client, Pub/Sub |
| Dodo dashboard | app.dodopayments.com | user | products, webhooks |
| Healthchecks.io | external | user | ping URL → backup.env |

**Never** copy `app.env` into the repo, a chat, a screenshot, or a Docker layer (`.dockerignore` excludes `deploy`).

---

## 10. Do-not-do list

1. **Never** `docker compose down -v` in production — it deletes Postgres, Redis and Caddy volumes.
2. **Never** publish ports `5432`, `6379` or `3000` to the host. Caddy is the only public listener.
3. **Never** disable UFW or fail2ban "to debug".
4. **Never** rotate `BETTER_AUTH_SECRET` casually — it invalidates every encrypted OAuth token.
5. **Never** restore a dump without taking a fresh dump first and stopping web/worker.
6. **Never** run `apt upgrade` / reboot during traffic without a maintenance window.
7. **Never** change nameservers for `tartly.in` — edit the A record only.
8. **Never** enable the Cloudflare proxy on `/api/*` without testing long SSE streams (100 s cap on free plan).
9. **Never** commit `deploy/app.env`, `deploy/.env`, or `.env.local`.
10. **Never** deploy with a dirty tree without recording the tag (the script does this automatically).
11. **Never** trust a backup you have not restored — the drill is in the guide §13.
12. **Never** enable Dodo live mode before the webhook key is set and a test payment passed.
13. **Never** store user uploads or attachments on the VPS disk — R2/S3 only.
14. **Never** let `body_html` grow unbounded; no bodies older than the hot window without an archive.
15. **Never** keep more than 3 local dumps once the database exceeds 5 GB.
16. **Never** claim "10k concurrent" without a load test — 10k active users ≠ 10k RPS.
17. **Never** let Docker build cache grow unbounded — it was 5.8 GB after one rebuild; prune >7 d.

---

## 11. Launch definition of done

- [x] Apex + www resolve to this host; TTL ≤ 300
- [x] Let's Encrypt cert valid for apex + www; auto-renewal path verified
- [x] `https://tartly.in/api/health/ready` = 200 from the public internet
- [x] `www` → apex 308 redirect
- [ ] Google sign-in works end-to-end; Gmail connect + first sync works (redirect bug fixed in `d95dbb5`; awaiting one founder run)
- [x] `BETTER_AUTH_SECRET` rotated to a 32-char high-entropy value; no boot warning
- [x] R2 uploads work (storage path + presigned PUT verified; signed-in finalize optional)
- [x] Nightly backup uploaded offsite; restore drill recorded (SHA-256 match, 1 s restore)
- [ ] External uptime monitor + backup heartbeat firing (`HEALTHCHECKS_*` empty)
- [ ] Dodo test payment → webhook → entitlement verified
- [x] Working tree committed; clean tag `f1ed59a` deployed
- [x] Rollback drilled: `f1ed59a → 1d44127 → f1ed59a`, readiness 200 at each hop
- [ ] Performance baseline recorded (§15)
- [ ] Capacity model (§2.7) verified: 400 RPS and 2k SSE streams at p95 within SLO
- [ ] Email-body lifecycle active; projected 90-day disk use < 60%
- [x] RPO ≤ 6 h (6-hourly cron + verified R2 offsite copy)
- [ ] AI/SSE concurrency caps configured (AI spend capped at 2,000/day global + 500/user; global generation semaphore deferred — D18)
- [ ] Incident contacts + rollback procedure known by the user

---

## 12. Document map

| Document | Use |
| --- | --- |
| `deploy/DEPLOYMENT-TRACKER.md` | **State + next action.** Update this. |
| `deploy/DEPLOYMENT-GUIDE.md` | Full multi-stage reference and rationale. |
| `deploy/RUNBOOK.md` | Day-2 commands, scaling notes, quick reference. |
| `deploy/docker-compose.yml` | The stack. |
| `deploy/Caddyfile` | Edge config. |
| `deploy/R2-SETUP.md` | **Cloudflare R2 buckets, CORS, tokens, env and backup heartbeat.** |
| `deploy/scripts/*` | Executable procedures referenced by the guide. |
| `docs/SKILL-v2.md` | Backend production-readiness standard the app follows. |
| `docs/runbooks/*` | App-specific incident runbooks (auto-send storm, poison job, etc.). |

---

## 13. How to update this tracker

After **every** action that changes state, edit this file in one commit-sized
pass:

1. **Timestamp** — update `Last updated` at the top (UTC).
2. **Stage board (§2)** — move exactly one row (or the rows the action touched).
   Add the evidence (command output, tag, timestamp) in the *Gate / evidence*
   column. Never mark ✅ without evidence.
3. **Verification ledger (§7)** — append a row: `UTC time | action | result |
   one-line evidence`. Never rewrite history; append corrections.
4. **Deployment history (§8)** — add a row for every new image tag.
5. **Next actions (§4)** — check off what was done; add new ones in dependency
   order; keep the critical path first.
6. **Decisions (§5)** — record any choice that a future session could otherwise
   re-litigate.
7. **Risk register (§6)** — add/close risks. Every accepted risk needs a reason.
8. **Do-not-do list (§10)** — add a rule whenever an incident reveals one.

If you are unsure whether something belongs here: **write it down**. A tracker
that is slightly verbose is infinitely better than one that is stale.

### 13.1 Session hand-off checklist

Before ending a session:

- [ ] No command is still running that the next session needs to wait for.
- [ ] The server is in a known state (`docker compose ps`).
- [ ] The next action is unambiguous and has a copy-paste command.
- [ ] Any secret created this session is stored in the password manager.
- [ ] The tracker timestamp and ledger are updated.
- [ ] Anything blocked on the user is written in §4 with the exact ask.
