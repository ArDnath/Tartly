# Tartly — production runbook (single VPS)

> **Start here:** [`DEPLOYMENT-TRACKER.md`](./DEPLOYMENT-TRACKER.md) for current
> state and the next action, [`CI-CD.md`](./CI-CD.md) for the GitHub Actions
> pipeline and required secrets, [`VPS.md`](./VPS.md) for the host profile
> (specs, access, ports, filesystem, cron), and
> [`DEPLOYMENT-GUIDE.md`](./DEPLOYMENT-GUIDE.md) for the full multi-stage
> procedure, security audit, performance validation and the scale path to 1M RPS.

Target host: **srv2076028.hstgr.cloud** · `201.18.197.194` · Mumbai 2
Plan: KVM 2 — 2 vCPU, 8 GB RAM, 100 GB NVMe, 8 TB transfer · Ubuntu 26.04 LTS

---

## 1. What gets built

```
                      Internet
                         │  80/443 (UFW: only these + SSH)
                    ┌────▼──────────────────────────────┐
                    │ Caddy — TLS, HTTP/2+3, zstd/gzip  │
                    │   active health checks, SSE-safe  │
                    └───┬──────────────────────────┬────┘
                        │                          │
                 ┌──────▼──────┐            ┌──────▼──────┐
                 │  web-1      │            │  web-2      │   Next.js standalone
                 │  :3000      │            │  :3000      │   (non-root, read-only
                 └──────┬──────┘            └──────┬──────┘    image, no host ports)
                        └──────────┬───────────────┘
                    ┌──────────────▼──────────────────────────┐
                    │ worker — durable Postgres queue          │
                    │ (inbound mail, follow-ups, scheduled)    │
                    └──────────────┬──────────────────────────┘
             ┌─────────────────────┼──────────────────────────┐
       ┌─────▼─────┐        ┌──────▼──────┐          ┌────────▼────────┐
       │ Postgres  │        │   Redis 7   │          │  redis-http     │
       │ 17, tuned │        │ AOF, noevict│          │ Upstash-REST API│
       └─────┬─────┘        └─────────────┘          └─────────────────┘
             │
       nightly pg_dump ──► /var/backups ──► Cloudflare R2 (30d)
```

Everything is one Compose project (`deploy/docker-compose.yml`). No published
container ports except Caddy. The app tier is stateless: sessions in Redis,
uploads in R2, queue in Postgres. That is what makes a second node a
copy-paste later.

| Concern | Choice | Why |
| --- | --- | --- |
| TLS | Caddy + Let's Encrypt | automatic renewal, zero config |
| App | 2 × Next.js standalone | survives deploys/restarts, 2 vCPU can use both |
| Queue | dedicated worker | long jobs never block a request |
| DB | Postgres 18 local, tuned | low latency from Mumbai, no per-query egress |
| Cache/session | Redis + Upstash REST shim | app unchanged, no SaaS dependency |
| Assets | Cloudflare R2 (S3 driver) | off-box durability, zero egress cost |
| Backups | nightly dump + offsite | 24 h RPO, ~30 min RTO |

---

## 2. Before the first deploy (you do these)

### 2.1 DNS (Hostinger → hPanel → DNS zone for `tartly.in`)

**Do not change nameservers.** Only these two records:

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| A | `@` | `201.18.197.194` | 300 |
| A | `www` | `201.18.197.194` | 300 |

Leave every MX / TXT / SPF / DKIM record untouched — `tartly.in` may also carry
mail. Verify:

```bash
dig +short tartly.in
dig +short www.tartly.in
```

Caddy will not be started by `deploy.sh` until DNS resolves to this host (this
avoids burning Let's Encrypt rate limits).

### 2.2 Google OAuth (Google Cloud Console → APIs & Services → Credentials)

On the existing OAuth 2.0 Web client, add:

- Authorized JavaScript origin: `https://tartly.in`
- Authorized redirect URI: `https://tartly.in/api/auth/callback/google`

Keep the existing Vercel URIs until the cutover is verified, then remove them.

If Outlook is enabled: `https://tartly.in/api/auth/callback/microsoft`.

### 2.2a OAuth consent screen + domain ownership

Google rejects verification with **"Your home page website is not registered to
you"** until the Cloud project can see a verified owner of the homepage domain.
Verification is per-domain, not per-URL, and must be done by a Google account
that is an **Owner** of the Cloud project.

1. Search Console → confirm the **Domain** property for `tartly.in` exists and
   shows **Verified**. If it is not listed, add it with **Add property** →
   **Domain** (not URL-prefix); the TXT record is already present.
2. Do **not** add a duplicate TXT record. Confirm the current value with
   `dig +short tartly.in TXT | grep google-site-verification`; it should return
   `8-4xg5w8YO4kwdArb86nzPoIJhwzgLiQraAkhhzW4Qg`.
3. If Search Console asks for re-verification, click **Verify**. If the account
   differs from the Cloud project owner, add it under Search Console → Settings
   → Users and permissions → **Owner**.
4. Wait 24 hours (Google's own instruction), then set the consent screen to:
   - App homepage: `https://tartly.in` — apex, never `www.` (it 308s)
   - Authorized domain: `tartly.in`
   - Privacy policy: `https://tartly.in/privacy`
   - Terms of service: `https://tartly.in/terms`
5. Prepare for verification → Submit.

Alternative (HTML tag): set `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` to the
`content` value from Search Console and rebuild. It is already baked into the
image (`Dockerfile`, `deploy/scripts/render-env.mjs`) and emitted by
`app/layout.tsx`. DNS TXT is preferred: the homepage is cached
(`s-maxage=31536000`), so a meta tag needs a rebuild *and* a cache purge.

Never submit a `*.vercel.app` URL as the homepage — you cannot verify a shared
host, which is the other way this exact error appears.

### 2.2b Scope story and restricted-scope review

The connect flow requests `gmail.modify`, `calendar.readonly`,
`calendar.events`, and `https://mail.google.com/` (permanent delete), plus
`openid/email/profile` at sign-in. `gmail.modify` already authorizes the Gmail
send endpoint, so do **not** list `gmail.send` on the consent screen from an
older configuration. `gmail.modify` and `https://mail.google.com/` are
restricted scopes: verification includes an annual CASA security assessment,
even if the full-mailbox scope is removed later.

The full verification checklist, copy-paste scope justifications, demo-video
script, and the Search Console evidence commands are in
[`docs/google-oauth-verification.md`](../docs/google-oauth-verification.md).
Keep the consent-screen privacy URL and the homepage link identical:
`https://tartly.in/privacy`.

### 2.3 Gmail push (only if the email operator is on)

- Domain must already be verified per §2.2a before the OAuth consent screen
  can be submitted.
- Topic: `projects/<project>/topics/gmail-inbox`
- Grant `gmail-api-push@system.gserviceaccount.com` **Publisher** on the topic.
- Push subscription endpoint: `https://tartly.in/api/webhooks/gmail`
  (OIDC token, audience = that same URL).
- Set `GOOGLE_PUBSUB_TOPIC` in `app.env`.

### 2.4 Dodo Payments webhook

> Full live-mode sequence (products, webhook, env, payment + refund):
> [`GO-LIVE-CHECKLIST.md`](./GO-LIVE-CHECKLIST.md) §2.

- Endpoint: `https://tartly.in/api/webhooks/dodo`
- Copy the signing secret into `DODO_PAYMENTS_WEBHOOK_KEY`.
- Stay in `test_mode` until you have run a full test payment.

### 2.5 Cloudflare R2

Create two private buckets:

- `tartly-assets` — email attachments / uploads (served only through the app)
- `tartly-backups` — nightly database dumps

Create an API token with **Object Read & Write** on both. Then put into
`deploy/app.env`:

```dotenv
ASSET_STORAGE_DRIVER=s3
S3_BUCKET=tartly-assets
S3_REGION=auto
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Browser uploads use presigned PUTs, so add this CORS rule to `tartly-assets`:

```json
[
  {
    "AllowedOrigins": ["https://tartly.in"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

### 2.6 Monitoring

Create a Healthchecks.io check (period 1 min) and put its ping URL in
`/etc/tartly/backup.env` as `HEALTHCHECKS_URL=...`. The same value receives the
nightly backup heartbeat. Point an external uptime monitor (UptimeRobot etc.)
at `https://tartly.in/api/health/ready` as a second, independent pair of eyes.

---

## 3. First deploy (I run this)

```bash
# 1. host prep (as root)
bash deploy/scripts/bootstrap.sh

# 2. render production env on the workstation, ship it
node deploy/scripts/render-env.mjs https://tartly.in
rsync -av deploy/app.env deploy/.env root@201.18.197.194:/opt/tartly/deploy/

# 3. copy the repo (or clone it, see §8). Keep .git so deploy tags stay
#    traceable and `git pull` works later.
rsync -av --delete \
  --exclude node_modules --exclude .next \
  ./ root@201.18.197.194:/opt/tartly/

# 4. build + migrate + roll (as deploy)
ssh deploy@201.18.197.194 'cd /opt/tartly && bash deploy/scripts/deploy.sh'
```

### Cutover from the current Neon database

The current data lives in Neon (`ep-weathered-sky-...us-east-2`). Once the local
cluster is up and migrations pass:

```bash
ssh deploy@201.18.197.194
cd /opt/tartly/deploy
SOURCE_DATABASE_URL='postgresql://...neon.tech/neondb?sslmode=require' \
  ./scripts/import-database.sh
```

> **Keep `BETTER_AUTH_SECRET` identical to the current deployment.** Gmail and
> Outlook refresh tokens are encrypted with it; a new secret makes every
> connected mailbox fail and forces users to reconnect.

Sessions live in Redis and are **not** migrated — users sign in once. That is
expected and harmless.

---

## 4. Verification checklist

```bash
# from anywhere
curl -sS https://tartly.in/api/health/live       # 200
curl -sS https://tartly.in/api/health/ready      # 200 + postgres/redis "up"
curl -sSI https://tartly.in | grep -i strict     # HSTS present
curl -sS -o /dev/null -w '%{http_code}\n' https://www.tartly.in   # 308

# on the host
cd /opt/tartly/deploy && docker compose --env-file .env ps
docker compose --env-file .env logs --tail 100 web-1 worker
```

Then, in a browser: sign in with Google → onboarding → `/mail` loads live
Gmail → open `/assistant` and confirm the reply **streams** (not one blob).

---

## 5. Day-2 operations

| Task | Command |
| --- | --- |
| Deploy by merging to `main` | Open a PR → CI must pass → merge. **Deploy production** runs automatically. See [`CI-CD.md`](./CI-CD.md). |
| Manual release (host build) | `cd /opt/tartly && git checkout -f main && git pull --ff-only && bash deploy/scripts/deploy.sh` |
| Manual release (prebuilt images) | `TAG=… WEB_IMAGE=… WORKER_IMAGE=… bash deploy/scripts/release.sh` |
| Roll back app images | `bash deploy/scripts/rollback.sh` |
| Redeploy an older SHA | `gh workflow run "Deploy production" -f ref=<sha>` |
| Watch the pipeline | `gh run list --workflow "Deploy production" --limit 5` |
| Logs (follow) | `docker compose --env-file .env logs -f --tail 200 web-1 worker caddy` |
| Restart one replica | `docker compose --env-file .env restart web-1` |
| Postgres shell | `docker compose --env-file .env exec postgres psql -U tartly -d tartly` |
| Manual backup | `./deploy/scripts/backup-postgres.sh` |
| Restore drill | `FORCE=1 ./deploy/scripts/restore-postgres.sh <dump>` |
| Disk / memory | `df -h /`, `free -h`, `docker stats --no-stream` |
| Slow queries | `select * from pg_stat_statements order by mean_exec_time desc limit 20;` |

**Rollback caveat:** migrations are forward-only. `rollback.sh` restores the app
image, not the schema. If a release included a destructive migration, restore
the pre-deploy dump instead.

### Deploy safety

Both paths now share `release.sh`: pull/build images → start data services →
**pre-deploy dump** → **run migrations** → roll `web-1` → health check →
`web-2` → worker → Caddy → public `/api/health/ready` probe. A failed build,
backup or migration aborts before any traffic moves. If a container replacement
or the readiness probe fails, `release.sh` automatically restores the previous
images. Caddy removes unhealthy upstreams within ~10 s. A `flock` prevents two
releases from racing.

The CI/CD trigger, required secrets/variables and setup commands are in
[`CI-CD.md`](./CI-CD.md).

---

## 6. Security posture

- SSH: key-only; `deploy` (sudo, docker) for operations; root key-only for
  console/rescue. `fail2ban` on sshd.
- UFW: inbound `22/tcp`, `80/tcp`, `443/tcp`, `443/udp` only.
- Containers: no published ports except Caddy; `no-new-privileges`; web image
  runs as uid 1001; memory caps on every service.
- Secrets: `deploy/app.env` mode `600`, outside the image (`.dockerignore`
  excludes `.env*`); never rendered into a layer.
- App: nonce CSP (`CSP_MODE=report` initially — flip to `enforce` after a week
  of clean reports), HSTS, contract validation, per-user rate limits, metrics
  endpoint gated by `METRICS_TOKEN`.
- Unattended security upgrades + chrony.
- TLS 1.2+ with automatic renewal; HTTP→HTTPS redirect; HSTS 2 years.

Rotate a leaked secret: edit `deploy/app.env`, then
`docker compose up -d --no-deps --force-recreate web-1 web-2 worker`.

---

## 7. Backups & disaster recovery

- **What:** `pg_dump -Fc` of the whole database, zstd-compressed.
- **When:** 02:15 UTC daily (cron), plus before every release if the migration
  is non-trivial.
- **Where:** `/var/backups/tartly` (14 days) and `r2:tartly-backups/postgres`
  (30 days).
- **Recovery:** provision host → bootstrap → restore `.env` from your password
  manager → `restore-postgres.sh` → start Caddy → repoint DNS. Target ≈30 min.
- **RPO:** 24 h. If the business needs less, add WAL archiving with pgBackRest
  or move the database to managed Postgres with PITR.
- **Drill:** monthly. A backup you have never restored is a hope, not a backup.

What is **not** backed up by the dump: `deploy/app.env` (keep a copy in your
password manager), R2 objects (R2 is the durable store; enable object
versioning/lifecycle if attachments are business-critical).

---

## 8. Moving from rsync to git deploys

The repo is private. Create a read-only deploy key on the host and add it to
GitHub (`Settings → Deploy keys`):

```bash
ssh-keygen -t ed25519 -C tartly-deploy -f /home/deploy/.ssh/github -N ''
cat /home/deploy/.ssh/github.pub
# then, on the host:
cat >>/home/deploy/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/github
  IdentitiesOnly yes
EOF
git clone git@github.com:ArDnath/Tartly.git /opt/tartly
```

From then on `git pull --ff-only && deploy.sh`. Keep the first rsync for the
initial copy.

---

## 9. Scaling — the 10k-user target

The target is **10,000 active users**, not 10,000 concurrent requests. That maps
to roughly **1–2k peak concurrent sessions and 100–400 API RPS** — within this
box, provided the data lifecycle and AI/SSE caps below are in place. The full
model is guide §2.7 and §16.2b.

| Dimension | 10k active users | This box |
| --- | --- | --- |
| Peak sessions | 1–2k | ✅ with 2 web replicas |
| API RPS | 100–400 | ✅ after indexes + load test |
| Open SSE | 1–2k idle | ✅ with per-user caps |
| AI generations | 50–100 concurrent | ✅ only with a global cap/queue |
| DB growth | 3–10 GB/day raw | ⛔ needs body lifecycle |
| Egress | 0.3–1.5 TB/mo | ✅ well under 8 TB |

**Before calling 10k supported:**

1. **Body lifecycle** — trim HTML at ingest, cap body size, keep a ~90-day hot
   window, archive/re-fetch older mail. See guide §16.2b and tracker A8.
2. **Caps** — 2–3 streams per user, 50–100 global AI generations, queue beyond.
3. **Index/N+1 audit** — mail list, thread hydration, queue claim, billing.
4. **Builds off-host** — GHCR, or deploy in a low-traffic window.
5. **Monitoring** — external readiness probe, disk alerts, backup heartbeat.
6. **RPO ≤ 6 h** — 6-hourly dumps or WAL/PITR.
7. **Load test** — 400 RPS + 2k SSE for 60 min with flat memory.

**Measure first:**

```bash
cd /opt/tartly/deploy
./scripts/capacity-report.sh          # host, DB, Redis, disk, per-message bytes
docker stats --no-stream
```

**When you outgrow it, in this order:**

1. **Vertical:** 4 vCPU / 16 GB (Hostinger upgrade) — raise `web` mem limits to
   1.5g, `shared_buffers` to 4GB, `DB_POOL_MAX` to 12. Do this only when a load
   test shows CPU or memory as the active constraint.
2. **Offload state:** move Postgres to managed (Neon Mumbai) and/or Redis to
   Upstash. Change env vars + dump/restore; no code. This removes the data SPOF
   and enables PITR. Only worth it once you have (or are about to have) a second
   app node — see guide §6.9.
3. **Add app nodes:** point DNS/L4 LB at two hosts running the same Compose
   stack (web + worker only), with Caddy on each. Sessions already live in
   shared Redis; uploads already live in R2. No sticky sessions needed.
4. **Static/CDN:** put Cloudflare in front for static assets. Before proxying
   `/api/*`, note that the free plan caps request duration at 100 s, which can
   truncate long assistant streams — bypass those paths or use a paid plan.

> **10k concurrent requests ≠ 10k users.** If you actually mean 10k RPS, that is
> guide Stage C: multiple app nodes, managed data, PgBouncer, CDN and an LB. Do
> not try to reach it by resizing this single host.

### 9.1 Disk and email-body growth

The 100 GB NVMe is shared by Postgres (full `bodyText` + `bodyHtml`), WAL,
Docker images, logs and local dumps. Measured ~32 kB/message; at 10k users ×
10–30 messages/day that is **3–10 GB/day** before indexes and WAL.

Weekly checks:

```bash
df -h /
du -sh /var/lib/docker /var/backups/tartly
./scripts/capacity-report.sh
docker image ls --format '{{.Repository}}:{{.Tag}}\t{{.Size}}' | head
docker builder prune -f --filter until=168h   # ~6 GB after one build
```

Rules:

- Keep **2–3** local dumps once the DB exceeds 5 GB; R2 is the backup of record.
- Never store uploads/attachments on the VPS — R2 only.
- Archive bodies older than the hot window; do not let `body_html` grow forever.
- Alert at 60/75/85% disk. A full disk stops Postgres writes **and** backups.

---

## 10. Known limits (deliberately accepted for phase 1)

- Single node: host failure = downtime until DNS/restore (~30 min).
- 24 h RPO on the database (no WAL archiving). Raise to ≤6 h before 10k users.
- 100 GB disk is shared by DB bodies, WAL, images, logs and dumps; unbounded
  email-body growth is the first limit hit at scale (guide §16.2b, A8).
- No Prometheus/Grafana yet — health endpoint + Healthchecks.io + Docker logs.
  `/api/health/metrics` is ready for a scraper when you want one.
- Image builds run on the VPS (~3–5 min, needs the 4 GB swap that
  `bootstrap.sh` creates). Move to GHCR + GitHub Actions when deploy time
  starts to hurt.

---

## Appendix — file map

```
deploy/
  docker-compose.yml        the stack
  Caddyfile                 TLS + reverse proxy
  .env.example              infra values (copy to .env)
  app.env.example           runtime env template
  postgres/init/            first-boot extensions
  scripts/
    render-env.mjs          .env -> app.env + .env (workstation)
    bootstrap.sh            one-time host hardening/prep
    harden-ssh.sh           key-only SSH (run after verifying key)
    deploy.sh               build -> migrate -> roll
    rollback.sh             previous image tag
    backup-postgres.sh      nightly dump + R2
    restore-postgres.sh     restore drill
    import-database.sh      Neon -> local cutover
    cron.sh                 authenticated cron trigger
    healthcheck.sh          readiness + disk probe
```
