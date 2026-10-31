# Production Hardening — Phase Plan & Tracker

> **What this file is.** The single source of truth for hardening Tartly
> (Tartly) into a scalable, fault-tolerant, high-throughput backend, measured
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

**Product.** Tartly is a Next.js 16 (App Router) serverless backend on Vercel:
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

**Current working-tree state (verified 2026-10-02, HEAD `deea08c`).** The C2 +
C3 + C4 + C5 work described below is **uncommitted**: `lib/repositories/`
(**44 repos**), `tests/` (unit + integration), `lib/api/pagination.ts`,
`vitest.config.mts`, `vitest.integration.config.mts`, the modified
`lib/*/service.ts` / `lib/services/*.ts` / feature / route-handler modules, plus
`package.json` / `package-lock.json` (Vitest + Testcontainers dev deps and test
scripts), `eslint.config.mjs` (ignore `coverage/**`) and
`.github/workflows/ci.yml` (unit/coverage + integration steps). All are
working-tree changes, not in `git log`. A fresh thread must run `git status`
before assuming anything is committed. **Re-verified 2026-10-03 (follow-up audit
pass, HEAD `deea08c`):** `npm run test:coverage` → 21 files / 165 tests, gate
green (95.58% stmts / 87.35% branch / 95.34% funcs); `npm run test:integration`
→ 5 files / 85 tests against `postgres:16`; `npx tsc --noEmit` ✅ · `npm run
lint` ✅ (one pre-existing unrelated warning) · `npm run build` ✅ ·
`npm run openapi:check` ✅. The pass also fixed three C2 regressions and a
schema-drift risk — see "Follow-up audit pass — hardening loop" below.

**C2 is complete (2026-10-02); C4 + C5 landed the same session.** Every
`lib/*/service.ts`, service, feature, engine, adapter, agent, onboarding and
route-handler module reads and writes through `lib/repositories/*`. A repo-wide
grep finds **zero** `drizzle-orm` imports and **zero** `db.*` query chains
outside `lib/db/**` (client/schema/migrate), `lib/repositories/**`, and the
intentionally SQL-owning durable queue (`lib/queue/queue.ts`) — including the
`app/runs/*` pages that the original line-oriented grep missed. Resource
POSTs now return `201` + `Location`, DELETEs return `204`, and
inbox/followups/agent-actions/runs are cursor-paginated. See C2/C4/C5 for the
inventory.

**C1 is complete (2026-10-03).** The OpenAPI 3.1 contract is now generated
code-first from `lib/api/contracts/*` into the committed `openapi.yaml` (**119
operations**); `withUser` validates inbound query/params/body against the same
Zod schemas (`API_CONTRACT_VALIDATION=off|warn|enforce`, prod default `warn`);
and CI gates spec drift + breaking changes. New/uncommitted:
`openapi.yaml`, `lib/api/contracts/`, `lib/api/openapi/`, `scripts/openapi/`, the
`yaml` dev dependency, and schema imports in ~45 route handlers. Verified:
`npm run test:coverage` → 12 files / 98 tests (95.3% stmts / 85.09% branch /
97.56% funcs) · `npm run test:integration` → 4 files / 74 tests · `npx tsc
--noEmit` ✅ · `npm run lint` ✅ · `npm run build` ✅ · `npm run openapi:check` ✅.

**C6 is complete (2026-10-03).** A nonce-based CSP ships **enforcing by default**
(`CSP_MODE=off|report|enforce`; `lib/security/csp.ts` builds the policy,
`proxy.ts` mints the nonce). The report-only burn-in ran with a collector at
`/api/csp-report`; the follow-up pass split `style-src` into a nonce-bound
`style-src-elem` + `style-src-attr 'unsafe-inline'` and flipped the default to
`enforce` (rollback: `CSP_MODE=report`). The statically-prerendered marketing
pages are deliberately skipped (no per-request nonce); every dynamic page gets
the header. Validated live against `/auth` (the response header's nonce matches
all 20 nonced `<script>` tags in the same response). See C6 for the policy, scope
and evidence.

**Phase D + audit (2026-10-03).** D1/D2/D4/D5/D6 are landed, D3 is an opt-in
seam + runbook, and D7/D8 are documented as not-applicable. New:
`lib/queue/worker.ts`, `scripts/worker.ts`, `lib/lifecycle.ts`,
`lib/observability/{metrics,trace}.ts`, `app/api/health/metrics/route.ts`,
`lib/db/errors.ts`, `Dockerfile`, `.dockerignore`,
`docs/runbooks/scaling-and-connections.md`, and the route-handler/worker/metrics
tests. Two audit fixes: the `package-lock.json` was regenerated so `npm ci`
works on npm 10 (CI + Docker), and duplicate unique keys now return 409 instead
of 500. `lib/db` gained `readDb`/`readPool`/`closeDatabasePools()`. Re-verified:
**21 unit files / 165 tests** (95.58% stmts / 87.35% branch / 95.34% funcs) ·
**5 integration files / 82 tests** · `tsc`/`lint`/`build`/`openapi:check` ✅ ·
Docker `runner` + `worker` build and the runner serves `/api/health/live` → 200.
All still uncommitted on HEAD `deea08c`.

**Related plan.** `PLAN-24-7-autopilot.md` (Tartly 24/7 unattended replies) is
the next feature build and depends on this shell: it reuses `withUser`, the
error envelope (B8), the durable queue, and the C2/C3 repository + test seams.

---

## 1. Readiness matrix (baseline audit)

Status of the 20-point operational matrix of `SKILL §16`. Re-audit after each
phase and update this table.

| # | Area | Status | Notes / primary evidence |
|---|------|--------|--------------------------|
| 1 | Architecture layering | `[x]` | **Complete (C2, 2026-10-02; re-audited 2026-10-03).** Thin routes + services; every feature module is SQL-free on an injectable `lib/repositories/*` layer (**44 repos**). Repo-wide grep: **zero** `drizzle-orm` imports and **zero** `db.*` query chains outside `lib/db/**`, `lib/repositories/**`, and the intentionally SQL-owning `lib/queue/queue.ts`. The audit pass found two newer modules that had regressed (`lib/email-operator/reconcile.ts`, `lib/email-operator/retention.ts`) and moved their SQL into repositories + `queue.countDeadJobs`; the readiness probe now pings through `lib/db` (`pingDatabase`), so even `pool.query` no longer appears outside the allowed modules. |
| 2 | REST & status codes | `[x]` | **C4.** Resource-creating POST returns `201` + `Location`; all 8 DELETEs return `204`; domain-rule failures return `422`; paginated lists return `200` + a `pagination` block. RPC actions stay `200`. |
| 3 | OpenAPI contract | `[x]` | **C1 (2026-10-03).** Code-first contracts in `lib/api/contracts/*` generate a committed `openapi.yaml` (OpenAPI 3.1, **127 operations**) via `npm run openapi:generate`; `withUser` validates inbound query/params/body against the same Zod schemas before the handler; CI gates spec drift + breaking changes. **Follow-up (2026-10-03):** runtime validation now defaults to `enforce` everywhere. |
| 4 | Input validation | `[x]` | **C1** enforces it at the `withUser` seam by auto-matching the registered contract (default **`enforce`** everywhere since 2026-10-03; `warn`/`off` remain env escape hatches). The audit pass removed the schema *drift*: every legacy raw handler (`/api/ai/*`, `/api/onboarding/*`) that parsed a body imports its Zod schema from `lib/api/contracts/legacy.ts`, so the runtime check and the committed spec share one definition. **Fourth pass:** attacker-influenced outbound URLs are validated too — `lib/security/ssrf.ts` blocks non-http(s), reserved hostnames and private/reserved addresses before `open_web_page`/one-click-unsubscribe fetch. Remaining optional: field-level *response* schemas; routing the raw SSE/redirect handlers through `validateInbound` for uniformity. |
| 5 | BOLA/IDOR protection | `[x]` | `userId` sourced from session everywhere; `ActionService` owner-scoped. Strong. |
| 6 | Authentication security | `[x]` | JWE cookie cache → Redis → Postgres; trusted origins; **auth rate limit added in A**. |
| 7 | Password/crypto hygiene | `[x]` | OAuth-only; OIDC RS256 verified; **B** made the cron secret compare constant-time. |
| 8 | Global error middleware | `[x]` | `toSafeError` redaction + A logging; **B unified the envelope** to `{ error: { code, message, trace_id } }` everywhere. |
| 9 | Graceful shutdown | `[x]` | **D1/D2 (2026-10-03).** Long-lived queue worker (`lib/queue/worker.ts` + `scripts/worker.ts`) traps SIGTERM/SIGINT → `beginShutdown()` flips `/api/health/ready` to 530 → stops claiming → awaits the in-flight drain (bounded by `WORKER_SHUTDOWN_TIMEOUT_MS`) → closes primary+replica pools → exit 0. Verified end-to-end against Postgres: `WORKER_EXIT=0`. |
| 10 | DB migrations | `[x]` | 21+ versioned Drizzle SQL migrations; no prod auto-sync. Strong. |
| 11 | Indexing & N+1 | `[x]` | 66 indexes / 68 FKs; `DISTINCT ON` + batched `inArray`. Strong. |
| 12 | Connection pooling | `[x]` | **B** made the pool ceiling `DB_POOL_MAX` (serverless default 5). **D4** documents the mandatory pooled endpoint + transaction-pooling caveats and the per-instance sizing table (`docs/runbooks/scaling-and-connections.md`). |
| 13 | Caching & invalidation | `[x]` | Postgres AI cache w/ TTL + content hash; Redis session cache; **B** added single-flight stampede guard; session existence memoized. |
| 14 | Async queues | `[x]` | `job_queue` w/ `SKIP LOCKED`, lanes, dedupe, backoff, `dead` DLQ, reaper. **B** replaced `Math.random` job ids with `randomUUID`. **D1** adds a dedicated worker process with graceful drain. |
| 15 | Object storage direct upload | `[x]` | **B** moved to client-direct uploads (Blob `handleUpload`, S3 presigned PUT) with private objects and metadata-only registration. |
| 16 | Webhook security | `[x]` | OIDC fail-closed + `event_log` dedupe + fast 200 + `after()`. Outbound N/A. |
| 17 | 12-Factor | `[x]` | Zod env, lockfile, `.env` ignored, stateless, feature gates. **Audit fix:** `package-lock.json` was npm-11-only and broke `npm ci` on npm 10; regenerated with npm 10 so CI/Docker installs are reproducible. |
| 18 | Observability | `[~]` | **A** logs + trace context + health probes + global error hook. **D5** adds in-process RED metrics (`lib/observability/metrics.ts`) exported from the bearer-gated `/api/health/metrics` (Prometheus text) and W3C `traceparent` propagation into every log's `trace_id`. Full OTel SDK span export for DB/Redis/outbound remains optional (see D5 caveats). |
| 19 | Testing | `[x]` | **C3 landed** a Vitest unit project and Testcontainers Postgres integration suites for the durable queue, repositories, AI/domain repos, C5 keyset pagination, C6 CSP. **This session** adds 8 route-handler integration tests (C4 status codes, C5 cursors, C1 enforcement, BOLA) and unit tests for the Postgres error helper, worker loop, lifecycle, metrics, trace. Re-verified 2026-10-03: **21 unit files / 165 tests** (95.58% stmts / 87.35% branch / 95.34% funcs) + **5 integration files / 82 tests**, all green. |
| 20 | Containerization & CI/CD | `[x]` | **A added** CI. **D6** adds a multi-stage, non-root Dockerfile (`runner` standalone image + `worker` target) and `.dockerignore`; CI now also builds both image targets. Docker runner verified: uid 1001, `/api/health/live` → 200. |

---

## 2. Roadmap overview

| Phase | Theme | Skill anchors | Status |
|-------|-------|---------------|--------|
| **A** | Operate: see it, gate it, protect it | §13, §5.3, §4.3, §3.2 | `[x]` done |
| **B** | Harden: uploads, secrets, identity, pools, streams | §9, §4.3, §6.3, §7.2, §10.1 | `[x]` done |
| **C** | Contract & confidence: OpenAPI, layering, tests | §2, §1, §14 | `[x]` C1–C6 done (C3's optional unit-gate widening intentionally deferred) |
| **D** | Scale: workers, replicas, tracing, containers | §8.1, §6.3, §13, §15 | `[~]` D1/D2/D4/D5/D6 done; D3 seam + runbook; D7/D8 conditional |

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
  - **Follow-up (audit pass):** the legacy raw handlers bypass `withUser`, so
    `enforceUserRateLimit` (also in `lib/api/http.ts`) now applies the same
    ceiling to them — `scope: "ai"` at `AGENT_RATE_LIMIT_PER_MIN` for the
    model-backed SSE routes, `scope: "legacy"` at the default ceiling for the
    rest. The OAuth redirect landing stays unlimited by design.
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

## Phase B — Harden (DONE)

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

- [x] **B4. Connection pooling sizing + pooler guidance** · `SKILL §6.3`, matrix #12
  - **Problem.** `max: 12` hardcoded in `lib/db/index.ts`; serverless fan-out
    multiplies that per instance.
  - **Do.** Read `DB_POOL_MAX` (default lower for serverless, e.g. 5) from env;
    document the mandatory pooled endpoint (Neon `-pooler` / Supavisor);
    confirm `idleTimeoutMillis` / `connectionTimeoutMillis`.
  - **Acceptance.** Pool size is configurable; `.env.example` documents the
    pooled-endpoint requirement.
  - **Landed.** `lib/db/index.ts` reads `DB_POOL_MAX` (default 5) straight from
    `process.env` (so scripts importing the pool skip full env validation);
    `idleTimeoutMillis` 30s and `connectionTimeoutMillis` 15s confirmed.
    `lib/env.ts` registers `DB_POOL_MAX`; `.env.example` documents it and the
    mandatory pooled endpoint.
  - **Evidence.** `npx tsc --noEmit` ✅ · `npm run lint` ✅ (one pre-existing
    unrelated warning).

- [x] **B5. `getSession` existence-check cost** · `SKILL §6.3` / §13
  - **Problem.** `lib/session.ts` runs a Postgres `SELECT` on the `user` row on
    every authenticated request (to reject stale cookie-cache users).
  - **Do.** Cache the existence probe in Redis (short TTL, invalidate on user
    delete), or accept FK-conflict-on-write with a clean 401. Keep correctness:
    a deleted user must not be treated as authenticated.
  - **Acceptance.** A repeat request within the cache TTL does no `user` SELECT.
  - **Landed.** New `lib/session-cache.ts` memoizes only the **positive** probe
    (`session:user-exists:<id>`, 60s TTL, best-effort); absence is never cached,
    so a recreated id is never locked out. `lib/session.ts` checks the memo
    before the `SELECT` and clears it when the row is gone. Better Auth's
    `databaseHooks.user.delete.after` invalidates immediately, bounding the
    deletion window to the TTL for out-of-band deletes.
  - **Evidence.** `npx tsc --noEmit` ✅ · `npm run lint` ✅ (one pre-existing
    unrelated warning).

- [x] **B6. SSE scaling** · `SKILL §10.1`
  - **Problem.** `app/api/v1/agent/events/route.ts` polls Postgres every 3s per
    connected client.
  - **Do.** Either move to a pub/sub backplane (Redis/NATS) for action updates,
    or bound the connection (max lifetime + client reconnect) and batch the
    cursor query. Measure query rate per active tab.
  - **Acceptance.** N concurrent clients do not produce O(N) polls/sec.
  - **Landed.** New `lib/realtime/poller.ts` owns **one** timer per server
    instance and batches every subscriber's cursor into a single query per tick
    (`listUpdatedSinceMany` / `listThreadActivitySinceMany`, both new). Both
    SSE routes (`agent/events`, `mail/events`) now share it via
    `lib/realtime/hubs.ts` (a `globalThis` singleton so HMR cannot leak a second
    interval). New `lib/realtime/sse.ts` centralizes headers, `hello`,
    abort/cancel cleanup and a 5-minute **max lifetime** that emits `reconnect`
    before closing; `EventSource` reconnects automatically. No new infra.
  - **Acceptance detail.** DB query rate is O(instances with ≥1 subscriber)
    instead of O(tabs); per-instance it is 1 query / 3s regardless of N. Across
    many serverless instances a full cross-instance backplane would be needed;
    this bounds cost per instance and connection lifetime.
  - **Evidence.** `npx tsc --noEmit` ✅ · `npm run lint` ✅ (one pre-existing
    unrelated warning).

- [x] **B7. Cache stampede / single-flight** · `SKILL §7.2`
  - **Problem.** `lib/ai/cache.ts` has TTLs but no mutex; a popular key expiring
    fans many identical model calls into the DB.
  - **Do.** Redis lock/single-flight around expensive misses, or probabilistic
    early expiry (XFetch).
  - **Acceptance.** Concurrent misses for one key trigger one recompute.
  - **Landed.** New `singleFlight(key, compute)` in `lib/ai/cache.ts`: an
    in-process promise map dedupes local callers, and a best-effort Redis `SET NX
    PX` lock (30s self-expiry) dedupes across instances; the lock loser waits
    briefly and re-checks. The three cached features (`summarize-thread`,
    `meeting-brief`, `report`) now do their read→compute→write inside
    `singleFlight`, with a re-check after winning. Redis failure degrades to
    duplicate work, never a hang.
  - **Evidence.** `npx tsc --noEmit` ✅ · `npm run lint` ✅ (one pre-existing
    unrelated warning).

- [x] **B8. Unified error envelope + trace id** · `SKILL §5.1`, matrix #8
  - **Problem.** `/api/onboarding/*`, `/api/ai/*`, `/api/sign-out` return
    `{ error: "..." }`; `/api/v1/*` returns `{ error: { code, message } }`; no
    `trace_id` in errors.
  - **Do.** One helper shaping `{ error: { code, message, trace_id } }`; adopt a
    consistent status taxonomy (see C4). Include `getRequestId()` in bodies.
  - **Acceptance.** Every JSON error has the same shape and a queryable trace id.
  - **Landed.** New `lib/api/error-envelope.ts` (`errorEnvelope` / `jsonError`)
    is the single source of truth; `apiError` in `lib/api/http.ts` now emits
    `trace_id` (from `getRequestId()`, minted when there is no ALS frame) and
    echoes it as `x-request-id`. Converted every raw `{ error: "..." }` route:
    `/api/ai/*` (5 files), `/api/onboarding/*` (5), `/api/webhooks/gmail`, and
    the three `/api/v1/cron/*` routes. Validation `issues` now live under
    `error.details`; `/api/sign-out` had no error path.
  - **Evidence.** `grep "error: *\"\|json({ error"` across `app/api` → no
    matches ✅ · `npx tsc --noEmit` ✅ · `npm run lint` ✅ (one pre-existing
    unrelated warning).

- [x] **B9. HTTP idempotency for mutating POSTs** · `SKILL §8.2`
  - **Problem.** Only `sendEmail` has a ledger; arbitrary retried POSTs can
    duplicate side effects.
  - **Do.** Optional `Idempotency-Key` header → store `(userId, key, response)`
    for a TTL; replay returns the stored response.
  - **Acceptance.** A repeated POST with the same key runs the handler once.
  - **Landed.** New `lib/api/idempotency.ts` (Redis-backed): `beginIdempotent`
    replays a stored JSON response, returns `409 Retry-After` while an identical
    key is in flight (`SET NX` lock), or hands the handler a `finish` that stores
    the response (24h TTL, <64 KiB, JSON only) and releases the lock. `withUser`
    honours the header on mutating methods by default; opt out with
    `{ idempotency: false }`. Redis failure degrades to a normal request.
  - **Evidence.** `npx tsc --noEmit` ✅ · `npm run lint` ✅ (one pre-existing
    unrelated warning) · `npm run build` ✅.

- [x] **B10. Vendored skill + this tracker** (housekeeping)
  - `docs/SKILL-v2.md` now holds a verbatim copy of the skill; the header of
    this file points at it so other threads can read it in-repo.
  - **Acceptance:** `docs/SKILL-v2.md` exists and `PLAN-production-hardening.md` references it. ✅

**Phase B verification (all green, run at implementation time):**
`npx tsc --noEmit` ✅ · `npm run lint` ✅ (one pre-existing unrelated warning) ·
`npm run build` ✅ after each task, then again at the phase end.

**Phase B caveats to remember**
1. Client-direct uploads default to **private** Blob objects; a public-access
   Blob store must set `ASSET_BLOB_ACCESS="public"`.
2. S3 client uploads use a SigV4 presigned `PUT` that signs
   `content-type`/`content-length`; the browser must send exactly those.
3. Idempotency stores JSON responses <64 KiB for 24h; streamed/oversize
   responses are not replayable.
4. The SSE poller is one-per-instance; a cross-instance backplane is Phase D if
   the fleet ever needs true O(1) fleet-wide polling.
5. `getSession`'s user-existence memo trusts Redis for up to 60s for
   out-of-band deletions; in-app deletes invalidate immediately.

---

## Phase C — Contract & confidence

**Goal.** Machine-checkable API contract, clean layering, and a real test
pyramid. **Exit criteria:** an OpenAPI spec validated in CI, services decoupled
from SQL, and unit/integration coverage gating merges.

- [x] **C1. OpenAPI 3.1 contract** · `SKILL §2.5`, matrix #3
  - Author `openapi.yaml`, add inbound contract-validation middleware, add an
    OpenAPI breaking-change check to CI.
  - **Landed (code-first, 2026-10-03).** The single source of truth is the Zod
    contract registry, not a hand-written spec:
    - `lib/api/contracts/registry.ts` defines `OperationContract`,
      `defineOperation` and the (method, path-template) matcher; `shared.ts`
      holds the cross-cutting envelopes (error/pagination/data/page) and domain
      enums.
    - One module per domain (`inbox`, `agent`, `mail`, `settings`, `assets`,
      `meetings`, `campaigns`, `legacy`) declares each operation once — request
      body/query/params schemas and responses.
    - `scripts/openapi/generate.ts` discovers **every** `app/api/**/route.ts`
      (a new route can never be missing from the spec), merges the overrides and
      renders `openapi.yaml` (OpenAPI 3.1, **127 operations**, `$ref`s the shared
      `ErrorEnvelope`). `--check` fails when the committed spec drifts.
    - `lib/api/openapi/spec.ts` converts Zod → JSON Schema 2020-12 via Zod 4's
      native `z.toJSONSchema()`; `lib/api/openapi/breaking.ts` +
      `scripts/openapi/breaking-check.ts` detect removed paths/operations/
      response codes/path params, newly-required body fields, and narrowed
      enums/types.
    - **Runtime validation** is wired into `withUser`
      (`lib/api/contracts/validate.ts`): it auto-matches the request path, reads
      the JSON body through `request.clone()` (so the handler still parses it)
      and rejects with `400 { error: { code: "validation", details: issues } }`.
      `API_CONTRACT_VALIDATION` = `off|warn|enforce`; default `enforce` in
      dev/test, **`warn` in production** until the schemas burn in.
    - Routes import their schemas from the contract modules, so runtime
      validation and the spec share one definition (no drift).
  - **CI.** `npm run openapi:check` (drift) on every run; `npm run openapi:breaking
    -- --base <merge-base spec>` on PRs (checkout `fetch-depth: 0`).
  - **Evidence.** `npm run test:coverage` → 12 files / 98 tests, gate green
    (95.3% stmts / 85.09% branch / 97.56% funcs) · `npm run test:integration` →
    4 files / 74 tests ✅ · `npx tsc --noEmit` ✅ · `npm run lint` ✅ (one
    pre-existing unrelated warning) · `npm run build` ✅ · `npm run openapi:check`
    ✅ (in sync).
  - **Caveats.** (1) Legacy raw handlers (`/api/ai`, `/api/onboarding`, health,
    webhook, cron) do **not** run `withUser`, but each body-parsing handler
    validates with the registry schema inline (see `legacy.ts`), so they are
    enforced in substance; routing them through `validateInbound` is a cosmetic
    uniformity follow-up. (2) `POST /campaigns` multipart and `/assets/upload`'s
    Blob protocol body are documented loosely (the JSON branch is typed).
    (3) Responses are typed at the envelope level; field-level response schemas
    remain the open C1 follow-up.
  - **Follow-up landed (2026-10-03).** `API_CONTRACT_VALIDATION` now defaults to
    **`enforce`** in every environment (was `warn` in production): an invalid
    inbound request fails fast with `400 { error: { code: "validation",
    details } }`. Set `API_CONTRACT_VALIDATION=warn|off` to relax it without a
    deploy. `lib/env.ts` + `.env.example` updated; `tests/unit/api/http-contract.test.ts`
    still green.
- [x] **C2. Repository layer** · `SKILL §1.1`, matrix #1
  - Extract Drizzle queries out of services into `lib/repositories/*`; one
    method = one atomic storage operation.
  - **Landed (core service layer).** New `lib/repositories/*` classes, each
    taking an injectable `Database` (default `@/lib/db`) so tests drive them
    against a real Postgres. One method = one atomic query; no cross-repo
    orchestration. Repositories added: `pending-actions`, `scheduled-actions`,
    `research-cache`, `threads` (owns the inbox bucket `CASE`), `thread-states`,
    `messages`, `drafts`, `contacts`, `sender-profiles`, `mailboxes`,
    `flow-runs`, `users`, `meetings`, `followup-enrollments`, `commitments`,
    `send-ledger`. Migrated callers: `lib/services/{action,schedule,research,
    followup}-service.ts`, `lib/inbox/service.ts`, `lib/metrics/service.ts`,
    `lib/session.ts`. The four `lib/services` files named in the risk register
    are now SQL-free (only the queue handle/type re-export remain).
  - **Landed (all domain services).** The remaining `lib/*/service.ts` files
    are now SQL-free too, and moved onto repositories (existing ones extended
    and four new): `followup` → `followup-enrollments` + `messages` + `drafts`;
    `assets` → new `assets`; `commitments` → `commitments` + `threads` +
    `messages` + `drafts` + `send-ledger`; `briefing` → `followup-enrollments`,
    `commitments`, `meetings`, `users`, `messages`, `drafts`; `campaigns` → new
    `campaigns` (suppression, recipients, events) + `contacts`, `mailboxes`,
    `drafts`, `threads`; `activity` (read model) → new `activity` (all raw
    aggregates + JSONB trace queries) + `meetings`, `followup-enrollments`;
    `ai/usage` → new `ai-usage`. `lib/mail/service.ts` turned out to be pure
    Gmail pass-through with no SQL. Every `lib/*/service.ts` now only imports
    the queue `pool` handle, never the ORM.
  - **Landed (complete sweep, 2026-10-02).** The remaining non-service modules
    were extracted onto repositories with no behavior change. New
    repositories/families added: `ai-cache`, `agent-chat`, `agent-runs`,
    `assistant-settings`, `knowledge`, `reply-memory`, `automation-rules`,
    `digests`, `unsubscribe-attempts`; `calendar-persistence`, `onboarding`,
    `engine-{flows,persistence,drafts,thread-states,lookups}`, `thread-settings`;
    `thread-activity`, `event-log`, `gmail-persistence`, `gmail-send-ledger`,
    `google-account`, `contact-persistence`, `inbound-email`. Existing
    per-table repos were extended where a generic method fit (`sender-profiles`,
    `threads`, `messages`, `meetings`, `commitments`, `drafts`, `thread-states`,
    `users`, `flow-runs`). Every `lib/ai/**`, `lib/engine/**`,
    `lib/email-operator/**`, `lib/gmail/**`, `lib/calendar/**`, `lib/agent/**`,
    `lib/onboarding/**`, `lib/settings/autonomy.ts` and the four route handlers
    that still held SQL (`app/api/onboarding/{advance,sync-email/complete}`,
    `app/api/v1/runs/[id]`, `app/api/v1/threads/[threadId]/autonomy`) are now
    SQL-free.
  - **Exit criterion (verified).** Repo-wide:
    `grep -rl 'from "drizzle-orm' lib app` and
    `grep -rlE '\bdb\.(select|insert|update|delete|execute|transaction)\(' lib app`
    return **no files** outside `lib/db/**`, `lib/repositories/**`, and
    `lib/queue/queue.ts` (the queue deliberately owns its SQL). 44 repositories.
  - **Correction (2026-10-02, C4/C5).** The second grep above is line-oriented
    and missed a multi-line chain (`db\n  .select(...)`) in
    `app/runs/page.tsx` and `app/runs/[id]/page.tsx`. Both now read through
    `FlowRunRepository` (`listForUser` / `findByIdForUser`), so the invariant
    holds for real; the new paginated `GET /api/v1/runs` uses the same repo.
  - **Evidence.** `npx tsc --noEmit` ✅ · `npm run lint` ✅ (one pre-existing
    unrelated warning) · `npm run build` ✅ · `npm run test:integration` → 47
    tests pass (9 queue + 23 repositories + 15 AI/domain repositories) · `npm run
    test:coverage` → 7 files / 54 tests, gate green (96.96% stmts / 91.07% branch
    / 100% funcs). Re-verified 2026-10-02 on HEAD `deea08c` with all C2 work
    uncommitted.
  - **Follow-up landed (2026-10-03).** The feature-local read models were folded
    into the canonical per-table repositories and the two files deleted:
    `GmailPersistenceRepository` (mailbox upsert/find/cursors/watch + mirrored
    thread/message upserts) → `MailboxRepository`, `ThreadRepository`,
    `MessageRepository`; `EngineLookupRepository` (unscoped thread/mailbox/
    meeting reads) → `ThreadRepository.findById`/`findMailboxIdById`,
    `MailboxRepository.findEmailByIdForUser`, `MeetingRepository.findById`.
    Callers (`lib/gmail/{sync,watch}.ts`, `lib/email-operator/{cron,mailbox,
    handlers/inbound-email}.ts`, `lib/settings/autopilot{,-review}.ts`, four
    `lib/engine/steps/*`) and the domain integration suite were updated with no
    behaviour change. The invariant sweep still finds zero `drizzle-orm` imports
    / raw `db.*`/`pool.*` calls outside `lib/db`, `lib/repositories`,
    `lib/queue/queue.ts`.
- [x] **C3. Test pyramid** · `SKILL §14`, matrix #19
  - Add Vitest unit tests for service/domain logic; Testcontainers integration
    tests for repositories + route handlers; coverage gate (>80% services).
  - **Landed so far (unit + integration harness).**
    - `vitest.config.mts` — `tests/unit/**`, node env, Next `server-only`/
      `client-only` shims, `@` alias, `allowOnly: false`, v8 coverage with an
      **80% line/branch/function/statement gate** over the modules under test.
    - `vitest.integration.config.mts` — `tests/integration/**`, serialised.
    - `tests/setup.ts` — minimal non-secret env so `lib/env.ts` imports cleanly.
    - 54 unit tests across security (`constant-time`), observability (`redact` +
      emission/trace fields), `agent/action-hash` canonicalisation, guardrails
      (prompt injection), calendar (`parse-when`, `tz`) and follow-up rules.
    - 9 **Testcontainers** Postgres tests driving the real `job_queue` SQL:
      enqueue + event dedupe, claim/complete with `SKIP LOCKED`, global running
      cap, one-running-per-lane, backoff→dead-letter, reaper revival, next-job
      delay. Migrations are applied to the throwaway container.
    - 13 **Testcontainers** Postgres tests driving the new repositories:
      `pending_actions` owner-scoping + guarded claim/cancel/expiry,
      `scheduled_actions` claim/release, `research_cache` upsert/TTL,
      `threads` bucket `CASE` classification + tenant isolation,
      `messages` `DISTINCT ON` latest-per-thread, `drafts` suppressed filtering.
    - 10 more **Testcontainers** tests for the domain-service repositories:
      `bulk_recipients` `FOR UPDATE SKIP LOCKED` claim + stale-claim reset,
      suppression dedupe/tenant scoping, campaign status rollups,
      `commitments` resolve-by-thread and the nudge eligibility filter,
      `followup_enrollments` due list + stop-by-thread, `assets` content-hash
      upsert with alt-text preservation and soft-delete hiding, and
      `ai_usage_events` totals/per-feature rollups.
    - 15 **Testcontainers** tests (`tests/integration/ai-repositories.test.ts`)
      covering the C2 AI/domain repositories: `ai_cache` upsert + expiry sweep,
      `reply_memories` active/archive owner-scoping, knowledge entries +
      snippets CRUD, `assistant_settings` defaults + style upsert, automation
      rule ordering + executions, digest retention + item priority order,
      `agent_chat_threads` dedupe/archive/message touch, `sender_profiles`
      upsert/categorise/unsubscribe, unsubscribe audit, `threads` recent-with-
      state + prior-threads-by-sender, and `messages` sent samples / prior
      outbound / inbound counts / response-time window.
    - 23 **Testcontainers** tests (`tests/integration/domain-repositories.test.ts`,
      landed 2026-10-03) closing the remaining C2 repository gap: `users`,
      `onboarding` insert-if-absent + update, `agent_runs` owner probe + run
      update + compaction, autonomy precedence (`thread_settings` mailbox /
      contact / thread + delete), `thread_activity` cursor + batched tenant
      scope, `event_log` redelivery dedupe + processed, `contact_persistence`
      upsert refresh, inbound triage candidate selection, `google-account`
      id/scope lookup, Gmail `send_ledger` claim/status, calendar settings upsert
      + meeting owner-scoped cancel/reschedule + `(thread, proposal)` idempotency
      + proposal run-state, the engine repos (draft refresh, flow graph lookup,
      unscoped lookups, checkpoints + run finish, thread-state upsert), Gmail
      mailbox/thread/message idempotent mirroring + cursors, `meetings`
      window/count, and the activity read model (timezone, draft mix, JSONB tool
      usage).
    - `package.json`: `test:unit`, `test:unit:watch`, `test:coverage`,
      `test:integration`. CI runs unit+coverage and integration before the
      DB-backed smoke suite.
    - 10 **unit** tests (`tests/unit/api/pagination.test.ts`) for the C5 cursor
      codec (round-trip, scope/key/shape rejection), `parsePageLimit` clamping
      and `buildPage`; plus 4 **Testcontainers** keyset tests ("Cursor
      pagination (C5)") pinning the inbox `DESC NULLS FIRST` page order (no gaps
      or dupes) and the follow-up / agent-action / flow-run cursors.
  - **Complete (2026-10-03).** Route-handler integration tests landed
    (`tests/integration/route-handlers.test.ts`: C4 status codes, C5 cursors, C1
    enforcement, BOLA) and the coverage gate was widened to the new pure modules
    (`lib/db/errors.ts`, `lib/lifecycle.ts`, `lib/queue/worker.ts`,
    `lib/observability/{metrics,trace}.ts`). The repository gap is closed —
    every C2 repository family has Testcontainers coverage. Extending the
    *unit* gate to `lib/services` + `lib/*/service.ts` is intentionally **not**
    done: those are DB-backed and are exercised end-to-end by the route-handler
    + repository integration suites, which is stronger than mocked unit tests.
  - **Evidence (follow-up audit pass, 2026-10-03).** `npm run test:coverage` →
    21 files / 165 tests, gate green (95.58% stmts / 87.35% branch / 95.34%
    funcs) · `npm run test:integration` → 5 files / 86 tests against
    `postgres:16` · `npm test` → all smoke & eval phases pass · `npx tsc
    --noEmit` ✅ · `npm run lint` ✅ (one pre-existing unrelated warning) ·
    `npm run build` ✅.
- [x] **C4. Response semantics** · `SKILL §2.2–2.3`, matrix #2
  - POST → 201 + `Location`; PUT/DELETE → 204; semantic validation → 422;
    paginate empty lists → 200 `[]`.
  - **Landed.** New `created(data, { location })` (201 + `Location`) and
    `noContent()` (204) helpers in `lib/api/http.ts`; `ok()`/`okPage()` keep the
    `{ data }` envelope. Resource-creating POSTs now return 201 +
    `Location`: `settings/knowledge`, `settings/snippets`, `settings/rules`
    (both branches), `assets` (new row; a deduped re-upload stays 200),
    `campaigns` (both branches), `meetings`, `mail/drafts`, `mail/labels`, and
    legacy `ai/threads`. All **8** DELETE handlers now return 204:
    `settings/{knowledge,snippets,memories,senders,rules}/[id]`,
    `meetings/[id]`, `assets/[id]`, `ai/threads/[threadId]`. Semantic
    (domain-rule) failures now return 422: the two date-order checks
    (`meetings`, `meetings/[id]`), joining the existing 422s in
    `settings/rules` and `campaigns/[id]/actions`. RPC actions (confirm,
    cancel, approve, discard, pause, snooze, stop, fulfill, dismiss, sync,
    send, translate, unsubscribe, summaries/briefs) deliberately stay 200.
  - **Client audit.** Every DELETE caller checks `.ok` only and never parses the
    body, so 204 is safe; no client distinguishes 200 vs 201 on success (they
    gate on `response.ok` and read `payload.data`), so the 201s are safe too.
  - **Evidence.** `npx tsc --noEmit` ✅ · `npm run lint` ✅ (one pre-existing
    unrelated warning) · `npm run build` ✅.
- [x] **C5. Cursor pagination** · `SKILL §2.4`
  - Add opaque cursor pagination to large lists (inbox/followups/runs) alongside
    the existing `since`/`limit`; return `pagination.has_more/next_cursor`.
  - **Landed.** New client-safe `lib/api/pagination.ts`: opaque base64url
    cursors (`encodeCursor`/`decodeCursor`) tagged with a per-endpoint scope so
    a cursor cannot be replayed against another list; `parsePageLimit` (default
    50, max 100, clamped); `buildPage` (over-fetch `limit + 1` → trim →
    `has_more`/`next_cursor`). New `okPage(data, pagination)` returns
    `{ data, pagination }` — `data` keeps its existing resource shape, so
    clients that read `payload.data.items` etc. are unaffected.
  - **Endpoints.** `GET /api/v1/inbox` (keyset over the existing
    `priority DESC NULLS FIRST, lastMessageAt DESC, id` order),
    `GET /api/v1/followups` (`createdAt DESC, id`), `GET
    /api/v1/agent/actions` (`createdAt DESC, id`, status-filtered), and the new
    `GET /api/v1/runs` (`startedAt DESC, id`). Each repository gained an
    `after` keyset predicate: `ThreadRepository.listInbox`,
    `FollowupEnrollmentRepository.listForUserWithSubject`,
    `PendingActionRepository.listForUser`, new `FlowRunRepository.listForUser`.
    `since`/`limit` remain accepted on the inbox.
  - **NULLS-FIRST correctness.** The inbox cursor coalesces `priority` to a
    bigint sentinel and `lastMessageAt` to `'infinity'` so the tuple comparison
    `(priorityKey, lastMessageKey, id) < (…)` reproduces Postgres' default
    `DESC NULLS FIRST` exactly; an integration test pages a mixed null/non-null
    set and asserts order + no gaps/dupes.
  - **C2 gap fixed.** `app/runs/page.tsx` and `app/runs/[id]/page.tsx` still held
    raw Drizzle SQL (the line-oriented C2 grep missed the multi-line chain);
    both now use `FlowRunRepository`.
  - **Evidence.** `npm run test:coverage` → 12 files / 98 tests, gate green ·
    `npm run test:integration` → 4 files / 74 tests (9 queue + 27 repositories +
    15 AI + 23 domain), incl. the 4 keyset tests · `npx tsc --noEmit` ✅ ·
    `npm run lint` ✅ (one pre-existing unrelated warning) · `npm run build` ✅.
  - **Follow-up (optional, non-blocking).** The plan named
    inbox/followups/runs; other lists remain limit-bounded rather than
    cursor-paginated and could adopt the same `okPage` + keyset pattern:
    `commitments`, `campaigns`, `campaigns/suppression`, and the `settings/*`
    lists. The primitive and repository `after` pattern are already in place for
    a mechanical extension. **Meetings is no longer unbounded** (fourth pass):
    `GET /api/v1/meetings` now defaults to 200 and caps at 500 via an optional
    `?limit`, with the read bounded in `CalendarPersistenceRepository`.
- [x] **C6. CSP** · `SKILL §4.3`
  - Add a nonce-based `Content-Security-Policy` (test against the app shell,
    streaming chat, and inline styles). Report-only first.
  - **Landed (2026-10-03).** `lib/security/csp.ts` is the single, pure policy
    builder; `proxy.ts` mints a fresh per-request nonce and writes it to the
    request (`x-nonce` + a `Content-Security-Policy` header, which Next parses to
    stamp framework/inline scripts) and the response
    (`Content-Security-Policy-Report-Only` in `report` mode, or the enforcing
    header when `CSP_MODE=enforce`). `CSP_MODE` (`off|report|enforce`, default
    `enforce` since the follow-up pass) and
    `CSP_REPORT_URI` are registered in `lib/env.ts` + `.env.example`.
  - **Policy.** `script-src 'self' 'nonce-…' 'strict-dynamic' 'wasm-unsafe-eval'`
    (Rive compiles WASM), `style-src 'self'` + `style-src-elem 'self' 'nonce-…'`
    + `style-src-attr 'unsafe-inline'` (React `style={{…}}` attributes can never
    carry a nonce), `connect-src 'self'` plus
    the Vercel Blob origins the client uploads and `.riv` fetches use, `img-src`
    plus `*.googleusercontent.com` avatars, `worker-src 'self' blob:`,
    `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
    `frame-ancestors 'none'`. Dev adds `'unsafe-eval'` and `ws:`/`wss:`;
    `upgrade-insecure-requests` is production-only.
  - **Scope.** The statically-prerendered pages (`/`, `/terms`, `/privacy`; the
    matcher already excludes `/dev-profile`) cannot carry a per-request nonce, so
    they are deliberately skipped; every dynamic app page (authenticated shell,
    streaming chat, onboarding, `/auth`) gets the policy.
  - **Evidence.** Live dev server: `GET /auth` returns the enforcing
    `content-security-policy` header whose nonce matches every nonced
    `<script>` tag in the same response (re-verified 2026-10-03: 19 tags), while
    `GET /` and `/privacy` carry no CSP and `/api/health/live` is excluded.
    `npm run test:coverage` → 12 files /
    98 tests, gate green (95.3% stmts / 85.09% branch / 97.56% funcs) incl. a new
    `tests/unit/security/csp.test.ts` (8 tests, 100% on `csp.ts`) ·
    `npx tsc --noEmit` ✅ · `npm run lint` ✅ (one pre-existing unrelated
    warning) · `npm run build` ✅ (marketing routes still `○` static) ·
    `npm run openapi:check` ✅.
  - **Follow-up landed (2026-10-03).** The policy is now **enforcing by default**
    (`parseCspMode(undefined) === "enforce"`; `CSP_MODE=report|off` are the escape
    hatches) and `style-src` was split: `style-src-elem 'self' 'nonce-…'` (inline
    `<style>` must carry the per-request nonce) plus `style-src-attr
    'unsafe-inline'` (React `style={{…}}` attributes can never carry a nonce),
    with `style-src 'self'` as the CSP-level-2 fallback. The `/api/csp-report`
    collector stays wired as the `report-uri` sink for any residual report-only
    burn-in. `lib/env.ts`, `.env.example` and `tests/unit/security/csp.test.ts`
    updated.
  - **Caveats / remaining.** (1) `style-src-attr` keeps `'unsafe-inline'` — style
    *attributes* cannot be nonced, so per-attribute hashes would be required to
    remove it (low value; CSS attributes are a weak primitive). (2) The
    statically-prerendered marketing pages still carry no CSP (no per-request
    nonce); a hash-based policy for those static scripts is a separate
    follow-up. (3) Rollback is a single env var: `CSP_MODE=report`.

### Phase C handoff (next thread)

**Done.** **C2 is complete** — the entire application layer (`lib/*/service.ts`,
all feature/engine/adapter/agent/onboarding modules, and the four remaining
route handlers) is now SQL-free on an injectable `lib/repositories/*` layer
(**44 repositories**; 24 added by the non-service sweep). **C4 and C5 are also
complete**: resource POSTs return 201 + `Location`, all DELETEs return 204,
semantic failures return 422, and inbox/followups/agent-actions/runs are
cursor-paginated through `lib/api/pagination.ts` + `okPage`. **C1 is complete**:
a code-first Zod registry generates the committed `openapi.yaml` (127
operations), `withUser` enforces inbound query/params/body against it, and CI
gates drift + breaking changes. **C6 is complete**: a nonce-based CSP ships
report-only (default) from `proxy.ts`, with the statically-prerendered marketing
pages skipped. The last raw-SQL routes (`app/runs/*`) now use
`FlowRunRepository`. Verified by `tsc`, lint, `build`, 98 unit tests, and 74
integration tests (every C2 repository family now has Testcontainers coverage).
A repo-wide grep finds zero `drizzle-orm` imports / `db.*`
chains outside `lib/db`, `lib/repositories`, and the intentionally SQL-owning
`lib/queue`. See C1/C2/C3/C4/C5/C6 for the inventory and evidence.

**Working-tree caveat (refreshed 2026-10-03).** None of the C1–C6 work is
committed yet — HEAD is still `deea08c` (Phase B docs). It lives as uncommitted
changes in `lib/repositories/` (untracked), `lib/api/contracts/` (untracked),
`lib/api/openapi/` (untracked), `scripts/openapi/` (untracked), `openapi.yaml`
(untracked), `tests/` (untracked), the two `vitest*.config.mts` (untracked),
`lib/api/pagination.ts` (untracked), `lib/security/csp.ts` (untracked,
C6) + `tests/unit/security/csp.test.ts`, the migrated service/feature/route
modules (modified, including ~45 routes now importing their schemas from
`lib/api/contracts/*`), `proxy.ts` (C6), and the harness plumbing
(`package.json`/`package-lock.json` — added `yaml`, `eslint.config.mjs`,
`.github/workflows/ci.yml` — added drift + breaking steps, `lib/env.ts`,
`.env.example`). `git status` is the source of truth; do not treat `git log` as a
complete record of what exists. **Third pass (2026-10-03)** additionally modified
`lib/security/csp.ts`, `lib/api/contracts/registry.ts`, `lib/env.ts`,
`.env.example`, `tests/unit/security/csp.test.ts`, the canonical
`lib/repositories/{mailboxes,threads,messages,meetings}.ts`, 11 callers, and
`tests/integration/domain-repositories.test.ts`; it **deleted**
`lib/repositories/{engine-lookups,gmail-persistence}.ts` and added
`docs/changelog-entries/2026-10-03-production-hardening-followups.md`.

**Next up, in dependency order.** (Refreshed 2026-10-03, third pass — see
"Remaining-follow-up pass" below.)
1. **C6 hardening — DONE (2026-10-03).** The `/api/csp-report` collector exists;
   `CSP_MODE` now defaults to `enforce` and `style-src` is split into a
   nonce-bound `style-src-elem` + `style-src-attr 'unsafe-inline'`. Rollback is
   `CSP_MODE=report`. Remaining: static-page CSP via hashes; drop
   `style-src-attr 'unsafe-inline'` via per-attribute hashes (low value).
2. **C3 completion — DONE (2026-10-03).** `tests/integration/route-handlers.test.ts`
   adds 8 route-handler integration tests (C4 status codes, C5 cursors, C1
   enforcement, BOLA); the coverage gate was widened to the new pure modules
   (`lib/db/errors.ts`, `lib/lifecycle.ts`, `lib/queue/worker.ts`,
   `lib/observability/{metrics,trace}.ts`). Widening the *unit* gate to
   `lib/services` + `lib/*/service.ts` is intentionally **not** done: those are
   DB-backed and are already exercised end-to-end by the route-handler +
   repository integration suites, which is stronger than mocked unit tests.
3. **C2 follow-up — DONE (2026-10-03).** `engine-lookups.ts` and
   `gmail-persistence.ts` are folded into the canonical `threads` / `mailboxes` /
   `messages` / `meetings` repositories and deleted; callers + integration suite
   updated with no behaviour change.
4. **C1 follow-up — partially landed (2026-10-03).** `API_CONTRACT_VALIDATION`
   now defaults to `enforce` everywhere. Remaining optional: field-level
   *response* schemas (88 `z.unknown()` placeholders across
   `lib/api/contracts/*`), and routing the raw SSE/redirect handlers through
   `validateInbound` for uniformity (they already validate with the registry
   schemas inline).
5. **D3/D5 seams (optional, infra-gated).** Wiring `readDb` into repositories and
   adding an OTLP span exporter remain deliberate non-actions until a provisioned
   replica (+ lag telemetry) and a collector endpoint exist; both are documented
   in `docs/runbooks/scaling-and-connections.md` and the D5 caveats.

---

## Phase D — Scale

**Goal.** Decouple throughput from request lifecycle and gain deep visibility.
**Exit criteria:** async work runs in a dedicated worker, reads can scale
horizontally, and traces/metrics are exported.

- [x] **D1. Dedicated queue worker** · `SKILL §8.1`, matrix #14
  - Move `drainQueue` out of `after()`/request into a long-lived worker
    (container or scheduled high-frequency drain). Keep `job_queue` semantics.
  - **Landed (2026-10-03).** `lib/queue/worker.ts` is a pure, injectable loop
    (drain → full-batch immediate re-drain → sleep until `msUntilNextJob`, capped
    at 5s → 1s error backoff). `scripts/worker.ts` wires the real `drainQueue` +
    `msUntilNextJob(pool)` and `npm run worker` / the Docker `worker` target run
    it. Serverless still uses `after()` + `/api/v1/cron/drain`; both share the
    same `job_queue` primitives.
  - **Evidence.** 7 unit tests (`tests/unit/queue/worker.test.ts`); live boot
    against `postgres:16` drained a tick then exited 0 on SIGTERM.

- [x] **D2. Graceful shutdown + worker readiness** · `SKILL §5.3`, matrix #9
  - SIGTERM/SIGINT trap → ready=false → `server.close()` → drain in-flight →
    stop workers → close pool in reverse order, within a timeout.
  - **Landed.** `lib/lifecycle.ts` holds the process-wide draining flag;
    `/api/health/ready` returns `530 { reason: "shutting_down" }` once set. The
    worker traps SIGTERM/SIGINT, stops claiming, awaits the in-flight drain
    (bounded by `WORKER_SHUTDOWN_TIMEOUT_MS`, default 30s), closes the primary +
    replica pools via `closeDatabasePools()`, and exits 0.
  - **Evidence.** 3 unit tests (`tests/unit/lifecycle.test.ts`); end-to-end
    `WORKER_EXIT=0` with `worker.shutdown_started` → `worker.shutdown_complete`.

- [~] **D3. Read replicas** · `SKILL §6.3`
  - Route SELECTs to a replica; handle replication lag explicitly.
  - **Landed as an opt-in seam.** `DATABASE_REPLICA_URL` (env + `.env.example`)
    makes `lib/db` export `readDb`/`readPool`; when unset they alias the primary,
    so there is zero behaviour change. Repositories already take an injectable
    `Database`, so a read-only repository is switched by constructing it with
    `readDb`. `docs/runbooks/scaling-and-connections.md` names the safe
    candidates and the read-your-writes exclusions. Deliberately **not** wired
    into any repository by default: without a provisioned replica and lag
    telemetry, silently splitting reads is a correctness risk. This is the
    documented adoption path, not a fleet-wide switch.

- [x] **D4. PgBouncer / Supavisor** · `SKILL §6.3`, matrix #12
  - Transaction-pooling proxy in front of Postgres; revisit pool sizes.
  - **Landed (config + docs).** The pooled endpoint is mandatory (B4) and
    `docs/runbooks/scaling-and-connections.md` records the per-instance sizing
    table and the transaction-pooling compatibility audit (`pg_advisory_xact_lock`
    and `FOR UPDATE SKIP LOCKED` are transaction-scoped, so a transaction pooler
    is safe; no session-scoped state is used). No code change is required to
    operate a pooler.

- [~] **D5. OpenTelemetry + RED/USE metrics** · `SKILL §13.1`, matrix #18
  - `traceparent` propagation, spans for HTTP/DB/Redis/outbound, Prometheus RED
    histograms (p50/p95/p99) and USE gauges.
  - **Landed (RED + propagation).** `lib/observability/metrics.ts` is a
    dependency-free counter/histogram/gauge registry rendered as Prometheus text
    from the bearer-gated `GET /api/health/metrics` (`METRICS_TOKEN`; 404 when
    unset). `withUser` records `http_requests_total{method,route,status}` and
    `http_request_duration_seconds` with the bounded contract path template, and
    parses a W3C `traceparent` into the request context so every log line carries
    the upstream `trace_id` (`lib/observability/trace.ts`).
  - **Caveat / follow-up.** Full OpenTelemetry *span export* (DB/Redis/outbound
    child spans, OTLP collector) is not added — it needs the OTel SDK and a
    collector endpoint, which is an infra decision. The RED histograms +
    `traceparent` propagation are the useful 80% and are live now.

- [x] **D6. Multi-stage, non-root Dockerfile** · `SKILL §15.1`, matrix #20
  - Distroless/scratch runtime, pinned digests, `.dockerignore`.
  - **Landed.** `Dockerfile` has `deps` → `builder` (build-arg public origin +
    non-secret placeholders so `next build` validates `lib/env.ts`) → `runner`
    (Next `standalone`, `USER nextjs` uid 1001, liveness `HEALTHCHECK`) and a
    `worker` target. `.dockerignore` excludes secrets/build output. CI builds
    both targets.
  - **Evidence.** `docker build --target runner` and `--target worker` both
    succeed; the runner image runs as `uid=1001(nextjs)` and answers
    `/api/health/live` → `200 {"status":"ok"}`.

- [ ] **D7. Sharding / partitioning** · `SKILL §6.3`
  - Only when a table > ~100M rows; partition by tenant/hash.
  - **Not applicable.** No table is near the threshold; the trigger condition is
    documented. Adding partitioning now would be speculative complexity.

- [ ] **D8. Transactional outbox for outbound webhooks** · `SKILL §10.2`
  - Only if/when outbound webhooks are added; write events in the same tx as the
    mutation, dispatch via worker, sign with HMAC + timestamp.
  - **Not applicable.** There are no outbound webhooks (inbound only), so the
    pattern has no producer. The queue (D1) is the dispatch mechanism to reuse
    when one is added.

**Phase D verification (all green, 2026-10-03).** `npx tsc --noEmit` ✅ ·
`npm run lint` ✅ (one pre-existing unrelated warning) · `npm run test:coverage`
→ **21 files / 165 tests** (95.58% stmts / 87.35% branch / 95.34% funcs) ·
`npm run test:integration` → **5 files / 82 tests** · `npm test` → **all smoke &
eval phases pass** (Phase 7 sync-independence + agent evals were red before the
audit fixes below) · `npm run build` ✅ (`.next/standalone/server.js` emitted) ·
`npm run openapi:check` ✅ · Docker `runner` + `worker` targets build and run.

**Phase D caveats.**
1. D3 is a seam, not a fleet-wide read split: adopt per-repository after
   confirming lag tolerance.
2. D5 exports per-instance metrics; on serverless each instance is scraped
   independently (or use a sidecar). No OTel span exporter yet.
3. The Docker `worker` target intentionally keeps dev tooling (`tsx` + the
   `server-only` shim) because the worker entrypoint is TypeScript; the `runner`
   target stays minimal.

### Audit findings fixed this session (2026-10-03)

These were surfaced by the new tests / the Docker build, not by the original
plan — they are the "audit" half of the work.

| Sev | Finding | Fix |
|-----|---------|-----|
| **P0** | `package-lock.json` was generated by npm 11 and **`npm ci` failed under npm 10** (CI's Node 20 and the Node 22 image) — CI and every Docker build would fail at install. | Regenerated the lockfile with npm 10.9.9 (`npx npm@10 install --package-lock-only`); verified `npm ci` locally and `npm ci --dry-run` under `node:22`. Bumped CI to Node 22. |
| **P1** | Duplicate `knowledge_entries` / `snippets` returned **500**, not 409: the routes checked `error.code` on Drizzle's wrapper instead of the wrapped `pg` error. | Added `lib/db/errors.ts` (`hasPgCode`/`isUniqueViolation`/`isForeignKeyViolation`) that walks the `cause` chain; both routes now use it. Pinned by a route-handler test. |
| P2 | Contract runtime validation covered the `withUser` registry but the committed `openapi.yaml` is generated from every route; adding one route without regenerating drifts the spec. | `npm run openapi:generate` (the new `/api/health/metrics` route); `openapi:check` is green. CI already gates this. |
| **P1** | `npm test` (CI-gated smoke/eval suite) failed at **Agent Phase 7**: `lib/inbox/service.ts` statically imported Gmail/queue/engine/drain, so the `/assistant` server render reached them via `lib/briefing/service.ts`, breaking the sync-independence guard. | Made those imports **dynamic inside the functions that use them** (`sendEmail`, `seedDefaultFlows`/`runFlow`, `enqueueJob`/`kickDrain`, calendar booking reads). The `/assistant` graph dropped from 155 → 63 modules with zero forbidden hits; Phase 7 passes. |
| **P1** | `npm test` also failed at **agent evals**: the four new autopilot tools were not mapped to a progressive-disclosure group ("every registered tool is mapped to a group"). | Added an `autopilot` group + mappings in `lib/agent/tool-groups.ts` (`get_overnight_summary`, `explain_autopilot_decision`, `set_autopilot_policy`, `pause_autopilot`). Evals pass. |

### Follow-up audit pass — hardening loop (2026-10-03, second thread)

The plan was re-run top to bottom on a fresh checkout of the working tree
(HEAD `deea08c`, 195 modified/untracked paths). Every gate was re-executed and
the self-reported status was verified against the code rather than trusted.
Three real regressions and one drift risk were found and fixed.

| Sev | Finding | Fix |
|-----|---------|-----|
| **P1** | The C2 invariant did **not** hold as written: the newer, untracked `lib/email-operator/reconcile.ts` imported `drizzle-orm` and ran raw `db.execute` + `pool.query`, and `lib/email-operator/retention.ts` ran raw multi-line `pool.query` (the line-oriented grep in the plan missed it). | Moved the queries behind repositories: `DraftRepository.listAiSentWithoutMirror` / `listStalePending`, `EventLogRepository.deleteBefore`, `SendLedgerRepository.deleteBefore`, and a new `countDeadJobs` in the SQL-owning `lib/queue/queue.ts`. `reconcile.ts` / `retention.ts` now orchestrate only. |
| **P3** | `app/api/health/ready/route.ts` called `pool.query("select 1")` directly, so `pool.query` still lived outside the allowed modules. | Added `pingDatabase()` to `lib/db/index.ts`; the probe now calls it. `pool.query`/`pool.execute` and `drizzle-orm` imports now appear **only** under `lib/db/**`, `lib/repositories/**`, `lib/queue/queue.ts` — verified with a multiline ripgrep sweep. |
| **P3** | Legacy raw handlers re-declared Zod schemas that duplicated `lib/api/contracts/legacy.ts` (e.g. `onboarding/advance` had a byte-for-byte copy), so runtime validation could silently drift from the committed spec. | The eight body-parsing handlers (`ai/assistant`, `ai/chat`, `ai/threads`, `ai/threads/[threadId]`, `ai/threads/[threadId]/messages`, `onboarding/calendar`, `onboarding/workspace-setup-chat`, `onboarding/advance`) now import their schema from the registry. |
| **P2** | Because they bypass `withUser`, **none** of the legacy raw handlers were rate-limited — including the model-backed SSE routes (`/api/ai/assistant`, `/api/ai/chat`, `/api/ai/threads/[threadId]/messages`, `/api/onboarding/workspace-setup-chat`): an authenticated user had an unthrottled path to the paid models. | Added `enforceUserRateLimit()` to `lib/api/http.ts` (fail-open, same envelope/`Retry-After` as `withUser`). Applied to every authenticated legacy handler: the four model-backed routes use the stricter `agentRateLimitPerMin()` bucket (`scope: "ai"`); the rest use the default API ceiling (`scope: "legacy"`). The OAuth redirect landing (`/onboarding/sync-email/complete`) is deliberately left unlimited — a 429 there would strand a real sign-in. |
| **P3** | Plan drift: the committed spec is now **127 operations** (not the 119 recorded in C1). | This tracker updated; `openapi:check` remains the enforcement point. |

**Regression tests added.** `tests/integration/repositories.test.ts` now drives
both reconcile queries (AI send with no near mirror is flagged; a human send is
not; a pending draft with newer inbound mail is flagged; cross-tenant reads are
empty). `tests/integration/domain-repositories.test.ts` covers
`EventLogRepository.deleteBefore` and `SendLedgerRepository.deleteBefore`
(only rows past the cutoff are deleted). `tests/integration/queue.test.ts`
covers `countDeadJobs` (owner-scoped). Integration suite grew 82 → 86 tests.

**Re-verified this pass.** `npx tsc --noEmit` ✅ · `npm run lint` ✅ (one
pre-existing unrelated warning in `components/evilcharts`) · `npm run
test:coverage` → **21 files / 165 tests**, gate green (95.58% stmts / 87.35%
branch / 95.34% funcs) · `npm run test:integration` → **5 files / 86 tests**
against `postgres:16` · `npm run build` ✅ · `npm run openapi:check` ✅ (in
sync) · `npm run openapi:breaking --base openapi.yaml --head openapi.yaml` ✅ ·
`npm test` → **all smoke & eval phases pass** (onboarding, AI chat,
email-operator incl. autopilot, agent phases 1–7, evals; exit 0) · invariant
sweep: zero `drizzle-orm` imports and zero raw `db.*`/`pool.*` query calls
outside `lib/db`, `lib/repositories`, `lib/queue/queue.ts`. The only remaining
`Math.random` is the jittered backoff sleep in `lib/ai/cache.ts` (not a
persisted id), which is within the B3 acceptance.

### Remaining-follow-up pass (2026-10-03, third thread)

"Carry the plan forward" = execute the four optional follow-ups listed under
"Next up" rather than leave them as prose. All code changes are working-tree only
(HEAD is still `deea08c`).

| Item | Change | Files |
|------|--------|-------|
| **C6** | Policy is now **enforcing by default** (`parseCspMode(undefined) → "enforce"`; `report`/`off` remain env escape hatches). `style-src 'self' 'unsafe-inline'` split into `style-src 'self'` (level-2 fallback) + `style-src-elem 'self' 'nonce-…'` + `style-src-attr 'unsafe-inline'`. | `lib/security/csp.ts`, `tests/unit/security/csp.test.ts`, `lib/env.ts`, `.env.example` |
| **C1** | `API_CONTRACT_VALIDATION` defaults to **`enforce`** everywhere (was `warn` in production). | `lib/api/contracts/registry.ts`, `lib/env.ts`, `.env.example` |
| **C2** | Deleted `lib/repositories/engine-lookups.ts` + `lib/repositories/gmail-persistence.ts`; folded their methods into the canonical per-table repos (`mailboxes` +11 methods, `threads` +4, `messages` +1, `meetings` +1). Updated 11 callers + the domain integration suite. | `lib/repositories/{mailboxes,threads,messages,meetings}.ts`, `lib/gmail/{sync,watch}.ts`, `lib/email-operator/{cron,mailbox,handlers/inbound-email}.ts`, `lib/settings/autopilot{,-review}.ts`, `lib/engine/steps/{egress,sender-intel,send-email,send-invite}.ts`, `tests/integration/domain-repositories.test.ts` |

**Deliberately not done (with reasons).** (1) C1 field-level *response* schemas
(88 `z.unknown()` placeholders) — a large, purely-documentation change; the
envelope-level typing is sufficient for the runtime contract and the spec
generator, and response schemas do not gate requests. (2) Routing the raw
SSE/redirect handlers through `validateInbound` — they already validate with the
same registry schemas inline; the seam would be cosmetic. (3) D3 read-replica
wiring and D5 OTLP span export — both are infra-gated (a provisioned replica +
lag telemetry; a collector endpoint) and wiring them blind is a correctness
risk, exactly as the D3/D5 caveats record. (4) Dropping
`style-src-attr 'unsafe-inline'` — style *attributes* cannot be nonced and
per-attribute hashes are impractical for React inline styles.

**Verification (third pass).** `npx tsc --noEmit` ✅ · `npm run lint` ✅ (one
pre-existing unrelated warning in `components/evilcharts`) · `npm run
test:coverage` → **21 files / 165 tests**, gate green · `npm run
test:integration` → **5 files / 86 tests** against `postgres:16` (incl. the
renamed `Thread/Mailbox/Meeting repositories serve unscoped engine lookups` and
`Mailbox/Thread/Message repositories (Gmail mirror)` cases) · `npm run build` ✅ ·
`npm run openapi:check` ✅ (in sync) · invariant sweep: zero `drizzle-orm`
imports and zero raw `db.*`/`pool.*` calls outside `lib/db`, `lib/repositories`,
`lib/queue/queue.ts`.

### Security hardening pass (2026-10-03, fourth thread)

"Apply all the hardening that is applicable now" = the plan was re-audited top
to bottom for gaps it did **not** already cover, rather than re-doing landed
work. Three real, code-only gaps were found and closed. All changes are
working-tree only (HEAD is still `deea08c`).

| Sev | Finding | Fix |
|-----|---------|-----|
| **P1** | **SSRF on user/attacker-influenced outbound URLs.** `open_web_page` fetches a URL the model picks from untrusted email content, and one-click unsubscribe `POST`s to the `List-Unsubscribe` URL from an inbound header. Neither blocked loopback/private/link-local/cloud-metadata addresses, so prompt injection or a crafted email could make the server reach internal services. | New `lib/security/ssrf.ts` (`assertSafeOutboundUrl` + `isPrivateAddress`/`isBlockedHostname`): rejects non-http(s), reserved hostnames, private/reserved IPv4 **and** IPv6 (incl. obfuscated IPv4 that the WHATWG URL parser normalizes and IPv4-mapped `::ffff:`), and DNS-resolves public hostnames to check every returned address. Wired into `Tavily.fetchPage`, `ResearchService.openWebPage` (blocked → clean `400`), and `Unsubscribe.sendOneClick` (blocked → recorded `failed`). |
| **P2** | **Unbounded outbound calls.** The Calendar REST transport, the Google JWKS fetch in the Pub/Sub verifier, and the server-side S3 control calls had no timeout — a hung socket could stall a request or the webhook. | `lib/calendar/client.ts` (`CALENDAR_REQUEST_TIMEOUT_MS`, 20s, matching Gmail), `lib/gmail/pubsub.ts` (`JWKS_TIMEOUT_MS`, 10s), `lib/assets/storage.ts` (`S3_REQUEST_TIMEOUT_MS`, 30s) now pass `AbortSignal.timeout(...)`. |
| **P3** | **Unbounded meetings read.** `GET /api/v1/meetings` returned every meeting for the user with no `LIMIT` (the one list the C5 follow-up flagged). | `CalendarPersistenceRepository.listMeetingsForUser(userId, limit)` now `.limit(limit)`; `GET` defaults to 200, caps at 500, accepts `?limit`; the contract gains `meetingsListQuery`. Response shape unchanged. |

**Deliberately still not done (with reasons).** (1) C1 field-level *response*
schemas (88 `z.unknown()` placeholders) — documentation-only; the envelope-level
typing gates runtime validation and the spec generator, and response schemas do
not gate requests. (2) Routing the raw SSE/redirect handlers through
`validateInbound` — they already validate with the same registry schemas inline;
the seam is cosmetic. (3) D3 read-replica wiring and D5 OTLP span export — both
infra-gated (a provisioned replica + lag telemetry; a collector endpoint).
(4) Static-page CSP hashes and dropping `style-src-attr 'unsafe-inline'` — the
former is a separate nonce-less rendering problem, the latter is impractical for
React inline style attributes.

**Regression tests added.** `tests/unit/security/ssrf.test.ts` (12 tests):
private/reserved IPv4 + IPv6 ranges, reserved hostnames, scheme rejection,
obfuscated and bracketed-IPv6 literals, and DNS-resolved public/private/
unresolvable hostnames.

**Verification (fourth pass).** `npx tsc --noEmit` ✅ · `npm run lint` ✅ (one
pre-existing unrelated warning in `components/evilcharts`) · `npm run
test:coverage` → **22 files / 177 tests**, gate green (94.9% stmts / 85.98%
branch / 95.71% funcs; `ssrf.ts` 90.62% stmts) · `npm run test:integration` →
**5 files / 86 tests** against `postgres:16` · `npm run build` ✅ ·
`npm run openapi:check` ✅ (regenerated for the `meetingsListQuery`).

---

## 3. Risk register (current)

| Sev | Risk | Where | Phase |
|-----|------|-------|-------|
| P0 | No structured observability / probe | (was everywhere) | A ✅ |
| P0 | No CI gate | `.github/` | A ✅ |
| P0 | Near-zero rate limiting | `lib/api/http.ts` | A ✅ |
| P0 | Lockfile not installable by npm 10 (`npm ci` fails in CI/Docker) | `package-lock.json` | Audit ✅ |
| P1 | Server-buffered uploads + public bucket | `assets/route.ts`, `storage.ts` | B1 ✅ |
| P1 | Non-constant-time cron secret | `cron-auth.ts` | B2 ✅ |
| P1 | `Math.random` queue ids | `queue.ts` | B3 ✅ |
| P1 | Pool fan-out / no global cap | `db/index.ts` | B4 ✅ |
| P1 | SSE per-client DB polling | `agent/events/route.ts` | B6 ✅ |
| P1 | Duplicate unique keys surfaced as 500 (Drizzle-wrapped error) | knowledge/snippets routes | Audit ✅ |
| P2 | No OpenAPI contract | (was repo root) | C1 ✅ |
| P2 | SQL outside repositories | (was AI/engine/email-operator/gmail/calendar/settings/agent/onboarding + 4 routes) | C2 ✅ |
| P2 | Unbounded list reads (no pagination) | inbox/followups/agent-actions/runs | C5 ✅ |
| P2 | Inconsistent POST/DELETE status codes | mixed route groups | C4 ✅ |
| P2 | No unit/integration pyramid | `scripts/` only | C3 ✅ |
| P2 | Inconsistent error envelope | mixed route groups | B8 ✅ |
| P2 | No Content-Security-Policy (XSS surface) | `proxy.ts` | C6 ✅ |
| P2 | No tracing/metrics | — | D5 ✅ (RED + propagation) |
| P2 | No worker / graceful shutdown | — | D1/D2 ✅ |
| P2 | No container image | — | D6 ✅ |
| P1 | SSRF on model/email-influenced outbound URLs (`open_web_page`, one-click unsubscribe) | `lib/security/ssrf.ts` | Fourth pass ✅ |
| P2 | Unbounded outbound calls (Calendar, JWKS, S3 control) | `lib/calendar/client.ts`, `lib/gmail/pubsub.ts`, `lib/assets/storage.ts` | Fourth pass ✅ |
| P3 | Unbounded meetings list read | `app/api/v1/meetings`, `calendar-persistence` | Fourth pass ✅ |
| P3 | Read replicas not split | `lib/db` | D3 (seam) |

---

## 4. How to update this file

1. Do a task, then flip `[ ]`→`[x]` and paste the **acceptance evidence**
   (command + result) under it.
2. If scope changes, edit the phase exit criteria first, then the task list.
3. Re-run the full matrix (`SKILL §16`) at the end of each phase and update §1.
4. Keep the exact file paths current — they are the handoff contract between
   threads.
