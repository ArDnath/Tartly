# Runbook — Scaling, connections & the dedicated worker

Covers Phase D of `PLAN-production-hardening.md`: connection pooling (D4),
read replicas (D3), and the long-lived queue worker with graceful shutdown
(D1/D2). None of these require a code change to operate; they are config +
process choices.

## 1. Connection pooling (D4)

**Rule: always point `DATABASE_URL` at a pooled endpoint** (Neon `-pooler` host,
Supabase Supavisor, or PgBouncer in *transaction* mode). Each serverless
function instance opens its own `pg.Pool`; the pooler is what bounds the total
number of Postgres backends.

| Setting | Serverless default | Long-lived container |
| --- | --- | --- |
| `DB_POOL_MAX` | `5` | `10–20` (or `(cores × 2) + spindles`) |
| `idleTimeoutMillis` | `30s` (code) | `30s` |
| `connectionTimeoutMillis` | `15s` (code, tolerates scale-to-zero resume) | `15s` |

Transaction-pooling caveats that hold for this app:

- The durable queue uses `pg_advisory_xact_lock` (transaction-scoped) and
  `FOR UPDATE SKIP LOCKED` — both are safe under transaction pooling because
  they live and die inside one transaction.
- No session-scoped advisory locks or `SET`-based state are used, so a
  transaction pooler can move a client between backends between transactions.

## 2. Read replicas (D3)

Read/write splitting is **opt-in and off by default**. Set:

```
DATABASE_REPLICA_URL="postgresql://…-pooler…/db"   # pooled replica endpoint
```

When set, `lib/db` exposes `readDb` / `readPool` pointing at the replica;
`db` / `pool` remain the primary. Repositories take an injectable `Database`
in their constructor, so a read-heavy repository is switched by constructing it
with `readDb` instead of `db`.

**Replication lag is the whole risk.** Never route a read that must observe a
just-committed write (read-your-writes) through the replica. Candidates that are
safe today (append-only or lag-tolerant): activity/metrics rollups, digest and
report generation, historical analytics. Do **not** move: session/user-existence
checks, action claim/cancel, send-ledger claims, or any inbox list the user
mutates and immediately reloads.

Adoption checklist for one repository:

1. Construct it with `readDb` in its module-level singleton.
2. Confirm every method it exposes is read-only (`select` only).
3. Add an integration test that seeds on the primary and reads through the
   repository against the same database (replica == primary in tests).
4. Watch p95 and any "record not found after write" reports for a week.

When `DATABASE_REPLICA_URL` is unset, `readDb === db`, so there is zero
behaviour change and no extra pool.

## 3. Dedicated queue worker (D1/D2)

On serverless the queue drains opportunistically (`after()` on the Gmail
webhook; `/api/v1/cron/drain` on a schedule). A self-hosted / container
deployment can instead run a dedicated process:

```bash
npm run worker                 # local / VM
docker build --target worker -t lunabox-worker .
docker run --env-file .env lunabox-worker
```

The worker loop:

1. Claims a bounded batch (`QUEUE_DRAIN_BATCH_SIZE`, default 5) up to
   `QUEUE_MAX_CONCURRENCY`.
2. Re-drains immediately after a full batch; otherwise sleeps until
   `msUntilNextJob` (capped at 5s) so an idle queue is nearly free.
3. Backs off 1s after a drain error instead of crashing.

**Graceful shutdown** (SKILL §5.3): on `SIGTERM`/`SIGINT` the process

1. flips `/api/health/ready` to `530 shutting_down` (traffic drains),
2. stops claiming and awaits the in-flight drain (bounded by
   `WORKER_SHUTDOWN_TIMEOUT_MS`, default 30s),
3. closes the primary + replica pools,
4. exits `0`.

Scale the worker horizontally: the queue's `SKIP LOCKED` + one-running-per-lane
constraints make concurrent workers safe. Keep `QUEUE_MAX_CONCURRENCY` × worker
replicas below the Postgres connection budget.

## 4. Metrics scrape (D5)

```
GET /api/health/metrics
Authorization: Bearer $METRICS_TOKEN
```

Returns Prometheus text: `http_requests_total{method,route,status}`,
`http_request_duration_seconds` (histogram), plus process USE gauges. The
endpoint is `404` when `METRICS_TOKEN` is unset. `route` is the contract path
template (bounded cardinality). `traceparent` headers are propagated into every
log line's `trace_id`.
