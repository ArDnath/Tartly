# Tartly — production VPS

> One-page profile of the machine behind `tartly.in`: what it is, what runs on
> it, how it is locked down, and when it stops being enough.
>
> **Last verified against the live host:** 2026-10-24 (tag `9e1f951`).
> Re-check with §10 before treating any number here as current.
>
> This document contains **no secret values** — only locations and permissions.

---

## 1. Identity

| Field | Value |
| --- | --- |
| Role | Sole production host (web, worker, database, cache, edge) |
| Provider | Hostinger, **KVM 2** plan (KVM virtualisation) |
| Hostname | `srv2076028.hstgr.cloud` |
| Public IPv4 | `201.18.197.194` |
| Location | Mumbai 2, India |
| OS | Ubuntu 26.04.1 LTS (`resolute`) |
| Kernel | `7.0.0-34` |
| CPU | 2 vCPU |
| RAM | 8 GB advertised · 7.7 GiB visible to the OS |
| Swap | 4 GB `/swapfile`, `vm.swappiness=10` |
| Disk | 100 GB NVMe · ~96 GiB usable after formatting |
| Transfer | 8 TB/month |
| Runtime | Docker 29.9.2 · Compose v5.6.1 · Caddy 2.11.7 |
| Canonical origin | `https://tartly.in` (`www` 308s to apex) |
| TLS | Let's Encrypt via Caddy, auto-renew; cert valid to 2027-01-21 |
| Deployed tag | `9e1f951` (host git HEAD matches the running images) |
| Status | **Live** — apex and `www` resolve here |

The box is deliberately a single node. Everything stateful is either local and
backed up (Postgres, Redis) or already off-box (R2 for assets and backup
copies). The app tier is stateless, which is what makes a second node a
copy-paste later — see §9.

---

## 2. Access

| What | How | Notes |
| --- | --- | --- |
| Day-to-day SSH | `ssh deploy@201.18.197.194` | Key-only. Workstation key: `~/.ssh/id_ed25519` |
| Privilege | `deploy` is in `sudo` **and** `docker` | Passwordless sudo via `/etc/sudoers.d/90-tartly-deploy` |
| Root | Key-only | `PermitRootLogin prohibit-password`; no password login |
| Break-glass | Hostinger hPanel → VPS → Browser console | Use if SSH is misconfigured or the network is unreachable |
| App directory | `/opt/tartly` | Git checkout; `deploy/` holds the stack |
| GitHub | Read-only deploy key on the host | `ssh -T git@github.com` verified |

There is **no shared password** for this host. If you are reading this because
you need access: get the SSH key from the password manager, or use the hPanel
console. Never re-enable password authentication "just to get in" — fix the key.

---

## 3. Network

### 3.1 DNS

`tartly.in` uses Hostinger nameservers. Only the apex must point at this host:

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| A | `@` | `201.18.197.194` | 300 |
| A / CNAME | `www` | `201.18.197.194` / apex | existing |

`www` resolves to the same host and Caddy 308-redirects it to the apex. The
runbook lists a `www` A record while the guide lists a CNAME; both are valid —
only the apex value matters for cutover.

**Do not change nameservers, MX, TXT, SPF or DKIM.** `tartly.in` may also carry
mail, and Google domain verification lives in a TXT record.

### 3.2 Inbound ports

UFW default policy is **deny incoming**. Only four rules exist:

| Port | Proto | Purpose |
| --- | --- | --- |
| 22 | TCP | SSH (key-only, fail2ban-watched) |
| 80 | TCP | ACME HTTP-01 challenge + HTTPS redirect |
| 443 | TCP | HTTPS / HTTP/2 |
| 443 | UDP | HTTP/3 (QUIC) |

Nothing else is reachable. Postgres `5432`, Redis `6379` and the Next.js
replicas on `3000` are **not published to the host** — they are only on the
Compose network. Caddy is the sole public listener.

### 3.3 Outbound

Outbound is unrestricted by UFW. The host calls Google APIs, the AI provider,
Dodo Payments, Cloudflare R2, Let's Encrypt, GitHub and the OS package mirrors
over 443 (plus DNS, NTP and SMTP as required).

---

## 4. What runs on it

One Compose project (`tartly`), defined in [`docker-compose.yml`](./docker-compose.yml).

| Service | Image | Role | Host ports | Memory cap |
| --- | --- | --- | --- | --- |
| `caddy` | `caddy:2-alpine` | TLS, HTTP/2+3, compression, load balancing | `80`, `443/tcp`, `443/udp` | 256 MB |
| `web-1` | `tartly-web:<tag>` | Next.js standalone, SSR + API + SSE | — | 900 MB |
| `web-2` | `tartly-web:<tag>` | Second replica behind Caddy | — | 900 MB |
| `worker` | `tartly-worker:<tag>` | Durable Postgres queue (mail, follow-ups, autopilot) | — | 1 GB |
| `postgres` | `postgres:18-alpine` | Source of truth, queue, migrations | — | 3 GB |
| `redis` | `redis:7-alpine` | Sessions, cache, rate limits; AOF, `noeviction` | — | 640 MB |
| `redis-http` | `hiett/serverless-redis-http` | Upstash-compatible REST facade over local Redis | — | 128 MB |

Caps total **≈6.8 GB** against 7.7 GiB visible RAM. They are ceilings, not
reservations: measured idle use after a clean deploy was ~400 MB across the
whole stack. The 4 GB swap exists mainly so an on-host `next build` survives
its memory spike.

```
Internet :80/:443
        │
     ┌──▼───┐
     │caddy │  TLS · HTTP/2+3 · zstd/gzip · SSE-safe
     └─┬──┬─┘
   ┌───▼┐ ┌▼───┐
   │web1│ │web2│  :3000, not published
   └──┬─┘ └┬───┘
      └──┬─┘
     ┌───▼────┐   ┌───────┐   ┌────────────┐
     │worker  │   │redis  │◄──│ redis-http │
     └───┬────┘   └───────┘   └────────────┘
     ┌───▼────┐
     │postgres│──► /var/backups/tartly ──► R2
     └────────┘
```

Application env is injected at runtime from `deploy/app.env`; infra values
(Postgres/Redis passwords, `TAG`, `PUBLIC_URL`, build-time `NEXT_PUBLIC_*`)
come from `deploy/.env`. Both are `0600`, outside the image, and excluded from
builds by `.dockerignore`.

---

## 5. Filesystem map

| Path | Contents | Permissions |
| --- | --- | --- |
| `/opt/tartly` | Git checkout of this repo | `deploy:deploy` |
| `/opt/tartly/deploy` | Compose file, Caddyfile, deploy scripts | `deploy:deploy` |
| `/opt/tartly/deploy/.env` | Infra env: DB/Redis secrets, `TAG`, public URL | `0600` |
| `/opt/tartly/deploy/app.env` | Full application env (~46 vars) | `0600` |
| `/var/backups/tartly` | Local `pg_dump` archives (rolling) | `0700 deploy` |
| `/etc/tartly/backup.env` | rclone R2 credentials + Healthchecks URLs | `0600 deploy` |
| `/etc/cron.d/tartly` | All Tartly schedules (§7) | `0644 root` |
| `/etc/docker/daemon.json` | Log caps, `live-restore`, address pool | `0644 root` |
| `/etc/sysctl.d/99-tartly.conf` | `swappiness`, `somaxconn`, BBR, fd limits | `0644 root` |
| `/etc/ssh/sshd_config.d/00-tartly.conf` | Key-only SSH policy | `0644 root` |
| `/etc/fail2ban/jail.d/tartly.local` | sshd jail | `0644 root` |
| `/var/log/tartly-cron.log` | Output of all scheduled jobs | `deploy`, logrotated |

Docker named volumes: `pgdata`, `redisdata`, `caddy_data`, `caddy_config`
(under `/var/lib/docker/volumes`). **These are the state.** Removing them with
`docker compose down -v` destroys the database, sessions and certificates.

**Never store user uploads or attachments on this disk.** They belong in
Cloudflare R2. The dump of record also lives in R2; the local copy is only a
fast restore path.

---

## 6. Host hardening

| Control | Setting |
| --- | --- |
| SSH | Key-only; `PasswordAuthentication no`; `KbdInteractiveAuthentication no`; `PermitRootLogin prohibit-password`; `MaxAuthTries 3`; `LoginGraceTime 20`; no X11/agent forwarding |
| SSH precedence | Policy lives in `00-tartly.conf` because sshd uses the **first** value it reads — cloud-init ships `50-cloud-init.conf` with password auth enabled |
| Firewall | UFW default deny incoming; allow 22/tcp, 80/tcp, 443/tcp, 443/udp |
| Brute force | fail2ban sshd jail: 5 retries / 10 min → 1 h ban |
| Patching | `unattended-upgrades` for security updates; auto-clean weekly |
| Time | chrony (TLS, JWT and webhook HMAC validation all depend on a sane clock) |
| Kernel | `swappiness=10`, `somaxconn=4096`, `tcp_fastopen=3`, BBR, `file-max=200000` |
| Docker daemon | JSON logs capped at 20 MB × 5; `live-restore`; address pool `172.30.0.0/16` |
| Containers | `no-new-privileges` on web/worker; web runs as uid 1001; explicit `mem_limit` and `stop_grace_period` on every long-lived service |

Secrets are never baked into an image. To rotate one: edit
`deploy/app.env`, then recreate only the affected services with
`docker compose up -d --no-deps --force-recreate <service>`.

---

## 7. Scheduled work

All entries are in `/etc/cron.d/tartly`, run as `deploy`, and append to
`/var/log/tartly-cron.log` (weekly rotation ×8, compressed).

| Schedule | Job |
| --- | --- |
| `15 */6 * * *` | Postgres dump → local + R2 offsite (live host) |
| `0 3 * * *` | Daily safety net: token refresh, digests, retention, reconcile |
| `*/5 * * * *` | Follow-up enrollment sweep |
| `*/15 * * * *` | Autopilot review sweep |
| `* * * * *` | Readiness + disk/RAM/cert probe → Healthchecks.io |

Cron expressions use the host timezone; the tracker records timestamps in UTC.

> **Known drift:** the repo's `bootstrap.sh` still installs the backup at
> `15 2 * * *` (daily). The live host was changed to `15 */6 * * *`
> (6-hourly) on 2026-10-23. Live wins; fix the script when convenient.
> Healthchecks.io ping URLs are still empty, so the every-minute probe runs
> but **no external alert fires** if the host dies.

Caddy renews TLS automatically; no cron entry is needed for certificates.

---

## 8. Backups and recovery

| Item | Value |
| --- | --- |
| Method | `pg_dump -Fc` piped through zstd |
| Local | `/var/backups/tartly`, rolling (keep 2–3 once the DB exceeds 5 GB) |
| Offsite | `r2:tartly-backups/postgres`, 30-day retention |
| Cadence | Every 6 hours on the live host |
| RPO | ≤6 h for the database |
| RTO | ≈30 min (new host → bootstrap → restore env → restore dump → DNS) |
| Drill | Restore into a scratch database monthly; verify row counts and SHA-256 |
| Not in the dump | `deploy/app.env`, `deploy/.env` (password manager), R2 objects (R2 is the durable store) |

**`BETTER_AUTH_SECRET` must never change casually.** Gmail and Outlook refresh
tokens are encrypted with it; rotating it disconnects every mailbox and forces
users to re-authenticate.

Redis sessions are not backed up. A restore signs everyone out once — expected
and harmless.

---

## 9. Limits and exit triggers

Know which constraint is active before changing anything. On this box, in order:

| Limit | Trigger | Action |
| --- | --- | --- |
| Single node | Any host failure = full outage | Second app node + L4/DNS load balancer; sessions already in Redis, assets already in R2 |
| Disk | 60% warn / 75% high / 85% critical; DB ≥20 GiB | Email-body lifecycle (trim, cap, 90-day hot window, archive to R2); then managed Postgres |
| CPU | On-host build takes 3–5 min and competes with live traffic | Publish images to GHCR from CI; host only pulls + migrates + rolls |
| RAM | 6.8 GB of caps consumed; AI/SSE streams are the soft spot | Global AI concurrency cap + queue; then 16 GB node |
| RPO | 6 h is too much for the business | 6-hourly is current; add WAL archiving/PITR or move to managed Postgres |
| Observability | No external heartbeat yet | Create Healthchecks.io checks; add an external uptime probe on `/api/health/ready` |

**Vertical resize (first step, only after measurement):** 4 vCPU / 16 GB.
Then raise `web` memory limits to 1.5 GB, `shared_buffers` to 4 GB, and
`DB_POOL_MAX` to 12. Do not resize because the box "feels small" — run
`./scripts/capacity-report.sh` and look at the active constraint.

**Horizontal (when one node is not enough):** two hosts running the same
Compose stack (web + worker only), Caddy on each, shared Redis and R2, DNS/L4
LB in front. No sticky sessions required.

The 10k-active-user target (~1–2k peak sessions, 100–400 API RPS) fits this
node **only** with the body lifecycle, AI caps, index audit and external
monitoring in place. 10k *concurrent requests* is a multi-node stage — see
`DEPLOYMENT-GUIDE.md` §16.

---

## 10. Verification commands

Run from the workstation unless noted:

```bash
# Identity, uptime, versions
ssh deploy@201.18.197.194 'hostname; uptime -p; nproc; free -h; df -h /'
ssh deploy@201.18.197.194 'lsb_release -ds; uname -r; docker version --format "{{.Server.Version}}"; docker compose version'

# Hardening still in force
ssh deploy@201.18.197.194 'sudo ufw status verbose'
ssh deploy@201.18.197.194 'sudo sshd -T | grep -E "^(passwordauthentication|permitrootlogin)"'
ssh deploy@201.18.197.194 'sudo fail2ban-client status sshd'

# Stack health
ssh deploy@201.18.197.194 'cd /opt/tartly/deploy && docker compose --env-file .env ps'
curl -sS https://tartly.in/api/health/live
curl -sS https://tartly.in/api/health/ready

# DNS + edge
dig +short tartly.in                       # 201.18.197.194
dig +short www.tartly.in                   # same host
curl -sSI https://www.tartly.in | grep -i '^location'   # 308 → apex

# Capacity snapshot (read-only)
ssh deploy@201.18.197.194 'cd /opt/tartly/deploy && ./scripts/capacity-report.sh'
```

Green means: `passwordauthentication no`, only 22/80/443 in UFW, all containers
`healthy` or `running`, readiness returns 200 with Postgres/Redis `up`, `www`
returns 308, and the capacity report ends with
`All checks within the single-node envelope.`

---

## 11. Replacing this host

If the VPS is lost, or you are migrating to a new one:

1. Provision Ubuntu 24.04/26.04 on the new host (same or larger spec).
2. Point a new DNS A record at it with a **low TTL first**; don't move the apex
   until the new host is verified.
3. Run `deploy/scripts/bootstrap.sh`, then verify key access as `deploy`.
4. Run `deploy/scripts/harden-ssh.sh` **only after** confirming key login in a
   second terminal.
5. Restore `deploy/.env` and `deploy/app.env` from the password manager, mode
   `0600`; keep `BETTER_AUTH_SECRET` identical.
6. Clone the repo (or rsync it) to `/opt/tartly`.
7. Restore the newest dump with `deploy/scripts/restore-postgres.sh`.
8. `bash deploy/scripts/deploy.sh` — build, migrate, roll.
9. Verify §10, then repoint DNS and watch the old host for stray traffic.
10. Update `DEPLOYMENT-TRACKER.md` with the new IP, hostname, tag and timestamp.

Target: under 30 minutes once the dump is local. The slow parts are DNS
propagation and the first image build.

---

## 12. Source of truth

When documents disagree, the live host wins, then
[`DEPLOYMENT-TRACKER.md`](./DEPLOYMENT-TRACKER.md), then
[`DEPLOYMENT-GUIDE.md`](./DEPLOYMENT-GUIDE.md), then
[`RUNBOOK.md`](./RUNBOOK.md).

| Document | Purpose |
| --- | --- |
| [`DEPLOYMENT-TRACKER.md`](./DEPLOYMENT-TRACKER.md) | Current state, access map, next action |
| [`DEPLOYMENT-GUIDE.md`](./DEPLOYMENT-GUIDE.md) | Full staged procedure, security audit, capacity model |
| [`RUNBOOK.md`](./RUNBOOK.md) | Day-2 commands |
| [`R2-SETUP.md`](./R2-SETUP.md) | Buckets, CORS, backup credentials |
| **`VPS.md`** (this file) | The machine itself |
