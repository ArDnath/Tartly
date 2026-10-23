# Tartly — Production Deployment Guide

**Version:** 1.0.0
**Applies to:** `tartly.in` on Hostinger KVM 2 (`srv2076028.hstgr.cloud`, `201.18.197.194`)
**Companion state file:** [`DEPLOYMENT-TRACKER.md`](./DEPLOYMENT-TRACKER.md)
**Day-2 quick reference:** [`RUNBOOK.md`](./RUNBOOK.md)

---

## 0. How to use this guide

### 0.1 Who this is for

An engineer or AI agent who has never seen this repository, taking over a **partially deployed** production system. Every stage is written so it can be executed, verified, and resumed without tribal knowledge.

### 0.2 Reading order

1. **`DEPLOYMENT-TRACKER.md`** — current state, blockers, next action. Always first.
2. **This guide, §1–§2** — architecture, SLOs, capacity model. Never skip; every later decision depends on them.
3. **The stage you are about to run** — each stage has *Purpose → Preconditions → Steps → Verify → Failure modes → Exit criteria*.
4. **`RUNBOOK.md`** — for day-2 operations after launch.

### 0.3 Document hierarchy

```
DEPLOYMENT-TRACKER.md   ← mutable state (what is true right now)
        │
DEPLOYMENT-GUIDE.md     ← immutable procedure + rationale (how to do it)
        │
deploy/scripts/*        ← executable form of the procedure
        │
RUNBOOK.md              ← condensed day-2 commands
```

When they disagree, **the live server wins**; then update the tracker and this guide. Never silently deviate.

### 0.4 Golden rules

1. **Measure → change one thing → verify → record.** No batched guessing.
2. **Every destructive action has a backup and a rollback.** If it doesn't, you are not ready.
3. **Secrets never leave the host** (except into your password manager, encrypted).
4. **The edge is the only public surface.** Databases and app ports never bind to `0.0.0.0` on the host.
5. **A deploy is not done until `/api/health/ready` is 200 and a real user flow works.**
6. **At scale, the bottleneck moves.** Fix the active constraint, not the one you remember.
7. **An untested restore is not a backup.** Drill monthly.

### 0.5 Sources synthesized into this guide

| Source | What was taken |
| --- | --- |
| `docs/SKILL-v2.md` §4 | Auth, session cookies, BOLA/IDOR, rate-limit policy, constant-time comparisons |
| `docs/SKILL-v2.md` §5 | Graceful shutdown ordering, 530 readiness, circuit breakers, backoff+jitter |
| `docs/SKILL-v2.md` §6 | Migration discipline, indexing, N+1, pool sizing, PgBouncer, read replicas |
| `docs/SKILL-v2.md` §7 | Cache-aside, TTLs, stampede protection, key namespacing |
| `docs/SKILL-v2.md` §8 | Queue separation, idempotency, DLQ, visibility timeout |
| `docs/SKILL-v2.md` §9 | Presigned direct uploads, policy bounds, metadata separation |
| `docs/SKILL-v2.md` §10 | Webhook HMAC verification, quick-ack, idempotency, outbox |
| `docs/SKILL-v2.md` §12–13 | 12-factor config, structured logs, RED/USE metrics, health probes |
| `docs/SKILL-v2.md` §15–16 | Multi-stage non-root images, CI gates, 20-point readiness audit |
| `.agents/skills/upstash-redis-js/performance/*` | Auto-pipelining, serialization, replica reads, TTLs |
| `.agents/skills/upstash-ratelimit-js/*` | Sliding-window/token-bucket, edge enforcement, command cost |
| `.agents/skills/polar-integration` | Checkout/webhook/portal patterns (same shape as Dodo) |
| `.agents/skills/frontend-design/SKILL.md` | Scanned; no operational content — intentionally not applied here |
| User-supplied *high-scale-low-cost* skill | Four resource budgets, moving-bottleneck ladder, 1M RPS math, cost tables, load-test protocol |
| Live server inspection (2026-10-23) | Actual versions, topology, data counts, failure modes hit during deployment |

### 0.6 Secure-and-fast defaults already in force

| Area | Default | Where |
| --- | --- | --- |
| Transport | TLS 1.2+, HSTS 2 years, HTTP/2 + HTTP/3 | Caddy + `next.config.ts` |
| Edge | compression (zstd/gzip), `-Server`, health-aware LB, SSE-safe flushing | `Caddyfile` |
| App | nonce CSP (report-only), contract validation, per-user rate limits | `proxy.ts`, `lib/env.ts` |
| Host | key-only SSH, UFW 22/80/443, fail2ban, unattended upgrades | `bootstrap.sh`, `harden-ssh.sh` |
| Containers | non-root where possible, `no-new-privileges`, memory caps, no published ports | `docker-compose.yml` |
| Data | Postgres tuned for NVMe, Redis AOF + `noeviction`, private network only | §6 |
| Delivery | 2 replicas, readiness 530, graceful drain, immutable tags | §7 |
| Recovery | nightly dump + zstd verify + offsite hook, restore drill | §13 |
| Observability | structured logs, `/live`, `/ready`, token-gated metrics | §12 |

The gaps that are **not yet** at this standard are tracked explicitly in
`DEPLOYMENT-TRACKER.md` §6 — chiefly secret rotation, R2 uploads, offsite
backups, external alerting, and CI.

---

## 1. System profile

### 1.1 What Tartly is

A Next.js 16 web email client with an AI operator. It connects Gmail (and optionally Outlook) and Calendar, triages mail, drafts replies in the user's voice, proposes meetings, and runs follow-ups. A human approval gate guards every send; autopilot is opt-in and policy-clamped.

**Traffic shape:** long-lived, authenticated, low-RPS, high-fan-out. Each active user holds an SSE stream to an AI provider and makes periodic mail-sync calls. This is **not** a 1M RPS CRUD API; the scarce resources are AI tokens, third-party API quotas, DB connections, and memory per stream — not raw HTTP throughput. §16 still covers the path to extreme RPS because the architecture must not block it.

### 1.2 Components

| Component | Image / version | Role | State |
| --- | --- | --- | --- |
| `web-1`, `web-2` | `tartly-web:<tag>` (Next.js standalone) | HTTP, SSR, API routes, SSE | stateless |
| `worker` | `tartly-worker:<tag>` (Node + tsx) | durable queue consumer | stateless (claims from PG) |
| `postgres` | `postgres:18-alpine` | source of truth, queue, sessions fallback | **stateful** |
| `redis` | `redis:7-alpine` | sessions/cache/rate limits, AOF | **stateful** |
| `redis-http` | `hiett/serverless-redis-http` | Upstash REST facade over Redis | stateless |
| `caddy` | `caddy:2-alpine` | TLS, HTTP/2+3, reverse proxy | config + cert state |
| Cloudflare R2 | external | email assets (presigned uploads) | external |
| Google APIs | external | Gmail, Calendar, Pub/Sub, OAuth | external |
| Dodo Payments | external | billing + webhooks | external |
| AI provider | external | drafts, triage, agent | external |

### 1.3 Data flows

```
A. Inbound mail
   Gmail ──Pub/Sub push──► POST /api/webhooks/gmail ──► job_queue (PG)
                                                          │
                                            worker ◄──────┘
                                              │
                                   Gmail API ─┴─► AI provider ─► drafts/thread_states

B. User request
   Browser ──HTTPS──► Caddy ──► web-1/2 ──► Postgres (truth)
                                       └──► Redis (session/cache)
                                       └──► R2 (attachment bytes, proxied)

C. Billing
   Dodo ──webhook──► POST /api/webhooks/dodo ──► billing_* tables ──► entitlements

D. Scheduled work
   cron ──Bearer CRON_SECRET──► /api/v1/cron/{daily,followups,autopilot}
                                   └──► enqueue jobs ──► worker
   worker drains continuously (no /cron/drain needed on this host)
```

### 1.4 Trust boundaries

```
┌──────────────────────────────────────────────────────────────────────┐
│ INTERNET (untrusted)                                                 │
│   browsers · Google Pub/Sub · Dodo webhooks · attackers              │
└───────────────┬──────────────────────────────────────────────────────┘
                │ 443/80 only (UFW)
┌───────────────▼──────────────────────────────────────────────────────┐
│ EDGE — Caddy: TLS termination, HTTP/2+3, compression, health checks  │
└───────────────┬──────────────────────────────────────────────────────┘
                │ private Docker network (no host ports)
┌───────────────▼──────────────────────────────────────────────────────┐
│ APP — web-1/web-2/worker: untrusted input validation, authz, CSP     │
└───────────────┬──────────────────────────────────────────────────────┘
                │ private network
┌───────────────▼──────────────────────────────────────────────────────┐
│ DATA — Postgres / Redis: no public listener, volume-backed           │
└──────────────────────────────────────────────────────────────────────┘
```

**Invariants**

- No container except Caddy publishes a host port.
- The app never trusts a client-supplied `user_id`; every query is scoped by the authenticated session.
- Webhook bodies are verified against the raw bytes before parsing (HMAC).
- Uploads go browser → R2 with a short-lived presigned URL; the app server never buffers large blobs.
- `NEXT_PUBLIC_*` values are build-time only; everything secret is runtime.

### 1.5 State inventory (what must survive)

| State | Where | Backup | Loss impact |
| --- | --- | --- | --- |
| Users, mailboxes, threads, drafts, billing | Postgres volume `tartly_pgdata` | nightly dump → R2 | catastrophic |
| Sessions, rate-limit counters, cache | Redis volume `tartly_redisdata` | not backed up (regenerable) | users re-login |
| TLS certificates, ACME account | Caddy volume `tartly_caddy_data` | re-issuable | brief TLS outage |
| Attachments / uploads | R2 bucket | R2 durability + versioning | user data loss |
| Runtime secrets | `deploy/app.env`, `deploy/.env` | password manager | total outage / token loss |
| Images | local Docker / (later GHCR) | rebuild from git | deploy delay |

---

## 2. Capacity, SLOs, and the four budgets

### 2.1 Service-level objectives

| SLO | Target | Measurement |
| --- | --- | --- |
| Availability | 99.9% monthly | external 1-min probe on `/api/health/ready` |
| Non-AI API latency | p95 < 300 ms, p99 < 800 ms | metrics endpoint + logs |
| AI first token | p95 < 2.5 s | provider + app logs |
| Error rate | < 1% 5xx over 5 min | Caddy access logs / metrics |
| Backup RPO | ≤ 24 h | dump timestamp |
| Restore RTO | ≤ 30 min | drill |
| Deploy downtime | 0 failed requests (rolling) | Caddy health checks |

### 2.2 Workload model (why "1M RPS" is the wrong first target)

| Metric | Realistic for this app |
| --- | --- |
| Registered users | 10k–100k |
| Daily active | 5–20% |
| Concurrent SSE streams | hundreds, not millions |
| API RPS at 1k concurrent users | tens to low hundreds |
| Dominant cost | AI tokens, not bandwidth |
| Dominant latency | upstream AI + Gmail API, not CPU |

**What the single node actually handles well:** 10k active users with the §16.2b preconditions (1–2k concurrent sessions), hundreds of concurrent AI streams, tens of thousands of cached/static requests per second. It will hit **DB connections, Redis throughput, memory per stream, disk (email bodies), and provider quotas** long before NIC bandwidth.

### 2.3 The four resource budgets

| Resource | Warning signs | Defense in this stack | Cost/security impact |
| --- | --- | --- | --- |
| **Network** | retransmits, `TIME_WAIT` growth, NIC ceiling | Caddy zstd/gzip, HTTP/2+3, small JSON, R2 for blobs, no proxying of large assets | egress bills; DDoS amplification |
| **CPU** | per-core 100%, high `sy`, GC pauses | 2 web replicas, standalone tracing, per-module imports, no image processing on the hot path | right-sizing; TLS at edge |
| **Memory** | swap-in, OOM kills, heap churn | 900 MB web cap, 1 GB worker cap, 3 GB PG cap, stream count limits | prevents cascade restarts |
| **Disk / IOPS** | `wa`, lock waits, pool exhaustion | tuned PG, indexes, queue in PG, AOF everysec, log rotation | provisioned-IOPS bills avoided |

### 2.4 Useful formulas

```
Required bandwidth (GB/s) = RPS × avg_response_bytes ÷ 1e9
Required NIC (Gbps)       = bandwidth_GBs × 8

Concurrent requests (Little's law) = arrival_rate × avg_latency
  e.g. 500 RPS × 0.3 s = 150 in-flight

Postgres pool ceiling ≈ (CPU cores × 2) + effective_spindles
  this node: 2 vCPU → keep total app connections ≤ 40 (we use 8+8+4 = 20 of 120)

Connection RAM ≈ connections × work_mem  (sort/hash heavy queries)
  watch for work_mem × max_connections exceeding RAM
```

### 2.5 The moving-bottleneck ladder

```
Framework overhead → single-core CPU → network/payload → DB IOPS & locks
→ cache throughput → serialization → load-balancer limits → client generator
```

At every stage, **only one constraint is active**. Measure before changing. The stage-by-stage path for this app is in §16.

### 2.6 Current baseline (measured 2026-10-23)

| Metric | Value |
| --- | --- |
| Host CPU / RAM | 2 vCPU / 7.7 GiB |
| Idle app memory | ~400 MB total (web 62–74 MB each, worker 98 MB, PG 98 MB, Redis 3 MB, SRH 61 MB) |
| Disk used | 22 GB of 96 GB (22%) after a clean rebuild — includes 5.8 GB build cache |
| Ready latency | 17–33 ms (local) |
| DB size | ~13 MB source; dozens of tables, 26 migrations |

There is substantial headroom. Do not add infrastructure before measuring §15.

### 2.7 Target workload — 10k active users (not 10k RPS)

The product target is **10,000 active users**. That is a *user* number, not a
request number, and the two must not be mixed when sizing. This section is the
bridge; §16 uses it to decide when a stage is actually reached.

| Metric | Target at 10k active users | Derivation |
| --- | --- | --- |
| Active users (DAU) | 10,000 | product target |
| Peak concurrent sessions | 1,000–2,000 | 10–20% of DAU |
| API RPS at peak | 100–400 | 2–4 requests/min per active session |
| Postgres QPS | 1,000–4,000 | 3–10 queries per request |
| Open SSE streams | 1,000–2,000 | 1–3 per session, capped per user |
| Concurrent AI generations | 50–100 | provider quota + memory per stream |
| Egress | 0.3–1.5 TB/month | 1–5 MB/user/day, attachments via R2 |
| DB growth (raw) | 3–10 GB/day | 10–30 messages/day × measured ~32 kB |

**The two numbers people confuse**

- **10k active users** → ~100–400 RPS → this node can do it with the conditions in §16.2b.
- **10k concurrent requests** → thousands of RPS (≈10k RPS if each request takes 1 s) → Stage C (multiple app nodes + managed data), not this node.

A single Next.js request is not one database query. Measure the queries per
endpoint during §15; the DB QPS column above is the number that decides whether
Postgres is the bottleneck, not the RPS.

**The binding constraint is disk, not bandwidth.** 8 TB/month ≈ 25 Mbps
sustained; 10k users at 1–5 MB/day use well under it. The 100 GB NVMe is shared
by Postgres (including full email bodies), WAL, Docker images, logs and local
dumps. See §13.5.1 and A8 in the tracker.

---

## 3. Stage 0 — Prerequisites and accounts

**Purpose:** ensure every external dependency exists before touching the host, so deployment is not blocked mid-way.
**Time:** 30–60 min (mostly waiting on DNS).

### 3.1 Accounts and values

| Dependency | What you need | Where it goes | Status |
| --- | --- | --- | --- |
| Hostinger VPS | IP, root access, panel | SSH, DNS, snapshots | ✅ |
| Domain `tartly.in` | DNS zone control | A record `@` → host IP | ⛔ pending |
| Google Cloud | OAuth Web client (ID/secret), Gmail + Calendar APIs, Pub/Sub topic | `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_PUBSUB_TOPIC` | 🟡 redirect pending |
| Dodo Payments | API key, webhook signing key, product IDs | `DODO_*` | 🟡 webhook key empty |
| Cloudflare R2 | 2 buckets + S3 API token | `S3_*`, `/etc/tartly/backup.env` | ⬜ |
| AI provider | API key + base URL + model IDs | `OPENCODE_*`, `AI_*` | ✅ |
| Search provider | Tavily key | `SEARCH_API_KEY` | ✅ |
| Healthchecks.io | 1 check + ping URL | `/etc/tartly/backup.env` | ⬜ |
| GitHub | repo access / deploy key | deploy source | ✅ clean tag `83ccc5a`; host deploy key pending (A11) |
| ImageKit | URL endpoint (public build-time) | `NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT` | ✅ |

### 3.2 DNS records (the only required change)

`tartly.in` uses Hostinger nameservers. `www` is a **CNAME → `tartly.in`**, so only the apex changes:

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| A | `@` | `201.18.197.194` | 300 |
| CNAME | `www` | `tartly.in` | existing |

**Do not** change nameservers; MX/TXT/SPF/DKIM must survive.

Verify:

```bash
dig +short tartly.in        # 201.18.197.194
dig +short www.tartly.in    # follows CNAME → 201.18.197.194
```

### 3.3 Server specification

| Resource | Value | Constraint it creates |
| --- | --- | --- |
| 2 vCPU | build + 2 web + worker + PG | builds are the only CPU spike; 4 GB swap covers it |
| 8 GB RAM | caps in compose | max ~4 concurrent AI streams per GB with headroom |
| 100 GB NVMe | images ~4 GB, DB small | logs and backups are the growth risk |
| 8 TB/mo | ~30 Mbps sustained | not a constraint at this scale |

### 3.4 Cost model (this deployment)

| Item | Monthly |
| --- | --- |
| Hostinger KVM 2 | plan price (already paid) |
| Domain | annual |
| R2 | storage + ops, zero egress |
| AI provider | dominant variable cost |
| Healthchecks.io | free tier sufficient |
| **Total infra** | **low tens of USD + AI usage** |

Extreme-scale cost tables are in §17.

### 3.5 Exit criteria

- [ ] You can SSH as `root` once (first bootstrap).
- [ ] You know which Google OAuth client the app uses.
- [ ] You have (or have deferred, in writing) R2 credentials.
- [ ] You have decided the domain (here: `tartly.in`).

---

## 4. Stage 1 — Host bootstrap

**Purpose:** turn a fresh Ubuntu image into a hardened Docker host.
**Script:** `deploy/scripts/bootstrap.sh` (idempotent).
**Time:** 5–10 min.

### 4.1 What the script does, and why

| Step | Action | Why |
| --- | --- | --- |
| Packages | `curl gnupg git rsync ufw fail2ban unattended-upgrades dnsutils zstd jq htop chrony rclone logrotate` | every later stage depends on one of these |
| Swap | 4 GB `/swapfile`, `swappiness=10` | `next build` can spike above 8 GB; OOM-killing the build is a bad first impression |
| sysctl | `somaxconn=4096`, `tcp_fastopen=3`, `file-max=200000`, BBR | absorbs bursts, better RTT, higher fd ceiling |
| Docker | official repo if the Ubuntu codename exists, else distro packages; daemon log caps; `live-restore` | Hostinger ships Ubuntu 26.04 (`resolute`), which Docker's repo may not know yet — the fallback is intentional |
| User | `deploy` (sudo + docker), copies root's `authorized_keys` | non-root operations; same key works |
| UFW | deny incoming; allow 22/80/443/tcp+udp only | the only public surface |
| fail2ban | sshd jail, 5 tries / 10 min / 1 h ban | credential noise reduction |
| Unattended upgrades | security patches | closes known CVEs without a human |
| chrony | time sync | TLS, JWT, logs, HMAC timestamps |
| Cron | backup, daily, followups, autopilot, health | replaces Vercel Cron |
| Logrotate | `tartly-cron.log` weekly ×8 | prevents slow disk fill |

### 4.2 Run it

```bash
ssh root@201.18.197.194 'bash -s' < deploy/scripts/bootstrap.sh
```

Expected tail: `Host is ready…`, UFW table showing only 22/80/443.

### 4.3 Verify

```bash
ssh deploy@201.18.197.194 '
  docker --version && docker compose version
  swapon --show
  sudo ufw status verbose
  systemctl is-active docker fail2ban unattended-upgrades chrony
  free -h; df -h /
'
```

Observed on this host:

```
Docker version 29.9.2, build a82e528
Docker Compose version v5.6.1
/swapfile  file  4G  0B  -1
Status: active — 22/tcp, 80/tcp, 443/tcp, 443/udp
docker active · fail2ban active · unattended-upgrades active · chrony active
```

### 4.4 SSH hardening — the gotcha that locks people out

`deploy/scripts/harden-ssh.sh` writes `/etc/ssh/sshd_config.d/00-tartly.conf`.

**Why `00-` and not `99-`:** sshd uses the **first** value it sees for each keyword. `50-cloud-init.conf` ships with `PasswordAuthentication yes`; a `99-` file loses the race and `sshd -T` still reports `yes`. The script both uses `00-` and rewrites the cloud-init file.

```bash
ssh root@201.18.197.194 'bash /opt/tartly/deploy/scripts/harden-ssh.sh'
ssh root@201.18.197.194 'sshd -T | grep -E "^(passwordauthentication|permitrootlogin)"'
# passwordauthentication no
# permitrootlogin prohibit-password
```

Then prove password auth is dead:

```bash
ssh -o BatchMode=yes -o PreferredAuthentications=password \
    -o PubkeyAuthentication=no -o NumberOfPasswordPrompts=0 \
    root@201.18.197.194 'echo SHOULD_NOT_HAPPEN'
# Permission denied (publickey).
```

> **Recovery:** Hostinger web console / rescue mode. Root still has key-only access, so keep a working key on another machine or in the panel before removing all local copies.

### 4.5 Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| `docker compose` missing | Docker repo lacked `resolute`; fallback installed `docker-compose-v2` | `docker compose version`; if absent, `apt install docker-compose-v2` |
| SSH hangs after hardening | wrong key or cloud-init override | Hostinger console → restore `/etc/ssh/sshd_config.d/00-tartly.conf`; verify `sshd -T` |
| Build OOM-killed | no swap / too many parallel builds | confirm `swapon --show`; `docker compose build --parallel 1` |
| UFW blocks ACME | 80/tcp closed | `sudo ufw allow 80/tcp` |
| Time drift breaks webhooks | chrony not running | `timedatectl; systemctl restart chrony` |

### 4.6 Exit criteria

- [ ] `deploy` user can SSH with a key and run `sudo -n true`.
- [ ] Docker daemon reachable by `deploy`.
- [ ] UFW active with exactly 22/80/443.
- [ ] Password SSH denied.
- [ ] 4 GB swap active.
- [ ] `chrony` synced.

---

## 5. Stage 2 — Secrets and configuration

**Purpose:** produce a validated, reproducible runtime environment without leaking secrets into git or image layers.
**Files:** `deploy/app.env` (runtime), `deploy/.env` (Compose interpolation), `deploy/scripts/render-env.mjs`.

### 5.1 The 12-factor rules applied here

| Rule | Implementation |
| --- | --- |
| Config in env, not code | `lib/env.ts` Zod schema; boot fails fast on invalid config |
| Build ≠ release ≠ run | image built from placeholders; secrets injected at `docker compose up` |
| Backing services as attached resources | `DATABASE_URL`, `UPSTASH_REDIS_REST_URL`, S3 endpoint are just URLs |
| Stateless processes | sessions in Redis, assets in R2, queue in PG |
| Logs to stdout | Docker `json-file` with 20 MB × 5 rotation |
| Admin processes as one-offs | migrations run via `docker compose run --rm worker npm run db:migrate` |

### 5.2 Two files, two jobs

| File | Read by | Interpolated? | Contains |
| --- | --- | --- | --- |
| `deploy/app.env` | containers (`env_file`) | **no** — `$` is literal | 39 runtime variables, mode 0600 |
| `deploy/.env` | Compose CLI | yes — `$` must be escaped | Postgres password, Redis token, tag, public URL, build args |

Keep them separate. Merging them either mangles secrets containing `$` or leaks infra values into the app.

### 5.3 Render from the workstation

```bash
node deploy/scripts/render-env.mjs https://tartly.in
```

Rules the script enforces:

- Provider keys come from the repo-root `.env` (never printed).
- Production topology wins: `DATABASE_URL` → `postgres:5432`, `UPSTASH_REDIS_REST_URL` → `http://redis-http:80`.
- Generated secrets are **persisted**: re-running never rotates a live secret.
- Missing required keys abort with a names-only list.
- `BETTER_AUTH_SECRET` shorter than 32 chars produces a warning (see §5.6).

Ship it:

```bash
rsync -av deploy/app.env deploy/.env deploy@201.18.197.194:/opt/tartly/deploy/
ssh deploy@201.18.197.194 'chmod 600 /opt/tartly/deploy/app.env /opt/tartly/deploy/.env'
```

### 5.4 Environment matrix

**Required (boot fails without them)**

| Variable | Example shape | Secret | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | `postgresql://tartly:…@postgres:5432/tartly` | ✅ | internal hostname only |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` | ✅ | **rotating it invalidates OAuth tokens** |
| `BETTER_AUTH_URL` | `https://tartly.in` | — | canonical origin |
| `NEXT_PUBLIC_BETTER_AUTH_URL` | `https://tartly.in` | — | baked at build |
| `GOOGLE_CLIENT_ID` / `_SECRET` | `…apps.googleusercontent.com` | ✅ | redirect URI must match |
| `UPSTASH_REDIS_REST_URL` | `http://redis-http:80` | — | shim, not SaaS |
| `UPSTASH_REDIS_REST_TOKEN` | 48 hex chars | ✅ | same token in compose `.env` |

**Operational**

| Variable | Default | Purpose |
| --- | --- | --- |
| `DB_POOL_MAX` | 8 (web) / 4 (worker) | per-process pg pool |
| `LOG_LEVEL` | `info` | structured logger |
| `CSP_MODE` | `report` → then `enforce` | nonce CSP burn-in |
| `API_CONTRACT_VALIDATION` | `enforce` | OpenAPI request validation |
| `API_RATE_LIMIT_PER_MIN` | 300 | per-user API default |
| `AGENT_RATE_LIMIT_PER_MIN` | 20 | expensive AI runs |
| `ASSET_RATE_LIMIT_PER_MIN` | 30 | uploads |
| `METRICS_TOKEN` | generated | bearer for `/api/health/metrics` |
| `CRON_SECRET` | generated | bearer for `/api/v1/cron/*` |
| `AUTOPILOT_ENABLED` | unset (off) | global kill switch |

**Feature integrations (optional but needed for full function)**

| Variable | Needed for |
| --- | --- |
| `GOOGLE_PUBSUB_TOPIC`, `GOOGLE_PUBSUB_AUDIENCE` | Gmail push / email operator |
| `DODO_PAYMENTS_API_KEY`, `_WEBHOOK_KEY`, `_ENVIRONMENT`, product IDs | billing |
| `S3_*`, `ASSET_STORAGE_DRIVER=s3` | uploads |
| `NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT` | media (build-time) |
| `SEARCH_API_KEY` | research tool |
| `OPENCODE_API_KEY`, `AI_*` | AI features |
| `MICROSOFT_*` | Outlook |

**Build-time only (must be present at `next build`)**

`NEXT_PUBLIC_BETTER_AUTH_URL`, `NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT`, `NEXT_PUBLIC_CAL_BOOKING_LINK`, `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, `NEXT_PUBLIC_MICROSOFT_CONNECT_ENABLED`.

> Setting a `NEXT_PUBLIC_*` only at runtime is too late — the client bundle is already frozen. The Dockerfile accepts them as build args; Compose passes them from `deploy/.env`.

### 5.5 Generation commands

```bash
openssl rand -base64 32     # BETTER_AUTH_SECRET
openssl rand -hex 24        # POSTGRES_PASSWORD / REDIS_REST_TOKEN
openssl rand -hex 32        # METRICS_TOKEN
openssl rand -hex 24        # CRON_SECRET (if not already set)
```

### 5.6 Secret rotation

| Secret | Procedure | Side effects |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | edit `app.env`; `up -d --force-recreate web-1 web-2 worker` | **all sessions invalid; all encrypted Gmail/Outlook tokens undecryptable → reconnect** |
| `POSTGRES_PASSWORD` | `ALTER ROLE tartly PASSWORD …`; update `app.env` + `.env`; recreate app | brief reconnect errors |
| `UPSTASH_REDIS_REST_TOKEN` | update `app.env` + `.env`; recreate `redis-http` and app | sessions survive (Redis data intact) |
| Google client secret | rotate in GCP; update `app.env`; recreate | users may need to re-auth |
| Dodo webhook key | rotate in dashboard; update `app.env`; recreate | webhooks fail until both sides match |
| R2 keys | create new token; update `app.env`; recreate | none |

**Always** take a dump before rotating anything that affects stored data, and record the rotation in the tracker §7.

### 5.7 Common mistakes

| Mistake | Consequence | Prevention |
| --- | --- | --- |
| Empty string vs unset | Zod treats `""` as unset (handled in `lib/env.ts`) — but build-time `NEXT_PUBLIC` empty is inlined | keep optional public vars out of build args when empty |
| `$` in Compose `.env` | silent interpolation/truncation | never put secrets with `$` in `.env`; app.env is not interpolated |
| Editing `app.env` without recreating | old env still in the container | `up -d --force-recreate` |
| Committing `app.env` | credential leak | `.gitignore` + `.dockerignore` |
| Changing `NEXT_PUBLIC_*` at runtime | no effect | rebuild |

### 5.8 Validate

```bash
ssh deploy@201.18.197.194 'cd /opt/tartly/deploy && docker compose --env-file .env config >/dev/null && echo COMPOSE_OK'
ssh deploy@201.18.197.194 'cd /opt/tartly/deploy && docker compose --env-file .env logs --tail 50 web-1 | grep -i "invalid environment" || echo ENV_OK'
```

### 5.9 Exit criteria

- [ ] `app.env` and `.env` exist, mode 0600, owned by `deploy`.
- [ ] `docker compose config` exits 0.
- [ ] App boots without “Invalid environment variables”.
- [ ] No secret exists in git or in an image layer (`docker history`).

---

## 6. Stage 3 — Data services

**Purpose:** bring up Postgres and Redis with settings appropriate for 8 GB / 2 vCPU, then prove the app can reach them.
**Time:** 2 min.

### 6.1 Postgres 18

```yaml
image: postgres:18-alpine
PGDATA: /var/lib/postgresql/data/pgdata
max_connections=120
shared_buffers=2GB
effective_cache_size=5GB
work_mem=16MB
maintenance_work_mem=256MB
wal_compression=on
max_wal_size=2GB
checkpoint_completion_target=0.9
random_page_cost=1.1          # NVMe
effective_io_concurrency=200  # NVMe
log_min_duration_statement=1000
shared_preload_libraries=pg_stat_statements
```

**Why these values**

| Setting | Reasoning |
| --- | --- |
| `shared_buffers=2GB` | ~25% of RAM; leaves room for web/worker/Redis |
| `effective_cache_size=5GB` | tells the planner the OS page cache is large; favours index scans |
| `work_mem=16MB` | 120 × 16 MB = 1.9 GB worst case; keeps sorts in memory without OOM risk |
| `random_page_cost=1.1` | NVMe random reads ≈ sequential; default 4.0 wrongly prefers seq scans |
| `max_connections=120` | app uses 20; headroom for psql, backups, monitoring |
| `pg_stat_statements` | required for §15 query tuning |

**Why Postgres 18:** the source Neon cluster runs **18.6**. `pg_dump` 17 refuses to dump a newer major (`aborting because of server version mismatch`). Matching the major removes the problem and keeps future restores symmetrical.

### 6.2 Redis

```yaml
image: redis:7-alpine
appendonly yes
appendfsync everysec
maxmemory 512mb
maxmemory-policy noeviction
save "900 1"
```

- AOF `everysec` bounds loss to ~1 s without fsync-per-write latency.
- **`noeviction` is deliberate**: sessions live here; silently evicting them logs users out and breaks rate-limit accounting. If memory pressure appears, raise the cap or move rate-limit keys to a separate logical DB.
- Redis is single-threaded (~100k ops/s). At this scale it is idle; §16 explains sharding when it is not.

### 6.3 Upstash REST shim

The application uses `@upstash/redis` over HTTP. `hiett/serverless-redis-http` translates those REST calls to RESP against local Redis, so no code changes and no SaaS dependency:

```yaml
SRH_MODE: env
SRH_TOKEN: ${REDIS_REST_TOKEN}
SRH_CONNECTION_STRING: redis://redis:6379
```

The app points at `http://redis-http:80`. If you ever move back to Upstash, change two env vars and redeploy — nothing else.

> **Performance note:** HTTP-over-Redis adds overhead vs a TCP client. It is negligible at this scale and preserves the serverless portability the codebase was built for. At very high cache RPS, replace the shim with a direct client (see §16, stage D).

### 6.4 Connection math

| Process | `DB_POOL_MAX` | Instances | Total |
| --- | --- | --- | --- |
| web | 8 | 2 | 16 |
| worker | 4 | 1 | 4 |
| migrations/backups | 1–2 | transient | 2 |
| **Total** | | | **~22 of 120** |

Add PgBouncer (transaction mode) before running more than ~6 web replicas or any serverless functions.

### 6.5 Migrations

- Drizzle, versioned SQL under `drizzle/`, journal in `drizzle/meta/_journal.json`.
- **Never** `db:push` in production; only `db:migrate`.
- Run as a one-off before rolling web:

```bash
docker compose --env-file .env run --rm --no-deps worker npm run db:migrate
```

- Migrations are forward-only. A destructive migration requires a pre-deploy dump and a written rollback plan.
- 26 migrations applied successfully on 2026-10-23.

### 6.6 Verify

```bash
ssh deploy@201.18.197.194 'cd /opt/tartly/deploy && \
  docker compose --env-file .env exec -T postgres pg_isready -U tartly -d tartly && \
  docker compose --env-file .env exec -T redis redis-cli ping && \
  docker compose --env-file .env exec -T web-1 node -e "fetch(\"http://127.0.0.1:3000/api/health/ready\").then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)})"'
```

Expected: `accepting connections`, `PONG`, then `200 {"status":"ready",…}`.
The readiness probe calls `redis.ping()` through the Upstash REST shim, so a 200 proves the
whole web → `redis-http` → Redis path — stronger than poking the shim directly.

### 6.7 Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| `pg_dump: server version mismatch` | client major < server major | use matching major (`postgres:18`) |
| `connection refused` from web | PG not healthy / wrong hostname | `docker compose ps`; service name must be `postgres` |
| Redis `OOM command not allowed` | `maxmemory` reached with `noeviction` | raise cap, inspect keys, add TTLs |
| readiness 530 | PG or Redis ping failed | check logs; `pingDatabase` / `redis.ping` |
| volume permission denied | UID mismatch after restore | `chown -R 999:999` on `pgdata` (postgres UID) |

### 6.8 Exit criteria

- [ ] `pg_isready` and `redis-cli ping` pass.
- [ ] `pg_stat_statements` extension exists.
- [ ] Migrations complete.
- [ ] `/api/health/ready` returns `200` with both checks `up`.

### 6.9 Data placement — local vs managed (decision)

Both data services are **local today on purpose**. This is the decision table
and the exact triggers that reverse it; do not re-litigate it without one of
the triggers firing.

**Postgres**

| Factor | Local (current) | Managed (Neon/Supabase/RDS, Mumbai) |
| --- | --- | --- |
| Query latency | ~0.1–0.3 ms | low single-digit ms per round trip; compounds over 3–10 queries/request |
| Cost | included in the VPS | paid tier + storage/compute |
| Backup / PITR | nightly dumps (24 h RPO) | PITR, point-in-time restore |
| HA | none | yes (database only) |
| Failure domain | same host and disk as the app | separate |
| Disk | shares 100 GB | separate |
| Ceiling | ~2 vCPU / 8 GB, tuned | much higher |
| Ops | you (tuning, upgrades, restores) | provider |

**Keep local while:** one app node, DB < 20 GB, p95 query time < 50 ms after
indexing, and a 24 h RPO is acceptable.

**Move to managed when any one is true:**
1. You add a **second app node** — the DB must not live on node 1.
2. DB size > **20–25 GB**, or compressed dumps > ~2 GB.
3. DB CPU > **60% sustained**, or p95 query > **50 ms** after indexes/pool tuning.
4. You need **RPO < 24 h**, PITR, HA or compliance.
5. Web and Postgres still compete for CPU after a vertical resize.

**Migration (cheap, do it before it is urgent):**
1. `pg_dump -Fc` → restore into the managed instance (same major, 18).
2. Point `DATABASE_URL` at the **pooled** endpoint (Neon `-pooler` / Supavisor / PgBouncer).
3. Run `npm run db:migrate`, verify row counts, then run the §11.1 matrix.
4. Keep the local DB read-only for 7 days as a fallback, then decommission it.
5. Keep app and data in the **same region**; never split PG and Redis across regions.

**Redis**

| Factor | Local + SRH (current) | Managed (Upstash) |
| --- | --- | --- |
| Latency | ~0.1 ms | network RTT per command |
| Cost | included | per-command pricing |
| HA | none | yes |
| Persistence | AOF `everysec` (~1 s loss) | provider-managed |
| Session loss | Postgres is the durable store, Redis is a speed layer | same |
| Ceiling | ~100k ops/s, single-threaded | higher / clustered |

**Keep local while:** one app node, Redis CPU < 60%, < 100k ops/s, and memory
under the 512 MB cap.

**Move when any one is true:** a second app node, Redis CPU > 60%, eviction/OOM
errors, or a need for HA.

**Migration:** change `UPSTASH_REDIS_REST_URL` + token, restart web/worker, run
the readiness probe. Sessions may be lost once (users sign in again); the
Postgres fallback keeps the app correct. At high RPS, replace the SRH HTTP shim
with a direct client and split session keys from rate-limit keys.

> **Why not move both now:** at this scale the SaaS services would add latency
> and a monthly bill without removing the real single-node SPOF. The migration
> path is two env vars plus a dump, so waiting costs nothing.

---

## 7. Stage 4 — Build and release

**Purpose:** produce immutable, non-root images and roll them with no failed requests.
**Script:** `deploy/scripts/deploy.sh`.

### 7.1 Image stages

| Stage | Base | Contents | Purpose |
| --- | --- | --- | --- |
| `deps` | `node:22-bookworm-slim` | `package.json` + lock + `npm ci` | reproducible dependency layer |
| `builder` | `node:22-bookworm-slim` | source + `npm run build` | Next.js compile, `.next/standalone` |
| `runner` | `node:22-bookworm-slim` | `public/`, `.next/standalone`, `.next/static` | ~514 MB, non-root `nextjs` (uid 1001) |
| `worker` | `deps` | full source + dev tooling | `tsx scripts/worker.ts` needs dev deps |

**Why the worker is 3.1 GB:** it runs TypeScript directly via `tsx`, which is a dev dependency. This is a conscious trade-off (one image, no separate build pipeline). If image size becomes a deploy bottleneck, compile the worker to JS and `npm ci --omit=dev` — then it drops to ~300 MB.

### 7.2 Lockfile discipline (a real incident)

First build failed:

```
npm error `npm ci` can only install packages when package.json and
package-lock.json are in sync.
Missing: @emnapi/runtime@1.11.3, @emnapi/core@1.11.3,
         @types/react@18.3.31, esbuild@0.28.2
```

Cause: the lockfile was generated by a different npm major than the one in `node:22` (npm 10.9.9), and the new `dodopayments` additions were not fully resolved.

Fix:

```bash
npx -y npm@10.9.9 install --package-lock-only --ignore-scripts
npx -y npm@10.9.9 ci --dry-run --ignore-scripts   # must exit 0
```

**Rule:** regenerate the lockfile with the **same npm major as the runtime image**, commit it, and let CI run `npm ci` on every PR. Never use `npm install` inside the Docker build.

### 7.3 Build args

Every `NEXT_PUBLIC_*` is inlined at build time. Compose reads them from `deploy/.env`:

```yaml
args:
  NEXT_PUBLIC_BETTER_AUTH_URL: ${PUBLIC_URL}
  NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT: ${NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT:-}
  NEXT_PUBLIC_CAL_BOOKING_LINK: ${NEXT_PUBLIC_CAL_BOOKING_LINK:-}
  NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: ${NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION:-}
  NEXT_PUBLIC_MICROSOFT_CONNECT_ENABLED: ${NEXT_PUBLIC_MICROSOFT_CONNECT_ENABLED:-}
```

The builder stage also injects non-secret placeholders (`DATABASE_URL`, `BETTER_AUTH_SECRET`, etc.) so `lib/env.ts` validates during compile. Real secrets are **only** runtime.

### 7.4 Tags

`deploy.sh` picks the tag:

- clean tree → short git SHA (`a14f782`)
- dirty tree → `a14f782-dirty-YYYYMMDDHHMMSS`
- no `.git` → timestamp

Why: a deploy of uncommitted code must never masquerade as a clean release, and rollback must target an unambiguous image. The current production tag is `83ccc5a` from a clean tree. The previous rsynced tag was `a14f782-dirty-20261023074724`.

### 7.5 Release sequence

```
1. preflight (files, perms, docker, PUBLIC_URL)
2. pull infra images
3. build web-1 + worker (web-2 reuses the image)
4. up postgres/redis/redis-http → wait healthy
5. migrate (one-off worker)
6. up web-1 → wait healthy
7. up web-2 → wait healthy
8. up worker
9. start/reload Caddy if DNS points here
10. public readiness loop
11. prune images older than 7 days
```

A failed build or migration aborts **before** traffic moves. Caddy has active health checks, so a starting container is not in rotation until `/api/health/live` passes.

### 7.6 Zero-downtime properties

| Mechanism | Effect |
| --- | --- |
| Two replicas | one serves while the other restarts |
| Caddy `least_conn` + active checks | unhealthy upstream removed in ≤10 s |
| `/api/health/ready` = 530 | app stops accepting before shutdown completes |
| `stop_grace_period` 30 s / worker 45 s | in-flight requests and queue drains finish |
| SSE bypass | Caddy `flush_interval -1` prevents buffering |

**Not yet true zero-downtime:** Compose stops a container before starting its replacement, so each replica has a short single-node window. Acceptable now; use blue/green or orchestration for hard guarantees.

### 7.7 Rollback

```bash
ssh deploy@201.18.197.194 'cd /opt/tartly && bash deploy/scripts/rollback.sh'
```

It re-points web/worker at `.deploy/previous-tag` without rebuilding. **Migrations are not reversed.** If the release included a destructive migration, restore the pre-deploy dump instead (Stage 11).

### 7.8 CI/GHCR path (when ready)

```
PR  → lint + typecheck + unit + integration + OpenAPI check + Trivy
main → build image, tag with SHA, push ghcr.io/<org>/tartly-web:<sha>
VPS → docker compose pull && up -d (no build on host)
```

Benefits: builds stop competing with production for CPU, images are immutable and signed, rollback is a tag. Keep the on-host build as an emergency fallback.

### 7.9 Verify

```bash
ssh deploy@201.18.197.194 'cd /opt/tartly/deploy && \
  docker compose --env-file .env ps && \
  cat .deploy/current-tag'
```

Expect all services up, web `(healthy)`, worker running, tag recorded.

### 7.10 Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| `npm ci` EUSAGE | lockfile/npm mismatch | §7.2 |
| `next build` OOM | no swap / parallel builds | add swap; `--parallel 1` |
| `Invalid environment variables` at build | placeholder missing | add to Dockerfile builder env |
| web unhealthy after start | DB/Redis not ready | `depends_on: condition: service_healthy`; inspect logs |
| image not found on web-2 | built only web-1 but tag mismatch | build both or rely on shared tag |
| disk fills | old images (worker 3.1 GB each) | `docker image prune`; deploy script prunes >7 d |

### 7.11 Exit criteria

- [ ] Both web replicas healthy.
- [ ] Worker running, `worker.started` logged.
- [ ] `/api/health/ready` 200.
- [ ] Tag recorded in `.deploy/current-tag` and tracker §8.
- [ ] No `error`/`fatal` in logs beyond the known secret warning.

---

## 8. Stage 5 — Migrations and data cutover

**Purpose:** move live data from the previous managed database (Neon) to the local cluster without losing users or encrypted OAuth tokens.
**Script:** `deploy/scripts/import-database.sh`.
**Status:** completed 2026-10-23.

### 8.1 Pre-flight

- [ ] Target migrations applied.
- [ ] Source reachable from the host.
- [ ] A fresh target-state dump exists (even if empty).
- [ ] `BETTER_AUTH_SECRET` matches the old deployment (see §8.3).
- [ ] Maintenance: no users online (DNS not pointed yet is ideal).

### 8.2 Procedure

```bash
ssh deploy@201.18.197.194
cd /opt/tartly/deploy
SOURCE_DATABASE_URL='postgresql://…neon.tech/neondb?sslmode=require' \
  ./scripts/import-database.sh
```

What it does:

1. stops `web-1`, `web-2`, `worker`;
2. `pg_dump` the source from inside the **matching-major** Postgres 18 container;
3. terminates local connections;
4. `pg_restore --clean --if-exists --no-owner --no-acl --single-transaction`;
5. runs migrations (catches schema drift);
6. prints the top 15 tables by row count;
7. starts the app.

### 8.3 The secret that must not change

Gmail and Outlook refresh tokens are encrypted with `BETTER_AUTH_SECRET`. If the new value differs, every token becomes undecryptable and users must reconnect.

- To **preserve**: carry the exact old value into `app.env` (done).
- To **rotate** (recommended for a weak dev secret): accept one reconnect per user, and do it *before* launch. See tracker A3.

### 8.4 TLS mode gotcha

Neon URLs often use `sslmode=verify-full&channel_binding=require`. The `postgres:18-alpine` image has no Neon CA at `/root/.postgresql/root.crt`:

```
root certificate file "/root/.postgresql/root.crt" does not exist
```

For a trusted, one-time migration, use `sslmode=require` (encrypted, no CA verification):

```bash
node -e "const u=new URL(process.env.SRC);u.searchParams.set('sslmode','require');…"
```

Do **not** lower TLS verification for the long-lived application connection; the app talks to localhost inside the Docker network.

### 8.5 Verification

```sql
select (select count(*) from "user")      as users,
       (select count(*) from account)     as accounts,
       (select count(*) from mailboxes)   as mailboxes,
       (select count(*) from threads)     as threads,
       (select count(*) from messages)    as messages;
```

Observed: `2 / 2 / 2 / 3 / 3` — matches the source.

Then:

```bash
curl -sS http://127.0.0.1:3000/api/health/ready   # via docker compose exec
```

### 8.6 Post-cutover tasks

- [ ] Sign in once and open a mailbox (proves token decryption).
- [ ] Confirm the OAuth redirect URI on the new origin (Stage 8).
- [ ] Keep Neon read-only for 7 days; then delete the project and its credentials.
- [ ] Remove the old `DATABASE_URL` from Vercel/other environments.
- [ ] Record the cutover in tracker §7.

### 8.7 Rollback

Before importing, take a target dump. To roll back:

```bash
FORCE=1 ./scripts/restore-postgres.sh /var/backups/tartly/<pre-import>.dump.zst
```

The source Neon database is untouched, so it remains a fallback for the retention window.

### 8.8 Exit criteria

- [ ] Row counts match.
- [ ] Readiness 200.
- [ ] A real sign-in + mailbox load succeeds.
- [ ] Source retained for the rollback window.

---

## 9. Stage 6 — Edge: DNS, TLS, and Caddy

**Purpose:** expose the app on `https://tartly.in` with automatic certificates, HTTP/2+3, compression, and health-aware load balancing.
**Script:** `deploy/Caddyfile` (validated with `caddy validate`).
**Time:** 5 min after DNS.

### 9.1 Why Caddy

| Requirement | Caddy behavior |
| --- | --- |
| Automatic TLS + renewal | ACME built in, no cron |
| HTTP/2 + HTTP/3 | on by default; UDP 443 opened in UFW |
| Compression | `encode zstd gzip` |
| SSE / streaming | `flush_interval -1` disables buffering |
| Active health checks | pulls a bad replica out in ~10 s |
| Small ops surface | one binary, one file |

### 9.2 The config, line by line

```caddyfile
{
	email {$ACME_EMAIL}
}

{$TARTLY_DOMAIN} {
	encode zstd gzip
	header { -Server }

	reverse_proxy web-1:3000 web-2:3000 {
		lb_policy least_conn
		health_uri /api/health/live
		health_interval 10s
		health_timeout 3s
		health_status 2xx
		flush_interval -1
	}

	log { output stdout format json }
}

www.{$TARTLY_DOMAIN} {
	redir https://{$TARTLY_DOMAIN}{uri} permanent
}
```

| Directive | Why it matters |
| --- | --- |
| `email` | ACME account contact for expiry notices |
| `encode` | cuts egress on HTML/JSON; zstd first, gzip fallback |
| `-Server` | removes fingerprinting |
| two upstreams | one replica can restart without downtime |
| `least_conn` | better than round-robin with long SSE connections |
| active health | a wedged process is removed even if the socket accepts |
| `flush_interval -1` | assistant replies stream token-by-token |
| `www` 308 | one canonical origin for OAuth state cookies |

**TLS is terminated at Caddy**, keeping app CPU for business logic. HSTS and the other security headers are emitted by Next.js (`next.config.ts`); Caddy adds none that would conflict.

### 9.3 DNS → certificate sequence

1. Apex A record → `201.18.197.194` (TTL 300).
2. Wait for propagation:

```bash
dig +short tartly.in
```

3. Start Caddy **only after** the record resolves here. Issuing for a name that points elsewhere burns Let's Encrypt rate limits.

```bash
ssh deploy@201.18.197.194 'cd /opt/tartly/deploy && docker compose --env-file .env up -d caddy'
```

4. Watch ACME:

```bash
ssh deploy@201.18.197.194 'cd /opt/tartly/deploy && docker compose --env-file .env logs -f --tail 50 caddy'
```

Look for `certificate obtained successfully` for both `tartly.in` and `www.tartly.in`.

### 9.4 Verify

```bash
curl -sSI https://tartly.in | head -20
curl -sS  https://tartly.in/api/health/ready
curl -sSI https://www.tartly.in | grep -i '^location'
curl -sSI https://tartly.in | grep -i strict-transport-security
openssl s_client -connect tartly.in:443 -servername tartly.in </dev/null 2>/dev/null \
  | openssl x509 -noout -issuer -dates -subject
curl --http3 -sSI https://tartly.in >/dev/null && echo HTTP3_OK || echo "HTTP3 unavailable from this network"
```

Expected:

```
HTTP/2 200
strict-transport-security: max-age=63072000; includeSubDomains
location: https://tartly.in/…
issuer=C=US, O=Let's Encrypt, CN=R…
```

### 9.5 Streaming check (do not skip)

AI replies use SSE. A buffering proxy makes the product feel broken.

```bash
# terminal 1 (signed in via browser devtools, copy the Cookie header)
curl -N -H 'Cookie: …' https://tartly.in/api/v1/agent/chat …
```

Expected: tokens arrive incrementally, not in one blob at the end. If buffered, confirm `flush_interval -1` and that no CDN is proxying `/api/*`.

### 9.6 Cloudflare decision

| Mode | Use when | Caveat |
| --- | --- | --- |
| **DNS only (grey cloud)** | now | no CDN/WAF, but zero timeout surprises |
| Proxied | after testing | free plan caps request duration at **100 s** — long AI streams truncate |
| Proxied + bypass rules | production | bypass `/api/v1/agent/*`, `/api/ai/*`, `/api/webhooks/*` |

If you enable proxying, also set `trusted_proxies` in Caddy and re-check client IPs for rate limiting.

### 9.7 Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| `no such host` in ACME logs | DNS not propagated | wait; `dig` from multiple resolvers |
| `connection refused` on 80 | UFW / Hostinger firewall | `ufw allow 80`; check panel firewall |
| `too many failed authorizations` | repeated attempts while DNS wrong | wait 1 h; fix DNS first |
| `502` | both upstreams unhealthy | `docker compose ps`; inspect web logs |
| `www` cert fails | CNAME not resolving | `dig www.tartly.in`; fix CNAME |
| SSE stalls | proxy buffering | `flush_interval -1`; bypass CDN |
| cert renews but browser warns | clock drift | `timedatectl`; chrony |

### 9.8 Exit criteria

- [ ] `https://tartly.in` 200 with a valid cert.
- [ ] `www` 308 → apex.
- [ ] HSTS present.
- [ ] Readiness 200 over the public internet.
- [ ] SSE streams incrementally.
- [ ] Caddy logs JSON to stdout, rotated by Docker.

---

## 10. Stage 7 — Integrations

**Purpose:** connect the identity, mail, billing, and storage providers. Each subsection is independent; do them in this order.

### 10.1 Google OAuth

1. Google Cloud Console → **APIs & Services → Credentials** → the Web client used by Tartly.
2. Add:
   - **Authorized JavaScript origin:** `https://tartly.in`
   - **Authorized redirect URI:** `https://tartly.in/api/auth/callback/google`
   - If Outlook is enabled: `https://tartly.in/api/auth/callback/microsoft`
3. Keep the old Vercel URIs until the new host is verified.
4. **OAuth consent screen:** publish the app / add test users. Unverified apps in “Testing” expire refresh tokens after 7 days — a common “mail stopped syncing” cause.
5. Required scopes (already requested by the app): Gmail read/modify/send, Calendar, openid/email/profile. Adding scopes later forces re-consent.

Verify:

```bash
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://tartly.in/api/auth/callback/google
```

A `302` to Google (or a `400` about a missing code) proves the route exists. A `404` means the build is stale.

Then sign in in a browser and confirm `https://tartly.in/mail` loads live mail.

### 10.2 Gmail Pub/Sub (email operator)

1. Verify `tartly.in` as a domain in Google Cloud (Search Console TXT record).
2. Create topic `gmail-inbox`:
   ```bash
   gcloud pubsub topics create gmail-inbox
   gcloud pubsub topics add-iam-policy-binding gmail-inbox \
     --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
     --role=roles/pubsub.publisher
   ```
3. Create a push subscription:
   ```bash
   gcloud pubsub subscriptions create gmail-push \
     --topic=gmail-inbox \
     --push-endpoint=https://tartly.in/api/webhooks/gmail \
     --push-auth-service-account=<push-sa>@<project>.iam.gserviceaccount.com
   ```
4. Set in `app.env`:
   ```dotenv
   GOOGLE_PUBSUB_TOPIC=projects/<project>/topics/gmail-inbox
   GOOGLE_PUBSUB_AUDIENCE=https://tartly.in/api/webhooks/gmail
   ```
5. Recreate web/worker. The route verifies the OIDC token against the audience before accepting.

Verify: send yourself an email; watch `docker compose logs -f worker` for an `inbound_email` job and the thread appear in `/inbox`.

### 10.3 Dodo Payments

1. Dashboard → Developers → Webhooks → add `https://tartly.in/api/webhooks/dodo`.
2. Copy the signing secret into `DODO_PAYMENTS_WEBHOOK_KEY`.
3. Keep `DODO_PAYMENTS_ENVIRONMENT=test_mode` and `DODO_LIVE_MODE_ENABLED=false` until a full test passes.
4. Test card flow: checkout → `payment.succeeded` → `billing_webhook_events` row → entitlement/credits applied.
5. Only then switch to live keys and set `DODO_LIVE_MODE_ENABLED=true`.

The app intentionally refuses to create live charges while the test-mode lock is on (it logs an actionable warning).

Verify:

```sql
select event_type, count(*), max(created_at)
from billing_webhook_events
group by 1 order by 3 desc;
```

Replay safety comes from the unique delivery id; duplicates are discarded.

### 10.4 Cloudflare R2 (assets + backups)

**Full step-by-step, including the console screens and troubleshooting: [`R2-SETUP.md`](./R2-SETUP.md).**

Create two **private** buckets:

- `tartly-assets` — attachments/uploads (browser presigned `PUT`)
- `tartly-backups` — 6-hourly dumps

Create **two least-privilege tokens** (do not reuse one token for both):

| Token | Permission | Scope |
| --- | --- | --- |
| `tartly-app-assets` | Object Read & Write | `tartly-assets` |
| `tartly-backups` | Object Read & Write | `tartly-backups` |

In the repo-root `.env` (then render — do not hand-edit the server):

```dotenv
S3_BUCKET=tartly-assets
S3_REGION=auto
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
ASSETS_ENABLED=true
```

`render-env.mjs` sets `ASSET_STORAGE_DRIVER=s3` automatically when all three S3 values exist, and keeps `ASSET_BLOB_ACCESS=private`.

CORS on `tartly-assets` (browser presigned PUT):

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

Why presigned: the browser streams bytes straight to R2; the app never buffers a large file and never proxies bandwidth. Keys are content-addressed per user (`assets/<userId>/<sha256>`), so identical uploads dedupe and cross-user guessing is infeasible. The bucket stays private; reads go through the authenticated app.

For backups, fill `/etc/tartly/backup.env`:

```dotenv
RCLONE_REMOTE=r2
RCLONE_BUCKET=tartly-backups
RCLONE_CONFIG_R2_TYPE=s3
RCLONE_CONFIG_R2_PROVIDER=Cloudflare
RCLONE_CONFIG_R2_ACCESS_KEY_ID=…
RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=…
RCLONE_CONFIG_R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
RCLONE_CONFIG_R2_REGION=auto
HEALTHCHECKS_URL=https://hc-ping.com/<readiness-uuid>
HEALTHCHECKS_BACKUP_URL=https://hc-ping.com/<backup-uuid>
```

> The file is **sourced by bash**. Never put `<angle-bracket>` placeholders in a sourced value — bash treats `<` as redirection. Use empty values until you have real ones.

Verify:

```bash
ssh deploy@201.18.197.194 'cd /opt/tartly/deploy && ./scripts/backup-postgres.sh'
ssh deploy@201.18.197.194 'rclone lsf r2:tartly-backups/postgres/ | tail -3'
```

### 10.5 Healthchecks.io

Create **two** checks:

| Name | Period | Grace | Pinged by |
| --- | --- | --- | --- |
| `Tartly readiness` | 1 minute | 2 minutes | `healthcheck.sh` (readiness + disk) |
| `Tartly Postgres backup` | 6 hours | 1 hour | `backup-postgres.sh` |

Keeping them separate matters: the per-minute readiness probe would otherwise keep the backup check green forever, so a missed dump would never alert. The backup script reads `HEALTHCHECKS_BACKUP_URL` and does **not** fall back: if it is unset, the backup heartbeat is disabled and the script prints a warning.

Add an independent external uptime monitor pointing at `https://tartly.in/api/health/ready` so a whole-host failure is still detected.

### 10.6 ImageKit

`NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT` is **build-time**. Changing it requires a rebuild, not a restart. It is already set and baked into the current image.

### 10.7 Exit criteria

- [ ] Google sign-in + Gmail connect works on the new origin.
- [ ] Pub/Sub push produces an inbound job (if operator enabled).
- [ ] Dodo test payment updates billing state.
- [ ] R2 upload succeeds and the object exists under the expected key.
- [ ] Backup uploads offsite and Healthchecks receives pings.

---

## 11. Stage 8 — Verification and acceptance

**Purpose:** prove the deployment is correct before announcing the domain. Run every check; record the result in the tracker §7.

### 11.1 Functional matrix

| Check | Command / action | Expected |
| --- | --- | --- |
| Liveness | `curl -fsS https://tartly.in/api/health/live` | `200` |
| Readiness | `curl -fsS https://tartly.in/api/health/ready` | `200`, postgres+redis up |
| Landing | open `https://tartly.in/` | renders, no console errors |
| Auth | click sign in | Google consent, returns to `/mail` |
| Mail list | open `/mail` | live messages, folders, search |
| Thread | open a message | body renders, no XSS |
| Draft | generate a reply | streams, editable |
| Send gate | approve a draft | only after explicit approval |
| Assistant | `/assistant` prompt | tool use, streamed answer |
| Settings | `/settings/accounts` | Gmail connected |
| Billing | `/settings/billing` | plan/credits render (test mode) |
| Privacy/Terms | `/privacy`, `/terms` | 200 |
| `www` | `https://www.tartly.in` | `308` → apex |
| 404 | `/does-not-exist` | styled 404, not a stack trace |
| Metrics auth | `curl -i /api/health/metrics` | `401` without token |
| Cron auth | `curl -i /api/v1/cron/daily` | `401` without bearer |

### 11.2 Security checks

```bash
# TLS + headers
curl -sSI https://tartly.in | grep -Ei 'strict-transport|content-security|x-content-type|x-frame|referrer|permissions'

# HSTS, CSP (report-only initially)
curl -sSI https://tartly.in | grep -i content-security

# No server fingerprint
curl -sSI https://tartly.in | grep -i '^server:' && echo "LEAK" || echo "server header removed"

# Cookies
curl -sSI https://tartly.in/api/auth/session | grep -i set-cookie

# Open ports (from outside)
nmap -Pn -p 22,80,443,3000,5432,6379 201.18.197.194
# only 22/80/443 open

# TLS grade
curl -sS "https://api.ssllabs.com/api/v3/analyze?host=tartly.in" | jq -r '.status,.endpoints[0].grade' 2>/dev/null
```

Manual checks:

- [ ] Signed-out `/mail` redirects to `/auth`.
- [ ] A user cannot fetch another user's thread id (BOLA/IDOR) — spot-check two accounts.
- [ ] Dodo webhook without a valid signature returns `401`.
- [ ] Gmail push without a valid OIDC token returns `401`.
- [ ] Cron/metrics without tokens return `401`.
- [ ] Error responses contain no stack traces or SQL.
- [ ] Upload rejects an oversized/invalid MIME file.

### 11.3 Performance smoke (before full §15)

```bash
# from your workstation, not the server
curl -sS -o /dev/null -w 'dns=%{time_namelookup} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total}\n' https://tartly.in/
```

Targets from Mumbai/India: TTFB < 300 ms, total < 800 ms on a warm connection.

### 11.4 DR check

- [ ] Nightly dump exists locally and in R2.
- [ ] `zstd -t` passes.
- [ ] Restore drill completed at least once (tracker §7).
- [ ] `app.env` backed up in a password manager.

### 11.5 Sign-off

| Role | Name | Date | Signature |
| --- | --- | --- | --- |
| Deployer | | | |
| Product owner | | | |

---

## 12. Stage 9 — Observability

**Purpose:** know the system is healthy before users tell you it isn't.

### 12.1 Logs

- Structured JSON to stdout (`lib/observability/logger.ts`).
- Docker `json-file`, 20 MB × 5 per container.
- Caddy access logs as JSON.
- Cron output → `/var/log/tartly-cron.log` (weekly ×8).

Useful queries:

```bash
cd /opt/tartly/deploy
docker compose --env-file .env logs --since 15m web-1 web-2 | grep -i error
docker compose --env-file .env logs --since 15m worker | grep -E 'job_|worker\.'
docker compose --env-file .env logs --since 1h caddy | jq -r 'select(.status>=500) | [.ts,.request.uri,.status] | @tsv'
```

**Never** log message bodies, OAuth tokens, or full email addresses. The app's logger redacts sensitive fields; keep it that way.

### 12.2 Health endpoints

| Endpoint | Semantics | Used by |
| --- | --- | --- |
| `/api/health/live` | process responds; no dependencies | Docker + Caddy |
| `/api/health/ready` | Postgres **and** Redis ping; `530` when not ready | LB, uptime monitor, deploy gate |
| `/api/health/metrics` | Prometheus text; bearer `METRICS_TOKEN` | scraper |

### 12.3 Metrics

Scrape config (Grafana Cloud / Prometheus agent on another host):

```yaml
scrape_configs:
  - job_name: tartly
    scheme: https
    metrics_path: /api/health/metrics
    authorization:
      credentials: <METRICS_TOKEN>
    static_configs:
      - targets: ["tartly.in"]
    scrape_interval: 30s
```

Track the RED signals: rate, errors, duration; and USE for the host (CPU, memory, disk, TCP). Add Postgres exporter and Redis exporter when you want deeper visibility.

### 12.4 Alerts (minimum set)

| Alert | Condition | Severity |
| --- | --- | --- |
| Down | readiness fails 2 consecutive probes | page |
| 5xx rate | > 2% for 5 min | page |
| Latency | p95 > 1 s for 10 min (non-AI) | warn |
| DB connections | > 80 of 120 for 5 min | warn |
| Disk | > 85% warn, > 92% page | page at 92 |
| Memory | > 90% for 10 min | warn |
| Backup stale | no dump in 26 h | page |
| Queue backlog | oldest pending job > 10 min | warn |
| Cert expiry | < 14 days (Caddy should auto-renew) | warn |
| AI error rate | > 20% provider failures for 5 min | warn |

`healthcheck.sh` already covers readiness + disk and pings Healthchecks on failure. Extend it or scrape metrics for the rest.

### 12.5 Dashboards

1. **Golden signals** — RPS, error %, p50/p95/p99, in-flight.
2. **Host** — CPU, load, memory, swap, disk, network.
3. **Database** — connections, TPS, slow queries (`pg_stat_statements`), cache hit ratio, locks.
4. **Queue** — pending/processing/dead by kind, oldest age.
5. **Business** — signups, drafts, sends, meetings, AI spend.

### 12.6 Tracing (next step)

OpenTelemetry with W3C `traceparent` across Caddy → Next.js → Postgres/Redis → AI provider. Useful once p95 investigations outgrow logs. Not required for launch.

### 12.7 Exit criteria

- [ ] External probe on readiness.
- [ ] Healthchecks backup heartbeat.
- [ ] At least the down + 5xx + disk + backup alerts configured.
- [ ] Logs survive a container restart (Docker rotation, not `tmpfs`).

---

## 13. Stage 10 — Backups and disaster recovery

**Purpose:** survive host loss with a known, tested recovery path.

### 13.1 Objectives

| Metric | Target | Mechanism |
| --- | --- | --- |
| RPO | ≤ 24 h | nightly `pg_dump` |
| RTO | ≤ 30 min | bootstrap + restore script |
| Retention | 3 d local (§13.5.1), 30 d remote | cron + rclone |

If the business needs RPO < 24 h, add WAL archiving (pgBackRest/pg_basebackup) or move to managed Postgres with PITR. At 10k active users, treat RPO ≤ 6 h as a launch requirement, not an upgrade.

### 13.2 What runs when

| Time (UTC) | Job | Script |
| --- | --- | --- |
| 02:15 | dump + zstd + verify + R2 + heartbeat | `backup-postgres.sh` |
| 03:00 | daily safety net (watch renew, digests, reconcile, retention) | `cron.sh daily` |
| every 5 min | follow-up enrollment | `cron.sh followups` |
| every 15 min | autopilot review | `cron.sh autopilot` |
| every minute | readiness + disk probe | `healthcheck.sh` |

### 13.3 The dump

```bash
docker compose exec -T postgres \
  pg_dump -U tartly -d tartly --format=custom --compress=0 \
  | zstd -T0 -10 -q -o /var/backups/tartly/tartly-<stamp>.dump.zst.partial
zstd -t /var/backups/tartly/tartly-<stamp>.dump.zst.partial
mv …partial …dump.zst
```

- Write to `.partial` then rename: a failed dump never looks valid.
- `zstd -t` verifies the frame before it is promoted.
- 101 KB for the current 13 MB source DB.

### 13.4 Restore drill (do monthly)

```bash
cd /opt/tartly/deploy
FORCE=1 ./scripts/restore-postgres.sh /var/backups/tartly/tartly-<stamp>.dump.zst
```

It stops web/worker, terminates connections, `pg_restore --clean --if-exists --single-transaction`, analyzes, re-runs migrations, restarts, and re-verifies row counts.

**Record the drill in tracker §7.** A backup that has never been restored is a hypothesis.

### 13.5 Secrets backup

`pg_dump` does **not** include `app.env` or `.env`. Store them in a password manager (encrypted). Without `BETTER_AUTH_SECRET`, every connected mailbox must be reconnected even if the database is restored.

### 13.5.1 Retention math — backups share the disk they protect

A local dump is a full second copy of the database on the same 100 GB NVMe.
At 14 daily copies, a 10 GB database (≈2–3 GB compressed) can consume
**30–40 GB** — and a 20 GB database can consume most of the free space. This is
how a backup causes the outage it was meant to survive.

Rules:

| DB size | Local copies | Offsite | RPO |
| --- | --- | --- | --- |
| < 1 GB (now) | 7–14 | R2 nightly | 24 h |
| 1–5 GB | 3 | R2 nightly | 24 h |
| 5–20 GB | 2–3 | R2 nightly | 6 h |
| > 20 GB | 1–2 | R2 + WAL/PITR | ≤ 1 h |

- `LOCAL_KEEP_DAYS` defaults to **3** in `backup-postgres.sh`; override only with a reason.
- The script aborts if free space is below **5 GB** instead of filling the disk.
- R2 upload happens **before** local pruning is relied on; the local copy is a cache, not the backup.
- Check monthly: `du -sh /var/backups/tartly`, `df -h /`, `rclone lsf r2:tartly-backups/postgres/`.

If you need RPO < 6 h, add WAL archiving (`pgBackRest`/WAL-G) rather than more
dumps: WAL is incremental, while each dump is a full copy.

### 13.6 Full host loss — recovery runbook

1. Provision a new Ubuntu VPS (same or newer spec).
2. Point DNS at the new IP (TTL 300).
3. `bootstrap.sh` + `harden-ssh.sh`.
4. Restore `deploy/app.env`, `deploy/.env`, `/etc/tartly/backup.env` from the password manager.
5. Clone the repo at the deployed tag (or rsync).
6. `docker compose up -d postgres redis redis-http`; wait healthy.
7. Download the latest dump from R2 and:
   ```bash
   FORCE=1 ./scripts/restore-postgres.sh /path/to/dump.zst
   ```
8. `deploy.sh` to build/start web + worker + Caddy.
9. Verify readiness, sign-in, and one mailbox.
10. Record incident + RTO.

### 13.7 Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| dump is 0 bytes | pipe failure / disk full | check `df`, rerun; `.partial` prevents promotion |
| restore fails on extensions | missing `pg_stat_statements` | ensure preload + init SQL |
| restore hangs | open app connections | stop web/worker first |
| R2 upload skipped | empty token / bad endpoint | `rclone lsf r2:`; fix `backup.env` |
| cron never runs | deploy not in docker group / perms | `sudo -u deploy …` manually; check `/etc/cron.d/tartly` |

### 13.8 Exit criteria

- [ ] Local dump exists and passes `zstd -t`.
- [ ] Offsite copy exists.
- [ ] Heartbeat received.
- [ ] Restore drill recorded.
- [ ] Secrets stored outside the host.

---

## 14. Stage 11 — Security hardening and audit

**Purpose:** make the deployment defensible, then keep it that way.

### 14.1 Threat model

| Threat | Vector | Control |
| --- | --- | --- |
| Credential stuffing | `/auth`, OAuth callback | provider-side, rate limits, generic errors |
| Session theft | XSS, cookie leakage | HttpOnly/Secure/SameSite, CSP nonce, no tokens in JS |
| IDOR/BOLA | guessed thread/message/draft ids | every query scoped by session user; 404 on non-owned |
| Webhook forgery | fake Dodo/Gmail events | HMAC / OIDC verification on raw bytes; replay ids |
| SSRF | user-supplied URLs in email content | allowlist, no server-side fetch of arbitrary URLs |
| Prompt injection | email body → agent tools | tool confirmation gates, send approval, policy clamps |
| Data exfil | DB dump / backup theft | private network, 0600 secrets, R2 private, encrypted disk (provider) |
| DDoS | volumetric / L7 | provider network, UFW, Caddy limits, edge rate limiting later |
| Supply chain | npm dependency | lockfile, `npm ci`, audit/Trivy, pinned images |
| Privilege escalation | container breakout | non-root, `no-new-privileges`, no host mounts |
| Accidental exposure | `.env` in git/image | `.gitignore`, `.dockerignore`, secret scan |

### 14.2 Host and network

- [x] Key-only SSH; root `prohibit-password`; `deploy` uses sudo.
- [x] UFW default deny; only 22/80/443.
- [x] fail2ban on sshd.
- [x] Unattended security upgrades.
- [x] chrony.
- [x] Docker log caps; `live-restore`.
- [x] Containers non-root where possible; `no-new-privileges`; memory caps.
- [x] No DB/Redis/app host ports.
- [ ] Hostinger panel firewall reviewed (currently 0 rules; UFW is authoritative).
- [ ] SSH key on a second device or in the panel (break-glass).

### 14.3 Application and API

| Control | Where | Status |
| --- | --- | --- |
| Central env validation | `lib/env.ts` (Zod) | ✅ |
| Route guard (optimistic) | `proxy.ts` | ✅ |
| Authoritative session check | page/route `getSession` | ✅ |
| CSP nonce (report → enforce) | `lib/security/csp.ts`, `proxy.ts` | 🟡 report-only |
| HSTS / nosniff / frame / referrer / permissions | `next.config.ts` | ✅ |
| Rate limits (300 / 20 / 30 per min) | `lib/env.ts` + Redis | ✅ |
| OpenAPI contract enforcement | `API_CONTRACT_VALIDATION=enforce` | ✅ |
| Structured error responses, no stack traces | `lib/api/http.ts` | ✅ |
| Graceful shutdown + 530 readiness | `lib/lifecycle`, worker | ✅ |
| Queue idempotency + dead-letter | `job_queue`, `send_ledger` | ✅ |
| Webhook signature + idempotency | Dodo/Gmail routes | ✅ (Dodo key pending) |
| Presigned uploads with bounds | `lib/assets` | ✅ (R2 pending) |
| Metrics/cron bearer auth | routes | ✅ |

### 14.4 Secrets

- `app.env` 0600, `deploy`-owned, outside git and image.
- `.dockerignore` excludes the whole `deploy/` directory.
- No secret in `NEXT_PUBLIC_*`.
- Rotation table in §5.6.
- **Current gap:** `BETTER_AUTH_SECRET` is a short dev value (Better Auth warns on every boot). Rotate before launch or accept the risk in writing.

### 14.5 Supply chain

```bash
# dependency audit (run before each release)
npm audit --omit=dev
# image scan
docker scout cves tartly-web:<tag>        # or: trivy image tartly-web:<tag>
# SBOM
docker sbom tartly-web:<tag> > sbom.spdx.json
```

Add to CI: lint, typecheck, unit, integration, OpenAPI breaking check, `npm audit`, Trivy, immutable SHA tag. Do not deploy an image that failed a critical scan.

### 14.6 20-point readiness audit (from `docs/SKILL-v2.md` §16)

| # | Item | Evidence | Status |
| --- | --- | --- | --- |
| 1 | Layered architecture | `app/` routes → `lib/services` → `lib/db` | ✅ |
| 2 | REST semantics | `openapi.yaml`, typed contracts | ✅ |
| 3 | OpenAPI contract | generated + enforced | ✅ |
| 4 | Input validation | Zod per route | ✅ |
| 5 | BOLA/IDOR | user-scoped queries | ✅ (spot-check) |
| 6 | Auth security | Better Auth sessions | ✅ |
| 7 | Crypto hygiene | provider-managed, constant-time webhooks | ✅ |
| 8 | Global errors | unified, no leaks | ✅ |
| 9 | Graceful shutdown | readiness 530 + drain | ✅ |
| 10 | Migrations | Drizzle, 26 applied | ✅ |
| 11 | Indexes / N+1 | schema indexes; audit pending | 🟡 |
| 12 | Pooling | 8/8/4 of 120 | ✅ |
| 13 | Caching | Redis, TTLs | ✅ |
| 14 | Queues | Postgres queue, DLQ | ✅ |
| 15 | Direct uploads | presigned R2 | 🟡 pending creds |
| 16 | Webhook security | HMAC/OIDC + idempotency | ✅ |
| 17 | 12-factor | env + lockfile | ✅ |
| 18 | Observability | logs/health/metrics | 🟡 no external scraper |
| 19 | Tests | unit + integration | ✅ |
| 20 | Container/CI | multi-stage + non-root; no CI yet | 🟡 |

### 14.7 Remediation backlog (priority order)

1. Rotate the auth secret (or document acceptance).
2. Configure R2 + CORS; enable uploads.
3. Enable offsite backups + heartbeat.
4. Flip CSP to `enforce` after a clean report week.
5. Add external monitoring + alerts.
6. Commit the tree; adopt immutable image tags + CI scans.
7. Add DB exporter + slow-query review.
8. Pen-test checklist: authz matrix across two accounts, webhook replay, upload abuse.

### 14.8 Exit criteria

- [ ] No critical/high findings in `npm audit` for production deps.
- [ ] Image scan clean or accepted with a written exception.
- [ ] All secrets rotated from any value that ever appeared in a chat or screenshot.
- [ ] Security checks in §11.2 pass.
- [ ] CSP enforcing.
- [ ] Backups encrypted at rest by the provider and access-scoped.

---

## 15. Stage 12 — Performance validation

**Purpose:** replace opinions with numbers. Establish a baseline, find the active constraint, fix one thing, repeat.

### 15.1 Rules of measurement

1. **Load generator runs off-box.** Running k6 on the VPS measures the competition, not the app.
2. **Warm up first.** JIT, connection pools, page cache, and TLS sessions skew the first 30 s.
3. **Use open-loop, constant-arrival-rate** for latency. Closed-loop tools hide queueing (coordinated omission).
4. **Report percentiles, not averages.** p50/p90/p95/p99/p99.9 + error rate + in-flight.
5. **One variable per run.** Record the change and the delta.
6. **Soak for 30–60 min** to catch leaks and GC drift.
7. **Test the real path**, including auth, DB, and Redis — not just `/health`.

### 15.2 Workload model

| Scenario | Weight | What it exercises | Notes |
| --- | --- | --- | --- |
| `S1` landing `/` | 30% | Next.js static render, compression | cacheable |
| `S2` `/api/health/live` | 10% | runtime overhead floor | not a product path |
| `S3` `/api/v1/mail/messages` | 30% | auth + Postgres + serialization | requires a real session |
| `S4` thread `/api/v1/mail/threads/{id}` | 15% | joins, message bodies | watch N+1 |
| `S5` `/api/v1/agent/chat` (SSE) | 5% | AI provider, long-lived memory | run separately |
| `S6` webhook POST | 10% | HMAC + enqueue | no AI |

Do **not** mix S5 into a high-RPS loop. It is latency- and cost-bound, not throughput-bound, and will exhaust provider quota before the server breaks.

### 15.3 Tools

| Tool | Use |
| --- | --- |
| `k6` | mixed scenarios, thresholds, constant-arrival-rate |
| `autocannon` | single-endpoint ceiling |
| `wrk2` | steady-rate latency with coordinated-omission correction |
| `hey` / `vegeta` | quick sanity checks |
| `pg_stat_statements` | query-level DB truth |
| `docker stats` | per-container CPU/memory |
| `node --cpu-prof` | CPU hotspots inside Next.js |
| `deploy/scripts/capacity-report.sh` | one-shot host + DB + Redis + disk snapshot before/after each run |

### 15.4 k6 script (save outside the repo; it holds a session cookie)

```js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'https://tartly.in';
const COOKIE = __ENV.SESSION_COOKIE; // from a dedicated test account

const mailLatency = new Trend('mail_latency', true);
const errors = new Rate('errors');

export const options = {
  scenarios: {
    browse: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 50),
      timeUnit: '1s',
      duration: __ENV.DURATION || '5m',
      preAllocatedVUs: 50,
      maxVUs: 400,
      exec: 'browse',
    },
    landing: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.LANDING_RATE || 100),
      timeUnit: '1s',
      duration: __ENV.DURATION || '5m',
      preAllocatedVUs: 20,
      maxVUs: 200,
      exec: 'landing',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800', 'p(99)<2000'],
    mail_latency: ['p(95)<500'],
  },
};

const headers = {
  'Cookie': COOKIE,
  'Accept': 'application/json',
};

export function landing() {
  const r = http.get(`${BASE}/`);
  check(r, { 'landing 200': (x) => x.status === 200 });
  errors.add(r.status >= 500);
}

export function browse() {
  const r = http.get(`${BASE}/api/v1/mail/messages?limit=25`, { headers });
  mailLatency.add(r.timings.duration);
  check(r, { 'mail 200': (x) => x.status === 200 });
  errors.add(r.status >= 500);
  sleep(Math.random() * 2);
}
```

Run:

```bash
BASE_URL=https://tartly.in \
SESSION_COOKIE='better-auth.session_token=…' \
RATE=50 LANDING_RATE=100 DURATION=5m \
k6 run --summary-export=baseline.json load.js
```

> Use a **dedicated test account**, never a real user's cookie. Revoke its session after the test.

### 15.5 Expected order of magnitude (hypotheses, not guarantees)

| Path | Single node expectation | First bottleneck |
| --- | --- | --- |
| `/api/health/live` | 2k–8k RPS | Node event loop / CPU |
| landing (compressed, warm) | 1k–4k RPS | CPU / TLS |
| mail list (DB-backed) | 100–500 RPS | Postgres + serialization |
| thread view | 80–400 RPS | joins / payload |
| AI SSE | tens–low hundreds concurrent | provider quota, memory |
| webhook | 200–1k RPS | HMAC CPU + queue writes |

If you are far below these, profile before buying hardware. If you are far above, great — the model was conservative.

### 15.6 Bottleneck decision tree

```
p95 rising
├─ host CPU ~100%? ──────────► profile CPU; reduce serialization; add replica/node
├─ iowait high / PG slow? ───► EXPLAIN ANALYZE; add index; reduce N+1; pool/PgBouncer
├─ Redis latency high? ──────► pipeline; avoid N+1 gets; shard; replica reads
├─ network saturated? ───────► compress; trim payload; move assets to R2/CDN
├─ memory rising / OOM? ─────► cap streams; fix leaks; raise limit carefully
├─ DB connections maxed? ────► pool math; PgBouncer; shorter transactions
├─ provider 429/5xx? ────────► backoff+jitter; circuit breaker; fallback model
└─ nothing saturated? ───────► client/load-gen limit or LB limit
```

### 15.7 Application-specific tuning checklist

**Database**

- [ ] `EXPLAIN (ANALYZE, BUFFERS)` every endpoint query > 50 ms.
- [ ] Indexes for: mail list by `(mailbox_id, received_at desc)`, thread lookup by `(user_id, thread_id)`, queue claim by `(status, run_at)`, billing lookup by customer id.
- [ ] Eliminate N+1 in thread rendering (batch messages by thread).
- [ ] Paginate everything; never unbounded `SELECT *`.
- [ ] `pg_stat_statements` top 20 reviewed weekly.
- [ ] `work_mem` tuned per query class, not globally.

**Redis**

- [ ] Batch independent reads with `Promise.all` (the Upstash client auto-pipelines when enabled).
- [ ] Every cache key has a TTL and a namespaced prefix (`env:service:entity:id`).
- [ ] Cache stampede protection for hot keys (single-flight / lock).
- [ ] Don't cache authorization decisions longer than the session.

**Next.js**

- [ ] Static marketing pages stay static (no per-request nonce).
- [ ] `staleTimes` tuned (already 30 s dynamic / 180 s static).
- [ ] `optimizePackageImports` covers heavy barrels.
- [ ] No large server component payloads; stream where possible.
- [ ] Images via ImageKit/CDN, not the Node process.
- [ ] Compression at Caddy; don't double-compress.

**Streaming**

- [ ] SSE flushes immediately (`flush_interval -1`).
- [ ] Per-user concurrent stream cap (product + infra).
- [ ] Abort upstream AI call when the client disconnects.
- [ ] Backpressure: never buffer an unbounded stream in memory.

**Worker**

- [ ] `QUEUE_MAX_CONCURRENCY` matched to CPU + provider limits (currently 5).
- [ ] Batch size tuned; visibility timeout > max job duration.
- [ ] Dead-letter inspected weekly (`job_queue.status='dead'`).
- [ ] Idempotent handlers (send ledger, source event id).

**AI**

- [ ] Token budgets per run/day (`AI_DAILY_BUDGET`, `AGENT_MAX_TOKENS_PER_RUN`).
- [ ] Model routing: cheap classifier, stronger drafter.
- [ ] Circuit breaker on provider failures.
- [ ] Cache research/structured outputs (`RESEARCH_CACHE_TTL_MS`).
- [ ] Fallback provider configured (`AI_PROVIDER_FALLBACK_*`).

### 15.8 Soak and chaos

| Test | Duration | Pass criteria |
| --- | --- | --- |
| Soak at 1.5× expected peak | 60 min | p95 stable, RSS flat, no FD growth |
| Kill `web-1` under load | 2 min | Caddy reroutes, 0 failed requests after 10 s |
| Kill `redis` under load | 2 min | readiness 530, recovery, no data loss beyond 1 s |
| Add 200 ms PG latency | 5 min | app sheds/waits gracefully, no cascade |
| Revoke AI key | 5 min | clear errors, draft path degrades, no crash loop |
| Fill disk to 90% | — | alert fires; no write corruption |

### 15.9 Record results

| Date | Tag | Scenario | RPS | p50 | p95 | p99 | Errors | CPU | Mem | Bottleneck | Change |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | | | | | |

Keep this table in the tracker or next to it. A baseline you cannot compare is useless.

### 15.10 Exit criteria

- [ ] Baseline recorded for S1–S4.
- [ ] SSE verified under at least 20 concurrent streams.
- [ ] One bottleneck identified and fixed (or explicitly deferred).
- [ ] Soak passed with flat memory.
- [ ] Thresholds wired into CI or a scheduled k6 run.

---

## 16. Stage 13 — Scaling playbook: from one node to 1M RPS

**Purpose:** a realistic, cost-aware path. Each stage names the active constraint and the minimum change that removes it. Do not skip stages; each one buys information.

### 16.1 The honest starting point

| Dimension | Now | Limit of this node |
| --- | --- | --- |
| HTTP API | 2 vCPU, 2 Next.js replicas | ~1k–5k RPS depending on path |
| Postgres | local, 2 GB shared buffers | ~5k–20k simple reads/s; far fewer writes |
| Redis | 1 instance | ~100k ops/s |
| Queue | Postgres `SKIP LOCKED` | ~1k–5k jobs/s |
| AI streams | provider-bound | tens–low hundreds concurrent |
| Availability | single host | any host failure = outage |

**1M RPS for this product is not a near-term goal.** The value of the model is that the same decisions prevent collapse at 10× and 100× growth.

### 16.2 Stage A — Single node (current)

**Capacity:** 10k active users with the §16.2b preconditions; otherwise thousands of registered users and hundreds of concurrent sessions.
**Constraint:** CPU and Postgres.
**Do now:** §15 tuning, indexes, caching, compression, keep memory flat, monitor.
**Cost:** one VPS + AI usage.

### 16.2b Stage A+ — 10k active users on this node (the actual target)

This is the bridge between "thousands of users" and Stage B. It is a
**configuration and data-lifecycle** stage, not a hardware purchase.

**Envelope on KVM 2 (2 vCPU / 8 GB / 100 GB):**

| Dimension | Fits | Does not fit |
| --- | --- | --- |
| Users | 10k DAU, 1–2k peak concurrent sessions | 10k simultaneously active users |
| HTTP | 100–400 RPS | thousands of RPS |
| SSE | 1–2k mostly-idle streams | 10k concurrent AI streams |
| AI | 50–100 concurrent generations | unbounded streams |
| Data | 13 MB now; ~3–10 GB/day raw growth | months of full bodies on 100 GB |
| Bandwidth | 0.3–1.5 TB/month | 8 TB/month |

**Preconditions — all required before calling 10k "supported":**

1. **Body lifecycle (tracker A8).** Trim HTML, cap bodies, keep a ~90-day hot
   window, archive/re-fetch older mail. Without this, disk is the first outage.
2. **AI/SSE caps.** 2–3 streams per user, 50–100 global generations, queue
   beyond that. Memory per active stream is orders of magnitude larger than an
   idle socket.
3. **Index and N+1 audit (§15.7).** Mail list, thread hydration, queue claim and
   billing lookups must be index-only at 1–4k QPS.
4. **Builds off-host (A10).** An on-host `next build` on 2 vCPU competes with
   requests; use GHCR, or deploy in a low-traffic window with a maintenance note.
5. **Monitoring + disk alerts.** External readiness probe, `capacity-report.sh`,
   alerts at 60/75/85% disk and on backup heartbeat.
6. **R2 for assets, offsite dumps, RPO ≤ 6 h.** Do not run 10k users on a 24 h
   RPO and a single disk.
7. **A load test at 400 RPS + 2k SSE streams** (§15) with flat memory for 60 min.

**Expected first bottlenecks, in order:** Postgres CPU/IOPS on thread reads →
worker CPU on sync fan-out → AI provider TPM/RPM → disk. NIC bandwidth is last.

**Provider quotas are part of capacity.** Verify current Gmail API per-project
and per-user limits, the OAuth consent-screen status, and the AI provider's
TPM/RPM before launch. Sync bursts (many users reconnecting at once) hit quotas
harder than steady state.

**Do not** resize to 4 vCPU / 16 GB until a measured test shows CPU or memory as
the active constraint; the same money is better spent on the body lifecycle and
backups first.

### 16.3 Stage B — Vertical + managed data (10k–50k RPS ≈ 100k+ active users)

| Change | Why | Effort |
| --- | --- | --- |
| 4 vCPU / 16 GB (or 8/32) | more headroom for web + PG | resize |
| `shared_buffers=4GB`, web mem 1.5g, pools 12 | match hardware | config |
| Managed Postgres (Mumbai) with PITR | removes DB SPOF, backups | env change |
| Managed Redis or dedicated Redis host | isolates cache/session load | env change |
| PgBouncer (transaction mode) | protects connections as replicas grow | container |
| R2 + CDN for static/media | offload bandwidth | already R2 |

> **Stage B starts at ~10k RPS, not 10k users.** If the goal is 10k *active
> users*, §16.2b is the relevant stage; do not buy Stage B hardware to solve a
> Stage A+ data-lifecycle problem.

**Constraint after:** DB round-trips and single-host failure.
**Cost:** ~2–4× current infra.

### 16.4 Stage C — Horizontal app tier (50k–200k RPS)

```
            ┌──────────────┐
Internet ──►│ L4/L7 LB     │  (managed, pre-warmed)
            └──────┬───────┘
        ┌──────────┼──────────┐
   ┌────▼───┐ ┌────▼───┐ ┌────▼───┐
   │ app-1  │ │ app-2  │ │ app-N  │   stateless: web + Caddy/edge
   └────┬───┘ └────┬───┘ └────┬───┘
        └──────────┼──────────┘
             ┌─────▼─────┐   ┌────────────┐
             │ Redis     │   │ Postgres   │
             │ (shared)  │   │ primary +  │
             └───────────┘   │ replicas   │
                             └────────────┘
```

| Change | Why |
| --- | --- |
| 2–10 app nodes, no local state | horizontal CPU + TLS |
| Sessions in shared Redis | already true — no sticky sessions |
| Read replicas for mail list/thread reads | offload primary |
| Queue to Redis Streams / SQS | PG queue becomes the write bottleneck |
| CDN in front of static + assets | cut egress and TLS CPU |
| Edge rate limiting (Cloudflare/API GW) | shed abuse before compute |
| Centralized logs/metrics | N nodes are blind spots |

**Constraint after:** primary writes, Redis single-thread, LB capacity.

### 16.5 Stage D — Sharded data and async writes (200k–1M RPS)

| Layer | Change |
| --- | --- |
| Postgres | partition hot tables by tenant/time; archive old mail; move telemetry to a columnar store |
| Writes | buffer in Redis Streams/Kafka; micro-batch to PG (e.g., 5k rows per insert) |
| Redis | cluster mode, hash-tag related keys; replica reads; separate rate-limit DB |
| Queue | Kafka/Redpanda for fan-out; idempotent consumers |
| Sessions | clustered Redis or stateless signed tokens + short-lived cache |
| Edge | anycast, WAF, bot management, request collapsing |
| Assets | R2 + CDN, presigned direct uploads (already) |
| AI | queue + worker pool, per-tenant quotas, provider multiplexing |
| Observability | tracing + per-shard metrics |

**Bandwidth math at 1M RPS:** `1e6 × 30 KB = 30 GB/s = 240 Gbps`. One NIC cannot do this; you need many nodes or a CDN absorbing most of it. This is why payload trimming and edge caching dominate cost at scale.

### 16.6 Stage E — Multi-region (1M+ RPS)

- Regional app + data cells; route users to the nearest cell.
- Global load balancing/anycast; health-based failover.
- Data residency and per-region backups.
- Active-active only where the data model allows; otherwise primary + read replicas per region.
- Chaos drills across regions; error budgets per cell.

### 16.7 What must change in *this* codebase, in order

| Priority | Change | Trigger |
| --- | --- | --- |
| 1 | Index + N+1 audit; paginate mail | p95 > 500 ms on list |
| 2 | PgBouncer + read replica routing (`DATABASE_REPLICA_URL`) | primary CPU > 60% |
| 3 | Move queue off Postgres | queue lag > 1 min |
| 4 | Redis cluster / split rate-limit keyspace | Redis CPU > 60% |
| 5 | Session strategy for multi-node (already shared Redis) | > 3 nodes |
| 6 | Edge rate limiting + WAF | abuse or 429 storms |
| 7 | Async batch writes for telemetry | write IOPS saturated |
| 8 | Worker pool per job class | head-of-line blocking |
| 9 | Provider multiplexing + quotas | AI 429s |
| 10 | Multi-region cells | latency SLA by geography |

### 16.8 Cost at scale (reference order of magnitude)

| Component | Monthly |
| --- | --- |
| 128-core benchmark server (c8i.32xlarge class) | ~$5,000 |
| 64-core managed Postgres | ~$5,000–7,000 |
| Provisioned IOPS upgrade | +$1,000 |
| Max-spec DB IOPS | ~$33,000 |
| Redis cluster (30 shards, self-managed) | instance cost only |
| Egress (1 KB × 1M RPS) | ~$2,592/TB-month equivalent |
| **1M RPS realistic total** | **tens of thousands/month** |

The lesson from the benchmark: **algorithmic and payload efficiency beat hardware**. Removing 1 KB per response at 1M RPS saves more than a fleet upgrade.

### 16.9 Capacity planning formula

```
Nodes = ceil( peak_RPS / measured_RPS_per_node × safety_factor )
safety_factor = 1.5 (headroom for failure of one node + bursts)
```

Measure `RPS_per_node` at your SLO, not at saturation. Add one spare node for N+1 redundancy.

### 16.10 High-scale checklist applied to Tartly

Every item from the reference skill, mapped to this system. **N/A now** means it is
not the active constraint — not that it can be ignored forever.

| Checklist item | Current state | Activate when |
| --- | --- | --- |
| Multi-process / cluster mode | 2 Next.js containers, one process each (Compose scales by replica) | > 2 replicas or CPU saturated |
| Runtime specialization for hot paths | Node.js is I/O-bound here; AI/DB dominate | a CPU profile shows serialization/hashing > 30% |
| Avoid default JSON serialization cost | Next.js default; payloads are small JSON | p95 CPU-bound on large thread payloads |
| Keep-alive / HTTP2+3 | Caddy HTTP/2+3, persistent connections | already |
| LB capacity planning | no LB yet (single node, Caddy direct) | first second node; pre-warm managed LB |
| NIC sizing | 8 TB/mo ≈ 30 Mbps sustained; not a constraint | 1M RPS × 30 KB = 240 Gbps (multi-node/CDN) |
| Kernel socket tuning | `somaxconn=4096`, `file-max=200000`, fastopen, BBR | > 50k RPS: raise to 65535 / 1M fds |
| Remove DB from hot path | reads use indexes; writes are synchronous for correctness | write latency > 50 ms or IOPS saturated |
| Redis sharding | single instance, ~100k ops/s ceiling | Redis CPU > 60% or > 100k ops/s |
| Async batch writes | not needed; queue already offloads mail work | telemetry/mail-view writes dominate IOPS |
| O(log N) / indexed queries | indexed; audit pending (§15.7) | any seq scan on a hot table |
| DDoS / L7 scrubbing | provider network + UFW; no WAF | public launch at scale; add Cloudflare/WAF |
| Edge rate limiting | app-level 300/20/30 per min | abuse or 429 storms |
| Zero-trust network isolation | only 22/80/443 public; DB/Redis private | already |
| Stateless auth / local permission cache | Better Auth sessions in Redis (one lookup/request) | p95 auth latency or Redis hotspot |
| TLS offload | Caddy terminates TLS | already |
| Strict payload caps | Next.js defaults + per-route validation | add Caddy `request_body` limits per route |
| Linear-time regex / ReDoS audit | not audited | before accepting untrusted HTML/links at scale |
| Circuit breakers / load shedding | AI budgets + provider fallback env | provider 429/5xx storms |
| Payload truncation / egress | small JSON + compression + R2 assets | egress bill grows faster than users |
| **Email-body lifecycle** | full `bodyText` + `bodyHtml` in PG; ~32 kB/message measured | disk > 60% or > 90-day retention |
| **Disk / backup budget** | 100 GB shared; 3 local dumps default | any DB > 5 GB; alert at 60/75/85% |
| **SSE / AI concurrency caps** | not yet enforced in one place | first OOM, provider 429, or > 1k streams |
| **Provider quota math** | Gmail/AI limits not modelled | before 10k users; sync bursts |
| **Builds off production host** | on-host build | deploy latency spikes or > 2 deploys/day |
| Same-AZ / private transfer | single host | multi-node; keep cache/DB in one AZ |
| Spot / savings plans | n/a (one VPS) | multi-node workers |
| ARM price/performance | x86 VPS | next resize; compare Hostinger ARM |
| IOPS vs in-memory buffering | NVMe + tuned PG | IOPS bill or write saturation |
| Budget alarms / teardown | not configured | any cloud spend beyond the VPS |
| Distributed load generation | not yet; k6 from workstation | baseline §15; use 2+ generators above ~50k RPS |
| Percentiles + coordinated omission | plan in §15 | first k6 run |
| Soak 30–60 min | not yet | before launch |
| Chaos injection (Redis/PG/provider) | not yet | after first stable week |

### 16.11 Exit criteria

- [ ] Current stage identified with data.
- [ ] The next stage's trigger is documented and monitored.
- [ ] No change is made pre-emptively without a measured constraint.
- [ ] Every row above has either an owner or an explicit "not now" reason.

---

## 17. Stage 14 — Cost optimization

**Purpose:** spend on the constraint, not on inefficiency.

### 17.1 Where money goes in this app

| Cost | Driver | Lever |
| --- | --- | --- |
| AI tokens | drafts, triage, agent steps | model routing, budgets, caching, max steps |
| Compute | 2 vCPU VPS | right-size after measurement |
| Database | local (included) | managed later for HA, not throughput |
| Storage/egress | R2 (zero egress) | compression, CDN |
| Observability | free tiers | sample logs, 30 s scrape |
| Email/Gmail APIs | quotas | batching, watch renewal |

### 17.2 Egress and payload

- Compress > 1 KB (Caddy already).
- Trim JSON contracts; never send fields the UI doesn't use.
- Assets via R2/CDN, not the app.
- Avoid chatty APIs; batch on the server.
- HTTP/2+3 and keep-alive reduce handshake overhead.

### 17.3 Compute

- **Right-size before scaling.** A slow query on a bigger box is still slow.
- ARM instances (Graviton/Tau) often give 20–40% better price/performance.
- Spot for stateless workers with graceful shutdown (this app already drains).
- Savings plans for the steady baseline.
- Kill idle benchmark/staging instances automatically; budget alarms with a hard stop.

### 17.4 Database

- Don't buy provisioned IOPS to compensate for missing indexes.
- Buffer writes in Redis/queue, micro-batch to PG.
- Archive cold mail; keep hot tables small.
- Read replicas are cheaper than a bigger primary for read-heavy mail lists.
- Managed PITR may be cheaper than building WAL archiving yourself.

### 17.5 AI cost controls (the real bill)

- Route: cheap classifier, strong drafter, reasoning only when needed.
- Cache research and stable summaries.
- Hard budgets per user/day and global/day.
- Cap agent steps and tokens per run.
- Circuit breaker: fail fast instead of retrying expensive calls.
- Measure cost per active user and per draft; put it on a dashboard.

### 17.6 Monthly review

| Question | Metric |
| --- | --- |
| Are we paying for idle capacity? | CPU < 30% at peak |
| Is egress growing faster than users? | GB per DAU |
| Is AI cost per draft rising? | tokens/draft, $/draft |
| Is the DB doing unnecessary work? | seq scans, N+1, slow queries |
| Are backups/retention sane? | storage vs RPO |
| Any budget anomaly? | alarm history |

---

## 18. Stage 15 — Operations and incidents

### 18.1 Cadence

| Frequency | Task |
| --- | --- |
| Every deploy | backup if migration is non-trivial; record tag; verify readiness; smoke test |
| Daily (automated) | backup, daily cron, health probe |
| Weekly | review 5xx/p95, dead jobs, disk, certificate, `npm audit` |
| Monthly | restore drill, dependency updates, cost review, access review |
| Quarterly | chaos drill, DR tabletop, key rotation |

### 18.2 Deploy

```bash
ssh deploy@201.18.197.194
cd /opt/tartly
git pull --ff-only            # or rsync the working tree
bash deploy/scripts/deploy.sh
```

### 18.3 Rollback

```bash
cd /opt/tartly && bash deploy/scripts/rollback.sh
```

If the release included a destructive migration: restore the pre-deploy dump (§13.4). Never “fix forward” blindly at 3 a.m.

### 18.4 Incident severity

| Sev | Definition | Response |
| --- | --- | --- |
| SEV-1 | site down, data loss, security breach | page immediately; all hands; status page |
| SEV-2 | major feature broken (mail send, auth) | page; fix or roll back |
| SEV-3 | degraded performance / partial | business hours; monitor |
| SEV-4 | cosmetic / single user | backlog |

### 18.5 Common failures

| Symptom | Likely cause | First command | Fix |
| --- | --- | --- | --- |
| `502` from Caddy | both web unhealthy | `docker compose ps`; `logs web-1` | restore DB/Redis, roll back |
| readiness `530` | PG or Redis down | `pg_isready`, `redis-cli ping` | restart service, check disk |
| TLS error | cert not issued / DNS | `caddy` logs; `dig` | fix DNS, restart Caddy |
| sign-in loop | origin/redirect mismatch | browser network tab; env | fix `BETTER_AUTH_URL` + Google URI |
| mail not syncing | Pub/Sub / watch expired | `cron.sh daily`; logs | renew watch, check topic |
| queue backlog | worker down / poison job | `job_queue` counts | restart worker; requeue dead |
| OOM kill | stream leak / limit too low | `docker stats`; `dmesg` | cap streams, raise limit, fix leak |
| disk full | images/logs/backups | `df -h`; `docker system df` | prune, rotate, expand |
| DB connections maxed | pool misconfig / leak | `pg_stat_activity` | PgBouncer, fix leak |
| webhook 401 | wrong signing key | route logs | rotate key both sides |
| AI 429 | quota | provider dashboard | backoff, fallback, budget |

### 18.6 Post-incident template

```markdown
## Incident YYYY-MM-DD — <title>
- Severity:
- Duration (UTC):
- Impact (users, features, data):
- Detection (how, how long):
- Timeline (UTC, facts):
- Root cause:
- Contributing factors:
- What worked / what didn't:
- Action items (owner, due):
- Did we restore from backup? Was it verified?
```

### 18.7 Maintenance windows

- Announce for kernel/OS reboots, Postgres major upgrades, DNS changes.
- Take a dump before the window.
- Verify readiness + a real user flow after.
- Record in the tracker.

### 18.8 Certificate and dependency hygiene

- Caddy renews automatically; alert at < 14 days as a safety net.
- Monthly: `npm outdated`, `npm audit`, image rebuild, Trivy scan.
- Pin base images by digest in CI for reproducibility (version tags are human-friendly; digests are immutable).

---

## 19. Appendices

### A. Command cheat sheet

```bash
# --- status ---------------------------------------------------------------
cd /opt/tartly/deploy
docker compose --env-file .env ps
docker compose --env-file .env logs -f --tail 200 web-1 worker caddy
docker stats --no-stream
free -h; df -h /

# --- health ---------------------------------------------------------------
curl -fsS https://tartly.in/api/health/live
curl -fsS https://tartly.in/api/health/ready
curl -fsS -H "Authorization: Bearer $METRICS_TOKEN" https://tartly.in/api/health/metrics

# --- deploy / rollback ----------------------------------------------------
cd /opt/tartly && bash deploy/scripts/deploy.sh
cd /opt/tartly && bash deploy/scripts/rollback.sh
cd /opt/tartly/deploy && cat .deploy/current-tag

# --- database -------------------------------------------------------------
docker compose --env-file .env exec postgres psql -U tartly -d tartly
docker compose --env-file .env exec postgres pg_dump -U tartly -d tartly -Fc > /tmp/x.dump
docker compose --env-file .env run --rm --no-deps worker npm run db:migrate

# --- queue ----------------------------------------------------------------
docker compose --env-file .env exec postgres psql -U tartly -d tartly \
  -c "select status, kind, count(*) from job_queue group by 1,2;"

# --- backup / restore -----------------------------------------------------
./scripts/backup-postgres.sh
FORCE=1 ./scripts/restore-postgres.sh /var/backups/tartly/<dump>.zst

# --- cron -----------------------------------------------------------------
./scripts/cron.sh daily
./scripts/cron.sh followups
./scripts/healthcheck.sh

# --- ssh ------------------------------------------------------------------
ssh deploy@201.18.197.194
sudo ufw status verbose
sudo fail2ban-client status sshd
sudo sshd -T | grep -E '^(passwordauthentication|permitrootlogin)'
```

### B. Environment quick reference

| Variable | Required | Secret | Build-time | Default |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | ✅ | ✅ | — | — |
| `BETTER_AUTH_SECRET` | ✅ | ✅ | — | — |
| `BETTER_AUTH_URL` | ✅ | — | — | — |
| `NEXT_PUBLIC_BETTER_AUTH_URL` | ✅ | — | ✅ | — |
| `GOOGLE_CLIENT_ID/SECRET` | ✅ | ✅ | — | — |
| `UPSTASH_REDIS_REST_URL/TOKEN` | ✅ | token | — | — |
| `DB_POOL_MAX` | — | — | — | 8 web / 4 worker |
| `CRON_SECRET` | ✅ for cron | ✅ | — | — |
| `METRICS_TOKEN` | — | ✅ | — | metrics 404/401 |
| `CSP_MODE` | — | — | — | `report` |
| `API_RATE_LIMIT_PER_MIN` | — | — | — | 300 |
| `AGENT_RATE_LIMIT_PER_MIN` | — | — | — | 20 |
| `ASSET_RATE_LIMIT_PER_MIN` | — | — | — | 30 |
| `GOOGLE_PUBSUB_TOPIC` | — | — | — | operator off |
| `DODO_PAYMENTS_API_KEY` | for billing | ✅ | — | — |
| `DODO_PAYMENTS_WEBHOOK_KEY` | for billing | ✅ | — | — |
| `ASSET_STORAGE_DRIVER` | — | — | — | `vercel-blob` |
| `S3_*` | for R2 | ✅ | — | — |
| `NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT` | — | — | ✅ | — |
| `AI_DAILY_BUDGET` | — | — | — | provider default |
| `AUTOPILOT_ENABLED` | — | — | — | off |

### C. Ports and network map

| Port | Service | Exposure |
| --- | --- | --- |
| 22/tcp | sshd | public (key-only) |
| 80/tcp | Caddy | public (ACME + redirect) |
| 443/tcp | Caddy | public |
| 443/udp | Caddy | public (HTTP/3) |
| 3000 | web-1/2 | **private Docker network only** |
| 5432 | Postgres | **private only** |
| 6379 | Redis | **private only** |
| 80 (internal) | redis-http | **private only** |

### D. File map

```
deploy/
  DEPLOYMENT-TRACKER.md     state, blockers, next actions
  DEPLOYMENT-GUIDE.md       this document
  RUNBOOK.md                day-2 quick reference
  docker-compose.yml        web ×2, worker, PG18, Redis, SRH, Caddy
  Caddyfile                 TLS, HTTP/3, compression, SSE-safe proxy
  .env.example              infra values (copy to .env)
  app.env.example           runtime template
  postgres/init/            extensions (pg_stat_statements)
  scripts/
    render-env.mjs          .env → app.env + .env (workstation)
    bootstrap.sh            host prep + hardening + cron
    harden-ssh.sh           key-only SSH (00- prefix)
    deploy.sh               build → migrate → rolling release
    rollback.sh             previous image tag
    backup-postgres.sh      dump + zstd + R2 + heartbeat
    restore-postgres.sh     restore drill
    import-database.sh      Neon → local cutover
    cron.sh                 authenticated cron trigger
    healthcheck.sh          readiness + disk probe
```

### E. Acceptance script (copy/paste)

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
BASE="${1:-https://tartly.in}"
WWW="${BASE/https:\/\//https://www.}"
fail=0
check() { printf '%-52s' "$1"; if eval "$2" >/dev/null 2>&1; then echo OK; else echo FAIL; fail=1; fi; }

check "liveness 200"        "curl -fsS $BASE/api/health/live"
check "readiness 200"       "curl -fsS $BASE/api/health/ready"
check "landing 200"         "curl -fsS -o /dev/null $BASE/"
check "auth 200"            "curl -fsS -o /dev/null $BASE/auth"
check "pricing 200"         "curl -fsS -o /dev/null $BASE/pricing"
check "privacy 200"         "curl -fsS -o /dev/null $BASE/privacy"
check "www redirect 308"    "test \"\$(curl -s -o /dev/null -w '%{http_code}' $WWW)\" = 308"
check "hsts present"        "curl -sSI $BASE | grep -qi strict-transport-security"
check "no server header"    "! curl -sSI $BASE | grep -qi '^server: caddy'"
check "metrics requires auth" "test \"\$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/health/metrics)\" = 401"
check "cron requires auth"  "test \"\$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/v1/cron/daily)\" = 401"
check "404 is handled"      "test \"\$(curl -s -o /dev/null -w '%{http_code}' $BASE/does-not-exist)\" = 404"
exit $fail
```

### F. Decision log

See `DEPLOYMENT-TRACKER.md` §5. The guide intentionally does not duplicate mutable decisions.

### G. Glossary

| Term | Meaning |
| --- | --- |
| ACME | protocol Caddy uses to obtain Let's Encrypt certificates |
| BOLA/IDOR | broken object-level authorization — accessing another user's object by id |
| CDN | content delivery network |
| CSP | Content-Security-Policy |
| DLQ | dead-letter queue |
| HSTS | HTTP Strict Transport Security |
| IOPS | I/O operations per second |
| PgBouncer | Postgres connection pooler |
| RPO / RTO | recovery point / time objective |
| SRH | serverless-redis-http (Upstash REST facade) |
| SSE | Server-Sent Events (AI token streaming) |
| TTFT | time to first token |
| USE / RED | utilization-saturation-errors / rate-errors-duration |

### H. Change log for this guide

| Version | Date | Change |
| --- | --- | --- |
| 1.0.0 | 2026-10-23 | Initial guide: stages 0–15, first-node deployment, scale path to 1M RPS, security/cost checklists |
