# Tartly — Deployment Tracker

> **This is the state file. Read it before touching the server, and update it after every action.**
> A new agent session must be able to resume from §3 without asking the user to repeat anything.

| Field | Value |
| --- | --- |
| Last updated | **2026-10-23 10:25 UTC** |
| Environment | Production (first node) |
| Canonical origin | `https://tartly.in` |
| Host | `srv2076028.hstgr.cloud` · `201.18.197.194` · Mumbai 2 |
| Provider / plan | Hostinger KVM 2 — 2 vCPU, 8 GB RAM, 100 GB NVMe, 8 TB/mo |
| OS | Ubuntu 26.04.1 LTS (`resolute`), kernel 7.0.0-34 |
| Runtime | Docker 29.9.2 · Compose v5.6.1 |
| Deployed tag | `8453e0d` (clean tree; previous `83ccc5a`) |
| Data | 2 users · 2 connected accounts · 2 mailboxes · 3 threads · 3 messages |
| Public traffic | **LIVE** — apex + www resolve here; Let's Encrypt issued 08:45 UTC; readiness 200 over HTTPS |
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
CURRENT BLOCKER: none for public HTTPS. Site is live on `8453e0d`.
NEXT ACTION: rotate BETTER_AUTH_SECRET after founder approval (A3), then the
founder-gated integrations: Google OAuth (A2/C1), R2 (C2/D1), Dodo webhook (C3),
AI budgets (C5), GitHub deploy key (E1).
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
| 5 | Secrets & environment | 🟡 | `app.env` 41 vars, 0600; schema validates; autopilot/assets explicitly off; **secret still 19 chars** | 🔴 secret rotation + missing launch keys (A12) |
| 6 | Postgres 18 + Redis + Upstash shim | ✅ | both healthy; ready=200 | — |
| 7 | Image build (web + worker) | ✅ | tag `8453e0d`; clean git tree; built locally + on host; runner + worker verified | — |
| 8 | Migrations (26) | ✅ | `db:migrate` complete (no-op on 8453e0d release) | — |
| 9 | Data cutover from Neon | ✅ | counts match source (2/2/2/3/3) | — |
| 10 | Rolling release (2 web replicas) | ✅ | `8453e0d` 10:12 UTC; web-1/web-2 healthy, worker started, ready 200 | — |
| 11 | Backup + restore drill | ✅ | 101 KB dump; restore returned 2/2/3 | — |
| 12 | DNS → this host | ✅ | apex + www both `201.18.197.194`; verified from workstation + host, 2026-10-23 09:43 UTC | — |
| 13 | TLS / Caddy / HTTP-3 | ✅ | Caddy up 09:44 UTC; LE certs for apex+www; HTTP/2 200, HTTP/3 OK, www→apex 308 | — |
| 14 | Google OAuth redirect URIs | ⛔ | not yet added in Google Cloud | **user action** |
| 15 | Dodo webhook + live/test payment | ⬜ | `DODO_PAYMENTS_WEBHOOK_KEY` empty | keys |
| 16 | R2 asset storage + CORS | ⬜ | driver currently `vercel-blob`, no token → uploads disabled | **user creds** |
| 17 | Offsite backups (R2) | ⬜ | local only, `HEALTHCHECKS_URL` empty | R2 |
| 18 | External monitoring / alerts | ⬜ | health endpoint exists; no external check | user |
| 19 | Security audit & dependency scan | 🟡 | host hardened; critical advisories **patched** in `8453e0d` (web image criticals 3→1, remaining `zlib1g` will_not_fix); `BETTER_AUTH_SECRET` rotation still pending | founder approval |
| 20 | Performance baseline (k6) | ⬜ | not measured | — |
| 21 | CI/CD (GHCR + Actions) | ⬜ | deploys are rsync + on-host build | — |
| 22 | Scale plan (10k users → 1M RPS) | ✅ | guide §2.7, §6.9, §16.2b; decisions D11–D14 | — |
| 23 | 10k-user capacity + storage lifecycle | 🟡 | model documented; body trim/retention not implemented (A8) | code change |
| 24 | Clean git baseline / reproducible deploy | ✅ | `83ccc5a`; bundle fast-forward; host tree clean; bundle stash retained; host deploy key pending (A11) | — |

**Launch gate:** stages 12, 13, 14 and 16 must be ✅ (16 may be explicitly waived) before the domain is announced.

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

# 6. DNS (the current blocker)
node -e "require('dns').promises.resolve4('tartly.in').then(console.log)"

# 7. Then read §4 and execute the first unchecked action.
```

**Do not** start Caddy until step 6 returns `201.18.197.194`.

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

### A2 — Google OAuth redirect ⛔ → verify after founder adds it
**Owner:** user (Google Cloud Console) · **Then verify:**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' 'https://tartly.in/api/auth/callback/google'
```
Expected: `302`/`400` from the provider exchange — *not* `404`. Then sign in end-to-end in a browser.

Add:
- JS origin `https://tartly.in`
- Redirect URI `https://tartly.in/api/auth/callback/google`
- (If enabled) `https://tartly.in/api/auth/callback/microsoft`

**2026-10-23 09:50 UTC:** callback currently returns `302` (route exists); the console-side allow-list entry still needs the founder. This is the last blocker for a real sign-in test.

### A3 — Rotate `BETTER_AUTH_SECRET` 🔴 awaiting founder approval
**Owner:** user decision · **Impact:** every stored Gmail/Outlook refresh token becomes undecryptable; users reconnect once. Sessions already need a fresh login after the domain change, so now is the cheapest moment.
**Done by agent when approved:** edit repo-root `.env`, `node deploy/scripts/render-env.mjs https://tartly.in`, copy rendered files, rolling recreate web-1/web-2/worker. Never print the value.

### A3b — Patch critical runtime advisories ✅
**Owner:** agent · **Done:** 2026-10-23 10:12 UTC, tag `8453e0d`.
**What changed:** `next` 16.3.5 → 16.4.2 (critical RCE/SSRF advisories; `npm audit` criticals 2 → 0), non-breaking `npm audit fix` (dompurify, sharp, source-map-js), canonical `app/settings/[[...section]]` route required by Next 16.4 strict interception matching (shared section registry), and the Caddy www 308 fix.
**Evidence:** `tsc --noEmit` clean; 267/267 unit tests pass; web + worker images build; rolling deploy healthy; public ready 200; web-image CRITICALs 3 → 1 (`zlib1g`, Debian `will_not_fix`). Lint still reports one pre-existing error in untouched `components/marketing/landing/home-content.tsx` (`react-hooks/set-state-in-effect`) — recorded, not fixed in the security change.
**Rollback:** `.deploy/previous-tag` = `83ccc5a`; `./scripts/rollback.sh`.

### A4 — R2 asset storage ⬜
**Owner:** user provides credentials · **Full procedure:** [`R2-SETUP.md`](./R2-SETUP.md).
**Summary:** create private `tartly-assets`, CORS for `https://tartly.in` (`PUT,GET,HEAD`, headers `*`, expose `ETag`), token scoped to that bucket. Put `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET=tartly-assets`, `S3_REGION=auto`, `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com` in the root `.env`, then `ASSETS_ENABLED=true`. `render-env.mjs` sets `ASSET_STORAGE_DRIVER=s3` automatically.
```bash
ssh deploy@201.18.197.194 'cd /opt/tartly/deploy && \
  docker compose --env-file .env up -d --no-deps --force-recreate web-1 web-2 worker'
```
Verify: upload a small attachment in the UI; an object appears under `assets/<userId>/<sha>`; `GET /api/v1/assets/<id>/raw` returns it.

### A5 — Offsite backups + monitoring ⬜
**Owner:** agent after R2 · **Full procedure:** [`R2-SETUP.md`](./R2-SETUP.md) §5.
**Needs:** private `tartly-backups`, a token scoped to it, and **two** Healthchecks checks (readiness 1 min, backup 6 h + 1 h grace). Fill `/etc/tartly/backup.env` (`0600`).
```bash
ssh deploy@201.18.197.194 'cd /opt/tartly/deploy && ./scripts/backup-postgres.sh'
```
Verify: `rclone lsf r2:tartly-backups/postgres/` lists today's dump; the backup check shows the ping. `HEALTHCHECKS_BACKUP_URL` is separate from `HEALTHCHECKS_URL` on purpose (the per-minute readiness probe would otherwise mask a missed backup). The backup script does not fall back: unset means no heartbeat, with a warning.

### A6 — Commit the working tree ✅
**Owner:** agent · Done 2026-10-23 08:53 UTC. Two commits (`4dee51b` app snapshot, `633219b`/`83ccc5a` deploy docs), pushed to `ArDnath/Tartly`, fast-forwarded on the host via a git bundle, clean tag `83ccc5a` deployed. The pre-pull rsynced tree is retained as `stash@{0}` on the host.

### A7 — Performance baseline ⬜
**Owner:** agent · See guide §15. Record results here. No tuning before measurement.

### A8 — Email-body lifecycle 🟡
**Owner:** agent + user decision · **Why:** the schema stores full `bodyText` + `bodyHtml` per message (`lib/db/schema.ts:536–537`). Measured ~32 kB/message; at 10k users × 10–30 messages/day that is 3–10 GB/day, which fills 100 GB in weeks.
**Implement before ~5k active users:**
1. Measure: `./scripts/capacity-report.sh` (DB size, per-row bytes, top tables).
2. Strip base64 inline images/tracking pixels at ingest; cap `bodyHtml` (~64–128 kB).
3. Keep a hot window (~90 days) in Postgres; archive older bodies to R2 or re-fetch from Gmail on thread open.
4. Alert at 60/75/85% disk and on DB size.
**Gate:** projected 90-day disk use < 60%.

### A9 — RPO ≤ 6 h 🟡
**Owner:** agent after R2 · **Why:** nightly dumps give a 24 h RPO, which is too much state to lose at 10k users.
**Do:** raise dump frequency to 6 h (cheap while the DB is small), or add WAL archiving (`pgBackRest`/WAL-G) to R2 for PITR. Reduce local retention to 2–3 d once the DB exceeds 5 GB.

**2026-10-23 10:13 UTC:** `/etc/cron.d/tartly` now runs `backup-postgres.sh` every 6 h (`15 */6 * * *`); cron reloaded. RPO is now ≤6 h **locally only** — offsite still needs R2 credentials, so a host loss still loses everything.

### A10 — GHCR + Actions ⬜
**Owner:** agent + user secrets · **Why:** on-host builds steal the same 2 vCPU that serves requests. Publish `web` and `worker` images to GHCR and let the host only pull + migrate + roll. Keep `deploy.sh` as the emergency fallback.

### A11 — Add the server deploy key ⬜
**Owner:** user (GitHub) · The host has no GitHub credentials, so `git pull` still needs a bundle. A key exists at `deploy@…:~/.ssh/id_ed25519_github`:
```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHjR0mIw3/UpTGZe+c6mZewRhJZjnLS0eItqQ49jBuXw tartly-vps-deploy
```
Add it at GitHub → `ArDnath/Tartly` → Settings → Deploy keys (read-only). Verify:
```bash
ssh deploy@201.18.197.194 'ssh -T git@github.com'
# expected: "Hi ArDnath/Tartly! You've successfully authenticated..."
```
Then future deploys are simply `git pull --ff-only && bash deploy/scripts/deploy.sh`.

### A12 — Complete the launch env 🟡
**Owner:** user (values) + agent (apply) · **Source of truth is the repo-root `.env`**, not the server file. Edit it, run `node deploy/scripts/render-env.mjs https://tartly.in`, copy `deploy/app.env` + `deploy/.env` to the host, then recreate web/worker. Never paste secrets into chat.

**Verified correct (2026-10-23 09:20 UTC):** `DATABASE_URL` → `postgres:5432/tartly` and its password matches `.env`; Redis → `redis-http:80` and its token matches; `BETTER_AUTH_URL`/`PUBLIC_URL` → `https://tartly.in`; the client bundle contains `tartly.in` and zero `localhost:3000`; Dodo is `test_mode` with live disabled; CSP is report-only; contract validation is enforce. `TAG` is now the deployed tag, not `latest`.

> **TAG trap (found 2026-10-23 10:22 UTC):** `render-env.mjs` preserves `TAG` from the local `deploy/.env`. After every deploy, update the local `TAG` to the live tag *before* re-rendering, or copying the rendered `deploy/.env` to the host will silently point Compose at the previous image. Local and server `deploy/.env` now match byte-for-byte (`TAG=8453e0d`). Root `.env` origins were also corrected from `localhost:3000` to `https://tartly.in`; the renderer overrides them, but the stale values were a trap.

| Missing / weak | Where | Needed for | Owner |
| --- | --- | --- | --- |
| `BETTER_AUTH_SECRET` is **19 chars** | root `.env` → render | security; rotate to 32+ random bytes | user approval (A3) |
| `DODO_PAYMENTS_WEBHOOK_KEY` empty | root `.env` | paid orders → entitlements | user (Dodo dashboard) |
| `S3_*` + `ASSET_STORAGE_DRIVER=s3` + `ASSETS_ENABLED=true` | root `.env` | uploads (currently explicitly disabled) | user (R2) |
| `GOOGLE_PUBSUB_TOPIC`, `GOOGLE_PUBSUB_AUDIENCE` | root `.env` | real-time Gmail/Outlook sync | user (Google Cloud) |
| `AI_GLOBAL_DAILY_BUDGET`, `AI_DAILY_BUDGET`, `AGENT_MAX_TOKENS_PER_RUN` | root `.env` | platform cost ceiling | user picks number |
| `DODO_PRODUCT_CREDITS_STARTER/PLUS/PRO` | root `.env` | credit packs | user (Dodo) |
| `MICROSOFT_CLIENT_ID/SECRET/TENANT_ID` + `NEXT_PUBLIC_MICROSOFT_CONNECT_ENABLED` | root `.env` + `deploy/.env` (build) | Outlook | user (Entra) |
| `NEXT_PUBLIC_CAL_BOOKING_LINK`, `NEXT_PUBLIC_BOOKING_URL`, `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | root `.env` | booking / SEO (optional) | user |
| `CSP_MODE=enforce`, `CSP_REPORT_URI` | root `.env` | security hardening | agent after burn-in |
| `HEALTHCHECKS_URL`, `RCLONE_*` | `/etc/tartly/backup.env` | offsite backup + heartbeat | user (A5) |
| Deploy key | GitHub repo settings | `git pull` on the host | user (A11) |

**Deliberately empty and fine:** `DATABASE_REPLICA_URL` (no replica), `BLOB_READ_WRITE_TOKEN` (not using Vercel Blob), `ASSET_EXTRACT_KEY`/`CLAMAV_HOST` (scanning/extraction off), `AI_PROVIDER` (uses `AI_BASE_URL`/`OPENCODE_*`), `CAMPAIGNS_ENABLED`/`SEMANTIC_SEARCH_ENABLED` (ship off).

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
| D8 | `BETTER_AUTH_SECRET` | preserve vs rotate | **preserve** until user approves rotation | 🔴 |
| D9 | Hostinger daily backups | buy vs rely on dumps | rely on nightly dumps + weekly snapshot | 🟡 |
| D10 | Autopilot at launch | on vs off | **`AUTOPILOT_ENABLED=false` explicitly** — unset means allowed at the env level (per-mailbox policies still default off) | ✅ |
| D11 | Workload target | 10k users vs 10k concurrent RPS | **10k active users**: ~1–2k peak concurrent sessions, ≤400 API RPS. 10k simultaneous requests is Stage C, not this box | ✅ |
| D12 | Data placement at 10k | local vs managed Postgres/Redis | **local Postgres 18 + local Redis** until a trigger fires (guide §6.9: 2nd app node, DB >20 GB, CPU >60%, RPO <24 h) | ✅ |
| D13 | Email body storage | PG forever vs trim + archive | **trim HTML at ingest, ~90-day hot window, archive/re-fetch older bodies** — measured ~32 kB/message makes 100 GB the binding constraint | 🟡 |
| D14 | Backup RPO at 10k | 24 h dumps vs PITR | **24 h now; 6 h dumps or WAL/PITR before 10k users** | 🟡 |
| D15 | Deploy provenance | dirty rsync vs git tag | **clean tag `83ccc5a`**; git history + host deploy key next (A11) | ✅ |
| D16 | Launch feature defaults | implicit vs explicit | **`ASSETS_ENABLED=false` until R2 is configured; `AUTOPILOT_ENABLED=false`** | ✅ |
| D17 | Env source of truth | server `app.env` vs repo-root `.env` | **repo-root `.env` → `render-env.mjs` → copy `app.env` + `.env`**; never hand-edit the server | ✅ |

---

## 6. Risk register

| Risk | Impact | Likelihood | Mitigation | Status |
| --- | --- | --- | --- | --- |
| Weak `BETTER_AUTH_SECRET` | session forgery / token decrypt risk | medium | rotate before launch (A3) | 🔴 |
| Single node | full outage on host failure | medium | nightly dump + restore drill; scale plan §16 | ⚠️ |
| RPO 24 h | up to a day of data loss | medium | add R2 offsite now; later WAL/pgBackRest | ⚠️ |
| Offsite backup disabled | host loss = total loss | low | A5 | ⬜ |
| Uploads disabled | core feature gap | high | A4 | ⬜ |
| Uncommitted deploy | rollback ambiguity | high | clean tag `83ccc5a` + full git history; server stash retained | ✅ |
| No external monitoring | silent outage | medium | A5 + uptime monitor | ⬜ |
| AI provider outage | drafts/chat fail | medium | fallback chain env + circuit breaker (code) | ⚠️ |
| Gmail OAuth verification | sign-in blocked for new users | medium | add redirect + verify consent screen | ⛔ |
| DB connection exhaustion | 5xx under load | low | pools 8/8/4 vs 120 max; PgBouncer later | ✅ |
| Disk fill (logs/images) | outage | low | Docker log caps; 85/92% alerts | 🟡 |
| **Email-body growth vs 100 GB disk** | disk full → outage + failed backups | **high** | trim HTML, 90-day hot window, archive to R2; alerts at 60/75/85% (A8) | 🔴 |
| 14 local dumps on the same disk | backup consumes the disk it protects | medium | R2 first, then 2–3 local dumps once DB >5 GB (A5/A9) | 🟡 |
| Unbounded AI/SSE concurrency | OOM, provider 429 storms | medium | per-user 2–3 streams, global 50–100 generations, queue | ⬜ |
| Gmail/AI provider quotas at 10k | sync/send/draft failures | medium | quota math in guide §16.2b; backoff + fallback chain | ⬜ |
| Dodo webhook unverified | paid orders not activated | medium | configure before enabling live mode | ⬜ |
| **Critical runtime advisories (`next` 16.3.5 RCE, `dompurify` XSS)** | remote compromise / stored XSS | **high** while public | patched in `8453e0d`; re-scan shows only Debian `zlib1g` `will_not_fix` | ✅ |
| No offsite backup / RPO 24 h | host loss = total loss | medium | A5 + A9 | ⬜ |

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

---

## 8. Deployment history

| Tag | Time (UTC) | Contents | Notes |
| --- | --- | --- | --- |
| `a14f782-dirty-20261023074103` | 07:41 | working tree, Postgres 17 | superseded by PG18 |
| `a14f782-dirty-20261023074724` | 07:47 | working tree, Postgres 18 | rollback baseline |
| `83ccc5a` | 08:53 | clean git tree (app snapshot + deploy docs) | previous; Caddy skipped (DNS) |
| `8453e0d` | 10:12 | next@16.4.2 security patch + canonical settings route + www 308 | **current**; clean tree; rollback target is `83ccc5a` |
| `a14f782` (HEAD) | 2026-10-07 | last upstream commit | baseline before the snapshot |

---

## 9. Access & secrets map (no values)

| Item | Location | Owner | Notes |
| --- | --- | --- | --- |
| SSH key | `~/.ssh/id_ed25519` on this workstation | user | key-only; root + `deploy` |
| `deploy/app.env` | server `/opt/tartly/deploy/app.env` | deploy | 0600; 39 vars; **not in git** |
| Root `.env` (source of truth) | workstation repo root | user | 0600; gitignored; never commit |
| `deploy/.env` | server `/opt/tartly/deploy/.env` | deploy | 0600; Postgres/Redis secrets |
| Backup R2 creds | server `/etc/tartly/backup.env` | deploy | 0600 |
| Git remote | `git@github.com:ArDnath/Tartly.git` | user | private |
| GitHub deploy key (host) | `deploy@…:~/.ssh/id_ed25519_github` | user | public half → repo deploy key (A11) |
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
- [ ] Google sign-in works end-to-end; Gmail connect + first sync works
- [ ] `BETTER_AUTH_SECRET` rotated (or risk explicitly accepted in writing)
- [ ] R2 uploads work (or explicitly waived)
- [ ] Nightly backup uploaded offsite; restore drill recorded
- [ ] External uptime monitor + backup heartbeat firing
- [ ] Dodo test payment → webhook → entitlement verified
- [ ] Working tree committed; clean tag deployed
- [ ] Performance baseline recorded (§15)
- [ ] Capacity model (§2.7) verified: 400 RPS and 2k SSE streams at p95 within SLO
- [ ] Email-body lifecycle active; projected 90-day disk use < 60%
- [ ] RPO ≤ 6 h (or PITR enabled)
- [ ] AI/SSE concurrency caps configured
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
