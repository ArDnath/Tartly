# Production Hardening — Phase Plan & Tracker

> **What this file is.** The single source of truth for turning `app-server`
> (Lunabox) into a scalable, fault-tolerant, high-throughput backend, measured
> against the universal backend skill. It is written so a **fresh agent thread
> with zero prior context** can read this file alone and continue the work.
>
> **Reference skill.** `SKILL-v2.md` — the Universal Production-Grade Backend
> Engineering Skill & Readiness Audit Guide. A verbatim copy is vendored at
> **[`docs/SKILL-v2.md`](docs/SKILL-v2.md)** so any thread/machine can read it
> from the repo (original: `/home/ariyaman/Downloads/SKILL-v2.md`). Cite it as
> `SKILL §<n>` and `matrix #<n>` (the 20-point matrix is `SKILL §16`).
>
> **Repo conventions.** Read `AGENTS.md` first. Never commit `.env*` (only
> `.env.example`). New env vars go in `lib/env.ts` (Zod) **and** `.env.example`.
> Schema changes go through Drizzle (`lib/db/schema.ts` → `db:generate` →
> commit SQL → `db:migrate`). Keep changes additive.

---

## 0. Context bootstrap (read this if you are a new thread)

**Product.** Lunabox is a Next.js 16 (App Router) serverless backend on Vercel:
an AI email operator over Gmail + Google Calendar. Postgres (Drizzle) is the
source of truth; Upstash Redis is a speed layer; a durable Postgres job queue
(`lib/queue/queue.ts`) drives async work. Auth is Better Auth (Google OAuth).

**Current audit verdict.** The *application core* is strong (durable queue,
idempotent sends, owner-scoped access, provider resilience, migrations). The
*operational shell* was the gap: observability, CI/CD, rate limits, body caps,
uploads, connection pooling. Phase A closed the first tranche.

**Commands** (run from repo root):

```bash
npm ci                 # install
npx tsc --noEmit       # typecheck
npm run lint           # eslint
npm run db:migrate     # apply migrations (needs DATABASE_URL)
npm test               # smoke + eval suite (needs Postgres)
npm run build          # production build
```

**Status legend.** `[x]` done · `[~]` partial · `[ ]` not started · `[!]`
blocked. Each task lists *skill ref → change → files → acceptance*.

**No commits until asked.** This repo has substantial in-progress work by the
owner; treat unfamiliar uncommitted files as theirs.

---

## 1. Readiness matrix (baseline audit)

Status of the 20-point operational matrix of `SKILL §16`. Re-audit after each
phase and update this table.

| # | Area | Status | Notes / primary evidence |
|---|------|--------|--------------------------|
| 1 | Architecture layering | `[~]` | Thin routes + services; **no repository layer** (SQL inside services). Phase C. |
| 2 | REST & status codes | `[~]` | `/api/v1`, plural nouns; POST→200, no 201/204/422. Phase C. |
| 3 | OpenAPI contract | `[ ]` | No `openapi.yaml`, no contract validation. Phase C. |
| 4 | Input validation | `[~]` | Good Zod coverage on newer routes; loose query parsing on older ones. Phase C. |
| 5 | BOLA/IDOR protection | `[x]` | `userId` sourced from session everywhere; `ActionService` owner-scoped. Strong. |
| 6 | Authentication security | `[x]` | JWE cookie cache → Redis → Postgres; trusted origins; **auth rate limit added in A**. |
| 7 | Password/crypto hygiene | `[~]` | OAuth-only; OIDC RS256 verified. **Cron secret compare not constant-time** (B). |
| 8 | Global error middleware | `[~]` | `toSafeError` redaction + A logging; **envelope inconsistent** across route groups (B). |
| 9 | Graceful shutdown | `[ ]` | No SIGTERM drain; no worker process. Phase D (serverless today). |
| 10 | DB migrations | `[x]` | 21+ versioned Drizzle SQL migrations; no prod auto-sync. Strong. |
| 11 | Indexing & N+1 | `[x]` | 66 indexes / 68 FKs; `DISTINCT ON` + batched `inArray`. Strong. |
| 12 | Connection pooling | `[~]` | Pool `max:12` hardcoded in `lib/db/index.ts`. Phase B. |
| 13 | Caching & invalidation | `[~]` | Postgres AI cache w/ TTL + content hash; Redis session cache. No stampede guard (B). |
| 14 | Async queues | `[x]` | `job_queue` w/ `SKIP LOCKED`, lanes, dedupe, backoff, `dead` DLQ, reaper. **Job id uses `Math.random`** (B). |
| 15 | Object storage direct upload | `[ ]` | Server-buffered multipart; **no pre-signed URL**; Blob stored `access:"public"`. Phase B. |
| 16 | Webhook security | `[x]` | OIDC fail-closed + `event_log` dedupe + fast 200 + `after()`. Outbound N/A. |
| 17 | 12-Factor | `[x]` | Zod env, lockfile, `.env` ignored, stateless, feature gates. |
| 18 | Observability | `[~]` | **A added** structured logs, trace context, health probes, global error hook. Metrics/tracing still open (D). |
| 19 | Testing | `[~]` | 9k LOC DB-backed smoke/evals; no unit framework, coverage, or Testcontainers. Phase C. |
| 20 | Containerization & CI/CD | `[~]` | **A added** CI. Dockerfile still open (D). |

---

## 2. Roadmap overview

| Phase | Theme | Skill anchors | Status |
|-------|-------|---------------|--------|
| **A** | Operate: see it, gate it, protect it | §13, §5.3, §4.3, §3.2 | `[x]` done |
| **B** | Harden: uploads, secrets, identity, pools, streams | §9, §4.3, §6.3, §7.2, §10.1 | `[ ]` next |
| **C** | Contract & confidence: OpenAPI, layering, tests | §2, §1, §14 | `[ ]` |
| **D** | Scale: workers, replicas, tracing, containers | §8.1, §6.3, §13, §15 | `[ ]` |

---

## Phase A — Operate (DONE)

**Goal.** Make production incidents diagnosable and protect the API from abuse
— with zero business-logic change. **Exit criteria:** structured logs with a
trace id on every request, live+ready probes, per-user rate limits, body caps,
and a CI pipeline that gates PRs.

- [x] **A1. Structured JSON logger** · `SKILL §13.1`
  - `lib/observability/logger.ts`: JSON lines to stdout/stderr; mandatory
    `timestamp/level/message/trace_id/request_id/method/path/status_code/latency_ms`;
    deep redaction of `password/token/authorization/cookie/api_key/card_number/ssn/...`;
    never throws; level via `LOG_LEVEL` (default `info` prod, `debug` dev).
  - **Acceptance:** a log line is valid JSON and carries `trace_id` inside a
    request.

- [x] **A2. Request-scoped context** · `SKILL §1` (Request Context)
  - `lib/observability/context.ts`: `AsyncLocalStorage` frame; `runWithRequestContext`,
    `getRequestContext`, `setRequestUserId`, `resolveRequestId`.
  - **Acceptance:** concurrent requests never leak each other's user id.

- [x] **A3. Global error capture** · `SKILL §5.1`
  - `instrumentation.ts` + `lib/observability/instrumentation.ts`: Next
    `onRequestError` hook → logger. Node-only via guarded dynamic import.
  - **Acceptance:** a render error appears as one `request.unhandled_error` line.

- [x] **A4. Health probes** · `SKILL §13.2`
  - `app/api/health/live/route.ts` (process only), `app/api/health/ready/route.ts`
    (Postgres `select 1` + Redis `ping`, 2s timeout; **200 / 530**).
  - **Acceptance:** ready returns 530 with one dependency down.

- [x] **A5. Rate limiting** · `SKILL §4.3`
  - `lib/rate-limit.ts`: namespaced fixed-window counter
    (`ratelimit:<scope>:<subject>:<window>`), **fail-open**.
  - `lib/api/http.ts`: `withUser` default per-user ceiling (`API_RATE_LIMIT_PER_MIN`,
    default 300/min) → 429 + `Retry-After`. Stricter buckets: agent chat
    (`AGENT_RATE_LIMIT_PER_MIN`, 20), assets (30), campaigns import (10).
  - `lib/auth.ts`: Better Auth `rateLimit` on Redis secondary storage (built-in
    sign-in/OTP special rules ≈ 3/10s).
  - **Acceptance:** exceeding the ceiling yields 429 with `Retry-After`; Redis
    down does not block requests.

- [x] **A6. Request body caps** · `SKILL §3.2`
  - `withUser` rejects `Content-Length > maxBodyBytes` with 413 (default 1 MiB;
    assets `assetMaxBytes()+1 MiB`; campaigns import 11 MiB).
  - **Acceptance:** oversized JSON → 413 before the handler runs.
  - **Known limit:** header-based; chunked bodies without `Content-Length` rely
    on the platform cap (Vercel ~4.5 MB).

- [x] **A7. CI pipeline** · `SKILL §15.2`
  - `.github/workflows/ci.yml`: PR/push → `npm ci` → typecheck → lint →
    Postgres 16 service → `db:migrate` → `npm test` → `npm run build` →
    advisory `npm audit`. Placeholder non-secret env satisfies `lib/env.ts`.
  - **Acceptance:** the workflow defines the full job graph; first real run may
    surface env assumptions in the smoke suite (fix, don't skip).

- [x] **A8. Baseline security headers** · `SKILL §4.3`
  - `next.config.ts` `headers()`: HSTS (no preload), `X-Content-Type-Options`,
    `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`.
  - **Deliberately deferred:** CSP (needs nonces; belongs in Phase C).

- [x] **A9. Env + docs**
  - `lib/env.ts`: `LOG_LEVEL`, `API_RATE_LIMIT_PER_MIN`,
    `AGENT_RATE_LIMIT_PER_MIN`, `ASSET_RATE_LIMIT_PER_MIN` + getters.
  - `.env.example` §17 documents them.

**Files touched in Phase A**
`lib/observability/{context,logger,instrumentation}.ts`, `instrumentation.ts`,
`lib/rate-limit.ts`, `lib/api/http.ts`, `lib/mail/route.ts`, `lib/auth.ts`,
`lib/env.ts`, `next.config.ts`, `.env.example`, `.github/workflows/ci.yml`,
`app/api/health/{live,ready}/route.ts`,
`app/api/v1/agent/chat/route.ts`, `app/api/v1/assets/route.ts`,
`app/api/v1/campaigns/import/route.ts`.

**Phase A verification (all green, run at implementation time):**
`npx tsc --noEmit` ✅ · `npm run lint` ✅ (one pre-existing unrelated warning) ·
`npm run build` ✅ · health routes + `instrumentation.js` present in `.next`.

**Phase A caveats to remember**
1. The default limiter adds one Redis round trip per authenticated request
   (tens of ms on Upstash REST). Opt a hot path out with
   `withUser({ rateLimit: false }, handler)` if profiling demands it.
2. Body cap is `Content-Length`-based.
3. Security headers landed without CSP.

---

## Phase B — Harden (NEXT)

**Goal.** Close the abuse/leak/scale foot-guns before user growth. **Exit
criteria:** no unbounded in-memory upload path, no non-constant-time secret
compare, no collision-prone IDs, pool size is explicit, and the SSE path cannot
melt Postgres.

- [x] **B1. Object storage: pre-signed or streamed uploads + private bucket** · `SKILL §9`, matrix #15
  - **Problem.** `app/api/v1/assets/route.ts` calls `request.formData()` and
    `Buffer.from(await file.arrayBuffer())` — the whole file is in function
    memory. `lib/assets/storage.ts` stores with `access: "public"`.
  - **Do.** Prefer `@vercel/blob` client-upload (`handleUpload` pre-signed
    token) or a server-issued pre-signed S3 POST with a strict policy:
    `content-length-range`, exact `Content-Type` allowlist. Store metadata in
    `assets` (already present). Make reads go through the authenticated
    `/api/v1/assets/[id]/raw` proxy. Keep server-side validation as defence.
  - **Files.** `app/api/v1/assets/route.ts`, `lib/assets/storage.ts`,
    `lib/assets/service.ts`, `components/settings/asset-library.tsx`.
  - **Acceptance.** Browser uploads bytes directly to storage; no file bytes
    transit the function; bucket objects are private; a 50 MB file is rejected
    at the policy boundary, not in memory. `ASSET_MAX_BYTES` / MIME still enforced.
  - **Landed.** `POST /api/v1/assets/upload-ticket` mints a scoped,
    content-addressed target (`assets/<userId>/<sha256>`) after MIME/size
    validation; `POST /api/v1/assets/upload` implements Blob `handleUpload`
    (private access, `allowedContentTypes` + `maximumSizeInBytes`); the S3
    driver gets a SigV4 presigned `PUT` with `content-type`/`content-length`
    signed into the policy. `POST /api/v1/assets` now registers the finished
    upload from metadata only (`headAssetObject` probe — bytes never buffered).
    Blob reads switched from anonymous `fetch(url)` to authenticated `get()`;
    `ASSET_BLOB_ACCESS` defaults to `private`. `createAsset` (agent/tests) is
    unchanged in signature and now stores privately.
  - **Evidence.** `npx tsc --noEmit` ✅ · `npm run lint` ✅ (one pre-existing
    unrelated warning) · `npm run build` ✅ (routes `/api/v1/assets/upload`,
    `/api/v1/assets/upload-ticket` compiled).

- [x] **B2. Constant-time secret comparison** · `SKILL §4.3`, matrix #7
  - **Problem.** `lib/email-operator/cron-auth.ts:17` compares with `===`.
  - **Do.** `crypto.timingSafeEqual` over equal-length buffers (guard length
    first). Audit other secret compares (webhook already uses asymmetric verify).
  - **Acceptance.** Constant-time compare; wrong-length inputs return false
    without throwing.
  - **Landed.** New `lib/security/constant-time.ts` exports
    `constantTimeEqual(a, b)` (length guard → `timingSafeEqual`). `cron-auth.ts`
    now uses it. Audit found no other shared-secret `===` compares; the Gmail
    webhook verifies a Google OIDC token asymmetrically.
  - **Evidence.** `npx tsc --noEmit` ✅ · `npm run lint` ✅ (one pre-existing
    unrelated warning).

- [x] **B3. Collision-safe IDs for the queue** · `SKILL §8.2`, matrix #14
  - **Problem.** `lib/queue/queue.ts:106` builds job ids from `Math.random()`.
  - **Do.** Use `nanoid()` (already a dependency) or a ULID helper. Check other
    `Math.random()` id sites.
  - **Acceptance.** No `Math.random()` in persisted-id generation.
  - **Landed.** `enqueueJob` now uses `randomUUID()` (`job_<uuid>`); MIME
    boundaries (`lib/gmail/mime.ts`) use `randomUUID()`; test scaffolding
    (`scripts/email-operator/harness.ts`, `phase2-engine-queue.ts`) also moved
    off `Math.random`. `id` columns are `text`, so no length regression.
  - **Evidence.** `grep -r "Math\.random"` → no matches ✅ · `npx tsc --noEmit`
    ✅ · `npm run lint` ✅ (one pre-existing unrelated warning).

- [ ] **B4. Connection pooling sizing + pooler guidance** · `SKILL §6.3`, matrix #12
  - **Problem.** `max: 12` hardcoded in `lib/db/index.ts`; serverless fan-out
    multiplies that per instance.
  - **Do.** Read `DB_POOL_MAX` (default lower for serverless, e.g. 5) from env;
    document the mandatory pooled endpoint (Neon `-pooler` / Supavisor);
    confirm `idleTimeoutMillis` / `connectionTimeoutMillis`.
  - **Acceptance.** Pool size is configurable; `.env.example` documents the
    pooled-endpoint requirement.

- [ ] **B5. `getSession` existence-check cost** · `SKILL §6.3` / §13
  - **Problem.** `lib/session.ts` runs a Postgres `SELECT` on the `user` row on
    every authenticated request (to reject stale cookie-cache users).
  - **Do.** Cache the existence probe in Redis (short TTL, invalidate on user
    delete), or accept FK-conflict-on-write with a clean 401. Keep correctness:
    a deleted user must not be treated as authenticated.
  - **Acceptance.** A repeat request within the cache TTL does no `user` SELECT.

- [ ] **B6. SSE scaling** · `SKILL §10.1`
  - **Problem.** `app/api/v1/agent/events/route.ts` polls Postgres every 3s per
    connected client.
  - **Do.** Either move to a pub/sub backplane (Redis/NATS) for action updates,
    or bound the connection (max lifetime + client reconnect) and batch the
    cursor query. Measure query rate per active tab.
  - **Acceptance.** N concurrent clients do not produce O(N) polls/sec.

- [ ] **B7. Cache stampede / single-flight** · `SKILL §7.2`
  - **Problem.** `lib/ai/cache.ts` has TTLs but no mutex; a popular key expiring
    fans many identical model calls into the DB.
  - **Do.** Redis lock/single-flight around expensive misses, or probabilistic
    early expiry (XFetch).
  - **Acceptance.** Concurrent misses for one key trigger one recompute.

- [ ] **B8. Unified error envelope + trace id** · `SKILL §5.1`, matrix #8
  - **Problem.** `/api/onboarding/*`, `/api/ai/*`, `/api/sign-out` return
    `{ error: "..." }`; `/api/v1/*` returns `{ error: { code, message } }`; no
    `trace_id` in errors.
  - **Do.** One helper shaping `{ error: { code, message, trace_id } }`; adopt a
    consistent status taxonomy (see C4). Include `getRequestId()` in bodies.
  - **Acceptance.** Every JSON error has the same shape and a queryable trace id.

- [ ] **B9. HTTP idempotency for mutating POSTs** · `SKILL §8.2`
  - **Problem.** Only `sendEmail` has a ledger; arbitrary retried POSTs can
    duplicate side effects.
  - **Do.** Optional `Idempotency-Key` header → store `(userId, key, response)`
    for a TTL; replay returns the stored response.
  - **Acceptance.** A repeated POST with the same key runs the handler once.

- [x] **B10. Vendored skill + this tracker** (housekeeping)
  - `docs/SKILL-v2.md` now holds a verbatim copy of the skill; the header of
    this file points at it so other threads can read it in-repo.
  - **Acceptance:** `docs/SKILL-v2.md` exists and `PLAN-production-hardening.md` references it. ✅

---

## Phase C — Contract & confidence

**Goal.** Machine-checkable API contract, clean layering, and a real test
pyramid. **Exit criteria:** an OpenAPI spec validated in CI, services decoupled
from SQL, and unit/integration coverage gating merges.

- [ ] **C1. OpenAPI 3.1 contract** · `SKILL §2.5`, matrix #3
  - Author `openapi.yaml` (or generate from Zod); add request/response contract
    validation middleware; add an OpenAPI breaking-change check to CI.
  - Files: `openapi.yaml`, CI, possibly `lib/api/contract.ts`.
- [ ] **C2. Repository layer** · `SKILL §1.1`, matrix #1
  - Extract Drizzle queries out of services into `lib/repositories/*`; one
    method = one atomic storage operation.
- [ ] **C3. Test pyramid** · `SKILL §14`, matrix #19
  - Add Vitest unit tests for service/domain logic; Testcontainers integration
    tests for repositories + route handlers; coverage gate (>80% services).
- [ ] **C4. Response semantics** · `SKILL §2.2–2.3`, matrix #2
  - POST → 201 + `Location`; PUT/DELETE → 204; semantic validation → 422;
    paginate empty lists → 200 `[]`.
- [ ] **C5. Cursor pagination** · `SKILL §2.4`
  - Add opaque cursor pagination to large lists (inbox/followups/runs) alongside
    the existing `since`/`limit`; return `pagination.has_more/next_cursor`.
- [ ] **C6. CSP** · `SKILL §4.3`
  - Add a nonce-based `Content-Security-Policy` (test against the app shell,
    streaming chat, and inline styles). Report-only first.

---

## Phase D — Scale

**Goal.** Decouple throughput from request lifecycle and gain deep visibility.
**Exit criteria:** async work runs in a dedicated worker, reads can scale
horizontally, and traces/metrics are exported.

- [ ] **D1. Dedicated queue worker** · `SKILL §8.1`, matrix #14
  - Move `drainQueue` out of `after()`/request into a long-lived worker
    (container or scheduled high-frequency drain). Keep `job_queue` semantics.
- [ ] **D2. Graceful shutdown + worker readiness** · `SKILL §5.3`, matrix #9
  - SIGTERM/SIGINT trap → ready=false → `server.close()` → drain in-flight →
    stop workers → close pool in reverse order, within a timeout.
- [ ] **D3. Read replicas** · `SKILL §6.3`
  - Route SELECTs to a replica; handle replication lag explicitly.
- [ ] **D4. PgBouncer / Supavisor** · `SKILL §6.3`, matrix #12
  - Transaction-pooling proxy in front of Postgres; revisit pool sizes.
- [ ] **D5. OpenTelemetry + RED/USE metrics** · `SKILL §13.1`, matrix #18
  - `traceparent` propagation, spans for HTTP/DB/Redis/outbound, Prometheus RED
    histograms (p50/p95/p99) and USE gauges.
- [ ] **D6. Multi-stage, non-root Dockerfile** · `SKILL §15.1`, matrix #20
  - Distroless/scratch runtime, pinned digests, `.dockerignore`.
- [ ] **D7. Sharding / partitioning** · `SKILL §6.3`
  - Only when a table > ~100M rows; partition by tenant/hash.
- [ ] **D8. Transactional outbox for outbound webhooks** · `SKILL §10.2`
  - Only if/when outbound webhooks are added; write events in the same tx as the
    mutation, dispatch via worker, sign with HMAC + timestamp.

---

## 3. Risk register (current)

| Sev | Risk | Where | Phase |
|-----|------|-------|-------|
| P0 | No structured observability / probe | (was everywhere) | A ✅ |
| P0 | No CI gate | `.github/` | A ✅ |
| P0 | Near-zero rate limiting | `lib/api/http.ts` | A ✅ |
| P1 | Server-buffered uploads + public bucket | `assets/route.ts`, `storage.ts` | B1 ✅ |
| P1 | Non-constant-time cron secret | `cron-auth.ts` | B2 ✅ |
| P1 | `Math.random` queue ids | `queue.ts` | B3 ✅ |
| P1 | Pool fan-out / no global cap | `db/index.ts` | B4 |
| P1 | SSE per-client DB polling | `agent/events/route.ts` | B6 |
| P2 | No OpenAPI contract | repo root | C1 |
| P2 | SQL in services (no repos) | `lib/inbox`, `lib/services` | C2 |
| P2 | No unit/integration pyramid | `scripts/` only | C3 |
| P2 | Inconsistent error envelope | mixed route groups | B8 |
| P2 | No tracing/metrics | — | D5 |

---

## 4. How to update this file

1. Do a task, then flip `[ ]`→`[x]` and paste the **acceptance evidence**
   (command + result) under it.
2. If scope changes, edit the phase exit criteria first, then the task list.
3. Re-run the full matrix (`SKILL §16`) at the end of each phase and update §1.
4. Keep the exact file paths current — they are the handoff contract between
   threads.
