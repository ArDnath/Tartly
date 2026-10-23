# Agent Runtime — Architecture, Audit & Phase Plan

Status: **Brief Phases 1–12 are implemented and tested.** The `pending_actions`
confirmation subsystem and side effects (`send_email` / `reply_to_email` /
`forward_email` / `delete_email` / `schedule_email`) are shipped. Phase 6b
(destructive/scheduled/contacts), Phase 9 (research), Phase 10 (workflows,
tasks, evals), Phase 11 (sync-independence regression) and Phase 12 (realtime
SSE) are done; the research provider is adapter-gated on `SEARCH_API_KEY`, and
pgvector/memories remain deliberately deferred until keyword search is proven
insufficient.
Owner: `efforts/app-server`
Audience: whoever continues this work (human or agent). **This file is the source of
truth for the interactive agent runtime.** When code and this doc disagree, fix one of
them in the same change.

> **Read this with the rest of the repo in mind.**
> `PLAN-email-operator.md`, `docs/plans/mail-client-and-gmail-sync.md` and
> `docs/plans/tartly-whatsapp-email-infra.md` describe the **background automation
> engine** (webhook → durable queue → flow engine) and the mail client. This document
> describes the **interactive agent runtime** — the chat-driven, bounded, cancellable
> agent that operates the mailbox through typed tools. They are different subsystems
> and must not be conflated.

---

## 0. TL;DR

- **Goal.** The chat surface becomes an operating layer for the mailbox. The user asks
  in natural language; the agent calls typed, authorized tools. Eventually it can do
  anything email-related: search, read, thread, summarize, draft, rewrite, reply,
  forward, send, archive, delete, label, find contacts, research people/companies,
  schedule, detect follow-ups, extract tasks, and eventually run autonomous workflows.
- **Canonical flow.**
  `User → Chat UI → POST /api/v1/agent/chat → Agent Runtime → Tool Registry →
  Application Services → Integrations / DB`.
- **Never.** `User → LLM → arbitrary DB`. The model never selects identity, never
  decides authorization, never executes SQL, never holds provider keys. The browser
  never talks to the model provider.
- **What already exists (verified in code).** Auth, Postgres + Drizzle, AI SDK v7,
  a continuous agent turn (`streamAgentTurn`: keeps working until done, bounded by
  `resolveAgentBudget`, auto-resumed after a confirmation) with a deterministic
  permission engine, READ tools, reversible
  WRITE tools, destructive/scheduled side effects (`delete_email`, `schedule_email`),
  contact and web-research tools, over a provider-agnostic `EmailService`/`EmailProvider`
  seam, persistent conversations, persistent message parts (including hidden continuity
  notes), typed tool-result cards,
  per-run observability, a durable at-most-once send ledger, a Postgres-backed
  scheduled-send worker, and an SSE realtime stream for action updates.
- **What is missing to reach the target.** pgvector/memories (only if keyword search
  proves insufficient), and richer live-model eval coverage. Everything else in the
  brief's 12 phases is implemented.
- **Where to start next.** Optional hardening: measure keyword-search quality before
  reaching for embeddings, extend the eval corpus, and add per-tool read rate limits.

---

## 1. Non-negotiable invariants

These must remain true after every phase. Each has an owning module in code. This table
is the contract; §20 traces every requirement from the original brief to its enforcement.

| # | Invariant | Enforced in |
|---|-----------|-------------|
| 1 | Model never controls authorization | `lib/agent/permissions.ts` |
| 2 | Model never chooses user identity | `lib/agent/context.ts` (built from session) |
| 3 | Model never touches the DB directly | tools go through services/providers only |
| 4 | External side effects need app-level permission | `decideToolPermission` |
| 5 | Sending an email is idempotent | `send_ledger` + `lib/gmail/send.ts` |
| 6 | Destructive ops are confirmation-aware | `pending_actions` (Phase 5) |
| 7 | Email content is untrusted data | system prompt + tool-result labelling + `lib/guardrails/injection.ts` |
| 8 | Agent loops are bounded | `resolveAgentBudget()` in `lib/agent/loop.ts` (per-segment + total step caps) |
| 9 | External calls have timeouts | per-tool timeout + `GMAIL_REQUEST_TIMEOUT_MS` |
| 10 | DB mutations are transactional where needed | `lib/queue/queue.ts`, atomic conditional updates |
| 11 | Every user resource is scoped by the authenticated user | services/repositories (`(userId, …)` signatures) |
| 12 | Provider credentials never reach the client | `server-only` modules + `lib/env.ts` |
| 13 | The frontend never decides authorization | server returns decisions; UI only renders |
| 14 | Tool arguments are schema-validated | `inputSchema.safeParse` in the loop |
| 15 | Tool failures are recoverable | `ToolExecutionError` returned to the model |

---

# PART I — REPOSITORY AUDIT (the required first task)

The brief required inspecting the repository before proposing changes: current
architecture, dependencies, auth, database, chat, email, API structure, state
management, environment, and integration points. That is this part.

## 2. Repository map

```
app-server/
├─ app/
│  ├─ api/
│  │  ├─ ai/                      # assistant surfaces (2 of them) + thread CRUD
│  │  ├─ auth/[...all]/           # Better Auth handler
│  │  ├─ onboarding/              # onboarding state machine endpoints
│  │  ├─ v1/agent/chat/           # ★ the agent runtime entry point
│  │  ├─ v1/mail/                 # live Gmail mail-client API
│  │  ├─ v1/inbox/                # mirror-backed triage inbox API
│  │  ├─ v1/drafts|followups|meetings|metrics|runs|settings/
│  │  ├─ v1/cron/{daily,drain,followups}/
│  │  └─ webhooks/gmail/          # Pub/Sub push
│  ├─ assistant/                  # ★ primary agent chat screen
│  ├─ inbox/, mail/, calendar/, followups/, metrics/, runs/, settings/, onboarding/, auth/
│  └─ layout.tsx, globals.css
├─ components/
│  ├─ ai-elements/**              # vendored AI Elements (excluded from tsc)
│  ├─ ai-chat/**                  # shared chat provider + composer + message list
│  ├─ assistant/**                # ★ AgentChat + route rails + modal
│  ├─ app-shell/**                # nav, sidebar, command palette
│  ├─ mail/**, inbox/**, calendar/**, followups/**, settings/**, onboarding/**
│  └─ ui/**                       # shadcn primitives
├─ lib/
│  ├─ agent/                      # ★ agent runtime (context, loop, registry, permissions…)
│  │  └─ tools/                   # ★ READ tools
│  ├─ ai/                         # provider abstraction, budget, structured gen, chat service
│  ├─ services/                   # ★ EmailService (application service)
│  ├─ providers/email/            # ★ EmailProvider contract + Gmail adapter
│  ├─ mail/                       # live Gmail mail-client service + client + formatting
│  ├─ gmail/                      # OAuth authed transport, MIME, parse, send, sync, watch
│  ├─ engine/, queue/, email-operator/   # background automation engine (separate subsystem)
│  ├─ calendar/, followup/, inbox/, settings/, onboarding/, guardrails/
│  ├─ db/                         # Drizzle client + schema + migrate
│  └─ auth.ts, session.ts, env.ts, redis.ts, api/http.ts
├─ drizzle/                       # 11 migrations (0000–0010) + snapshots
├─ scripts/                       # test harnesses (onboarding, ai-chat, agent, email-operator)
└─ docs/plans/                    # this doc + sibling plans
```

`★` marks the agent-runtime subsystem this document owns.

## 3. Current architecture

There are **three** email/data subsystems plus the agent runtime. Know which one you
are touching before changing anything.

1. **Live Gmail mail client** — `lib/mail/service.ts`, `lib/gmail/{client,parse,mime}.ts`.
   Gmail is canonical and reads are pass-through. Backs `/mail`. **This is what the
   agent reads through** via `GmailEmailProvider` → `EmailService`.
2. **Mirror + automation engine** — `lib/gmail/sync.ts`, `lib/engine/**`, `lib/queue/**`,
   `lib/email-operator/**`, `lib/calendar/**`, `lib/followup/**`. A Postgres mirror plus
   a durable queue and a flow engine. Backs `/inbox`, meetings, follow-ups.
   **Not used for interactive agent reads** (it can lag or be empty).
3. **Agent runtime** — `lib/agent/**`, `lib/services/email-service.ts`,
   `lib/providers/email/**`, `app/api/v1/agent/*`, `app/assistant/*`,
   `components/assistant/*`. Interactive, bounded, cancellable, streamed.
4. **Two legacy assistant slices** — the route-scoped `AssistantRail`
   (`/api/ai/assistant`, snapshot Q&A, no tools, not persisted) and the
   workspace-setup chat (`/api/ai/chat`, onboarding only). Neither is the agent.

```
Browser
  └─ /assistant  (useChat + AI Elements + AbortController)
       │  AI SDK UI message stream
       ▼
POST /api/v1/agent/chat          authenticate → validate → resolve conversation
       ▼
Agent Runtime  (lib/agent/loop.ts, continuous + bounded by resolveAgentBudget)
  ├─ AIModelProvider.getLanguageModel(role)        lib/ai/model-provider.ts
  ├─ ToolRegistry.get/list                          lib/agent/registry.ts
  ├─ PermissionEngine.decide(ctx, tool)             lib/agent/permissions.ts
  ├─ READ / WRITE            → validate → authorize → execute (with timeout)
  └─ EXTERNAL_SIDE_EFFECT    → (Phase 5) persist pending_action → CONFIRMATION_REQUIRED
       ▼
Application Services  (lib/services/*)
       ▼
Repositories (Drizzle)          Integrations (lib/providers/email/*, lib/research/*)
```

Invariant: the LLM's output is **always untrusted input** to the runtime. It never
selects identity, permissions, or DB access.

## 4. Existing dependencies (and why they are here)

| Dependency | Present | Why | Keep? |
|---|---|---|---|
| `next@16.3.5` (App Router) | ✅ | framework; `proxy.ts` route guard | yes |
| `react@19.2.8` / `react-dom` | ✅ | UI | yes |
| `typescript@5` strict | ✅ | type safety | yes |
| `tailwindcss@4` | ✅ | styling | yes |
| `drizzle-orm@0.45` + `drizzle-kit` + `pg` | ✅ | Postgres ORM + migrations | yes |
| `better-auth@1.7` | ✅ | Google OAuth, sessions | yes |
| `ai@7` + `@ai-sdk/react@4` + `@ai-sdk/openai-compatible` | ✅ | agent loop, UI message stream, gateway | yes |
| `zod@4` | ✅ | tool schemas + env + routes | yes |
| `@upstash/redis` | ✅ | Better Auth secondary storage, send rate-limit, AI budget | justified, not a queue |
| `zustand@5` | ✅ | mail client optimistic store | yes |
| `nanoid@6` | ✅ | id generation | yes |
| `@base-ui/react`, `lucide-react`, `motion`, `cmdk`, `streamdown`, `shiki`, `tokenlens`, etc. | ✅ | UI primitives / AI Elements | yes |
| Redis-as-queue / Kafka / Temporal / Qdrant / Elastic | ❌ | **deliberately absent.** Postgres is the queue and the source of truth | keep absent |

**Rule:** before adding a dependency, explain the reason and prefer the boring option.

## 5. Authentication

`better-auth` with **Google OAuth only** (`lib/auth.ts`).

- Storage model: PostgreSQL is the source of truth; Redis is a best-effort
  `secondaryStorage` speed layer; a short-lived JWE cookie cache (5 min) means most
  requests validate with no network hop.
- Session mirroring: `storeSessionInDatabase: true`, `preserveSessionInDatabase: false`
  so a Redis outage degrades to a DB read instead of logging everyone out, while
  revoked sessions stay revoked.
- `account.storeAccountCookie: true` + `allowDifferentEmails: true` so the onboarding
  "sync your inbox" step can link a *different* Google account; the existing-account
  owner check still prevents two users sharing one Google account.
- Server helpers: `lib/session.ts` (`getSession`, React-`cache`d; `requireSession`
  redirects), `lib/api/http.ts` (`withUser` — resolves `userId` from the session,
  never from the body), `lib/mail/route.ts` (`withMailUser` — same plus Gmail error
  mapping: revoked grant → 403 "reconnect").
- `proxy.ts` is an **optimistic cookie-only** page guard; authoritative validation
  happens per page/route. API routes guard themselves and answer JSON, not redirects.
- Go to market scope: onboarding gates on `onboarding_state.status === "COMPLETED"`.

**Implication for the runtime:** identity is already solved. The agent route uses
`withUser`, and `AgentContext.userId` is derived server-side. **Never** add a
`userId` field to a request body.

## 6. Database

Postgres + Drizzle. Schema lives in `lib/db/schema.ts`; migrations in `drizzle/`
(11 applied: `0000`–`0010`); apply with `npm run db:migrate`; generate with
`npm run db:generate`. Client in `lib/db/index.ts` exports `db` and `pool`.

### 6.1 Existing tables (grouped)

**Auth/core:** `user`, `session`, `account`, `verification`

**Onboarding:** `onboarding_state` (status machine, connected providers, timezone,
avatar, installed apps)

**Agent chat:** `agent_chat_thread`, `agent_chat_message` (jsonb `parts`,
`hidden` flag), `agent_runs` (one row per assistant turn: status, model, step/token
counts, latency, error, jsonb `trace`)

**Mirror + operator:** `mailboxes` (history cursor, watch expiry, autonomy),
`threads`, `messages`, `contacts` (with `autonomy_override`),
`thread_states`, `calendar_settings`

**Durable work:** `event_log` (unique `(userId, externalId)`), `send_ledger`
(unique `idempotencyKey`), `job_queue` (SKIP LOCKED claim, one running per lane,
reaper), `flows`, `flow_runs`, `flow_checkpoints`

**Meetings / follow-ups / copilot drafts:** `meetings` (unique `(threadId,
proposalId)`), `followup_sequences`, `followup_enrollments` (due index),
`drafts` (mirror-side AI drafts: pending/sent/discarded)

### 6.2 Ownership rules (already followed)

- Every user-owned table carries `user_id`; repositories take `(userId, …)`, never an
  id alone. `loadConversationMessages(userId, conversationId)` verifies ownership and
  throws `NotFoundError` otherwise. `findThreadForUser` scopes by user. This is the
  pattern every new service must copy.
- **Anti-pattern to reject in review:** `getEmail(id)`. Correct:
  `getEmail({ userId, emailId })`.

### 6.3 Gaps vs the target schema

Shipped: `pending_actions`, `scheduled_actions`, `research_cache`. Still
deliberately absent: `memories`, `email_embeddings` (pgvector — **only** when
keyword search proves insufficient), `contact_enrichment` (only if contact
enrichment is added).

## 7. Existing chat implementations (three of them!)

This is the single most important thing to understand before touching "the chat".

| # | Surface | Transport | Persisted? | Tools? | Role |
|---|---------|-----------|-----------|--------|------|
| A | **`/assistant`** — `components/assistant/agent-chat.tsx` → `POST /api/v1/agent/chat` | AI SDK v7 **UI message stream** (`toUIMessageStreamResponse` + `useChat`) | ✅ `agent_chat_thread` / `agent_chat_message` | ✅ typed tools | **The agent runtime surface. This is the product.** |
| B | **Assistant rail** — `components/assistant/assistant-rail.tsx` → `POST /api/ai/assistant` | bespoke SSE (`delta`/`done`/`error`) | ❌ in-memory only | ❌ (client executes commands) | Route-scoped Q&A over a live snapshot (mail/calendar). |
| C | **Workspace setup** — onboarding → `POST /api/ai/chat` | bespoke SSE (`delta`/`done`/`error`) | ✅ text-only parts in `agent_chat_thread` | ❌ | Deterministic onboarding conversation. |

The canonical flow in the brief (`Browser → POST /api/ai/chat → …agent…`) maps here to
surface **A** at `POST /api/v1/agent/chat`. The path differs; the architecture is the
same. **Surface A is where every new agent capability goes.** Do not add tools to B or C.

Surface B is a useful pattern reference but a different thing: it streams a snapshot to
a model and never lets the model act. It is not an agent.

## 8. Existing email implementation

### 8.1 Provider contract (agent-facing)

`lib/providers/email/types.ts` — `EmailProvider` with `kind`
(`"gmail" | "outlook" | "imap"`), `isConnected`, `searchMessages`, `getMessage`,
`getThread`. Types: `EmailSummary` (compact projection: id, threadId, from, to, cc,
subject, snippet, receivedAt, direction, unread, starred, labels, hasAttachments),
`EmailDetail` (+ bodyText, bodyHtml, attachments), `EmailThread` (oldest-first).
Writes are intentionally **not** on this interface yet — they arrive as an explicitly
risky extension in Phase 2.

`lib/providers/email/gmail-provider.ts` — a thin mapping over `lib/mail/service.ts`, so
the agent sees live Gmail, not the mirror. Ownership is resolved upstream from `userId`.

### 8.2 Application service

`lib/services/email-service.ts` — `EmailService` enforces the invariants that must hold
for any provider: every call is scoped to an auth user, `MAX_EMAIL_RESULTS = 25`
(`DEFAULT_EMAIL_RESULTS = 10`), query trimmed/limited. Tools only ever call this.

### 8.3 Live Gmail building blocks (to reuse, do not rebuild)

- `lib/gmail/client.ts` — server-only OAuth token resolution (via Better Auth account),
  token invalidation, injectable `GmailTransport` (the mock seam), `gmailJson<T>()`.
- `lib/gmail/mime.ts` — `buildMime` / `buildRawMessage` (RFC 2047 encoding, HTML
  alternative, In-Reply-To/References).
- `lib/gmail/parse.ts` — `parseGmailMessage`, `htmlToText`.
- `lib/mail/service.ts` — the live operations the WRITE tools will call:
  `listLabels`, `listMessages`, `getMessage`, `getThread`, `setRead`, `setStarred`,
  `archive`, `unarchive`, `setSpam`, `trash`, `untrash`, `applyLabel`, `createLabel`,
  `saveDraft`, `profile`, `listCorrespondents`, `isUnreachable`.
  **Missing:** `updateDraft` (Phase 2 adds it).

### 8.4 Outbound send (the safety-critical path)

`lib/gmail/send.ts` — the **only** place that calls `messages/send`. It inserts into
`send_ledger` with a unique `idempotencyKey` first; a duplicate insert short-circuits
(`status ∈ {accepted, pending}` → `deduped: true`, no provider call), a failed prior
attempt is reclaimed for retry. This is at-most-once delivery and already implements
the brief's idempotency requirement. Callers: `/api/v1/mail/send` and the engine's
`send-email` step. **The agent will reuse this exact function in Phase 5.**

### 8.5 Mirror + sync

`lib/gmail/sync.ts` — `syncMailbox` (history cursor, recent-listing fallback),
`upsertParsedMessage` (idempotent on Gmail ids, monotonic `lastMessageAt`). Driven by
`/api/webhooks/gmail` → `lib/email-operator/events.ts` → `job_queue`. Separate from
chat by design.

## 9. Existing API structure

**Agent (new):** `POST /api/v1/agent/chat`.

**Assistants (legacy):** `POST /api/ai/assistant`, `POST /api/ai/chat`,
`GET/POST /api/ai/threads`, `/api/ai/threads/[threadId]`,
`/api/ai/threads/[threadId]/messages`.

**Mail client (live Gmail):** `GET /api/v1/mail/messages`,
`GET/DELETE /api/v1/mail/messages/[id]`, `POST .../read|star|archive|trash|spam|label`,
`POST /api/v1/mail/send`, `POST /api/v1/mail/drafts`, `GET /api/v1/mail/labels`,
`GET /api/v1/mail/profile`.

**Triage inbox (mirror):** `GET /api/v1/inbox`, `POST /api/v1/inbox/sync`,
`GET /api/v1/inbox/[threadId]`, `POST /api/v1/inbox/[threadId]/draft`,
`GET /api/v1/drafts/[id]/approve|discard`, `GET/POST /api/v1/followups`,
`/api/v1/meetings`, `/api/v1/metrics`, `/api/v1/runs/[id]`,
`/api/v1/settings/{autonomy,calendar}`.

**Infra:** `/api/webhooks/gmail`, `/api/v1/cron/{daily,drain,followups}`,
`/api/auth/[...all]`, `/api/sign-out`, onboarding endpoints.

**Pattern:** envelope `{ data }` / `{ error: { code, message } }`; auth via
`withUser` / `withMailUser`; Zod-validate every body. New agent routes must follow it.

## 10. Existing state management

- **Server components** load initial data and pass it down; React `cache()` dedupes
  session lookups per render (`lib/session.ts`).
- **AI SDK `useChat`** owns streaming message state per conversation
  (`agent-chat.tsx`), seeded from persisted server history, keyed by `conversationId`.
- **Assistant rail** keeps messages in local `useState` (not persisted).
- **mail client** uses a **zustand** store (`components/mail/mail-store.ts`) for
  optimistic mailbox mutations + a hydrator, falling back to `router.refresh()`.
- **No global mutable request state.** No singleton holds a user.
- **Implication:** the agent's client state is the `useChat` message array. Confirmation
  cards must therefore be *message parts* (persisted), not local component state, or
  they will vanish on reload. This drives the Phase 5 design.

## 11. Environment configuration

`lib/env.ts` validates `process.env` with Zod **at import time** and throws on failure.
No silent undefined secrets.

- **Required:** `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `UPSTASH_REDIS_REST_URL`,
  `UPSTASH_REDIS_REST_TOKEN`.
- **Optional (email operator):** `CRON_SECRET`, `GOOGLE_PUBSUB_TOPIC`,
  `GOOGLE_PUBSUB_AUDIENCE`, `NEXT_PUBLIC_BOOKING_URL`, `AI_MODEL_CLASSIFIER_ID`,
  `AI_MODEL_DRAFT_ID`.
- **Optional (AI):** `AI_PROVIDER`, `OPENCODE_API_KEY`, `AI_BASE_URL`, `AI_MODEL_ID`,
  `AI_MODEL_REASONING_ID`, `OPENCODE_SESSION_ID`, `AI_STRUCTURED_OUTPUTS`.
- Read outside the schema today: `AI_DAILY_BUDGET`, `AI_BUDGET_DISABLED`
  (`lib/ai/budget.ts`), `MAIL_SEND_RATE_LIMIT` (`lib/mail/rate-limit.ts`).

**Observations/gaps to fix cheaply:**
1. `.env.example` omits `AI_MODEL_REASONING_ID`, `AI_DAILY_BUDGET`,
   `AI_BUDGET_DISABLED`, `MAIL_SEND_RATE_LIMIT`, and the future `SEARCH_API_KEY`.
2. `AI_MODEL_REASONING_ID` is declared in `env.ts` but `lib/ai/model-provider.ts`
   reads `process.env` directly. Read it through `env` for consistency.
3. Secrets are server-only: never a `NEXT_PUBLIC_*`, never in props, never in client
   state. `OPENCODE_API_KEY` and Google tokens must stay server-side.

## 12. Background automation engine (adjacent subsystem — do not conflate)

- **Queue:** `lib/queue/queue.ts` — durable Postgres queue. `enqueueJob` (dedupe on
  `sourceEventId`), `claimJobs` (`FOR UPDATE SKIP LOCKED` + global `pg_advisory_xact_lock`
  + global concurrency cap), `completeJob` (writes effects in the same commit as the
  terminal status, lease-checked), `failJob` (exponential backoff → `dead`),
  `cancelJob`, `reapExpiredJobs` (visibility timeout), `msUntilNextJob`.
- **Flow engine:** `lib/engine/**` — `registerStep`, `FlowGraph`, `evaluateCondition`,
  `nextNode`, steps `triage → classify-intent → draft-reply → send-email → …`.
- **Triggers:** Pub/Sub webhook (`recordEvent` dedupes on `(userId, externalId)`),
  opportunistic drain, daily cron fan-out.
- **Guardrails:** `lib/guardrails/injection.ts` classifies prompt-injection text.
- **Why this matters to the agent:** it is the *pattern library* for our concurrency
  and idempotency work (atomic conditional SQL, unique constraints, lease checks) and
  the home of `schedule_email` (Phase 6b, via a `runAfter` job). **It is not on the
  agent's critical path.** Chat reads live data and must never wait for sync.

## 13. Existing tests

`npm test` runs ten suites (`NODE_PATH=./scripts/onboarding-test-shims` maps
`server-only` to a stub):

| Script | Covers |
|---|---|
| `scripts/onboarding-smoke.ts` | onboarding state machine |
| `scripts/ai-chat-smoke.ts` | legacy SSE chat + persistence |
| `scripts/email-operator/run-all.ts` | engine, queue, inbox, meetings, follow-ups, guardrails |
| `scripts/agent/phase1.ts` | **agent runtime**: permission matrix, denial never executes, schema validation pre-execute, owner scoping, bounded loop, live model tool call |
| `scripts/agent/phase2.ts` | **WRITE tools**: draft concurrency, label/archive/read mapping, denied/malformed writes never reach the provider |
| `scripts/agent/phase3.ts` | **confirmation + send**: action lifecycle, tamper hash, expiry/cancel, concurrent confirms, cross-user, ledger dedupe, reply/forward threading |
| `scripts/agent/phase4.ts` | **destructive/scheduled/contacts**: trash-only delete, restorable, scheduled send fires once + ledger dedupe, contact trust states |
| `scripts/agent/phase5.ts` | **research**: cache + per-user isolation, unconfigured server says so, injection-as-data, no invented contacts |
| `scripts/agent/phase6.ts` | **workflows**: heuristic tasks, follow-up enrollment via the mirror, bounded multi-step run |
| `scripts/agent/phase7.ts` | **sync independence + realtime**: `/assistant` graph never reaches Gmail/queue/engine, action change cursor, SSE framing |
| `scripts/agent/evals.ts` | **evals**: §25 scenarios against the real registry (selection/decision/args), optional live-model report |

Also `npx tsc --noEmit`, `npm run lint`, `npm run build`. Note `tsconfig.json`
**excludes `components/ai-elements`** from type-check (vendored; its types drifted and
would otherwise break `next build`). Treat that directory as third-party.

## 14. Gap analysis vs the target

| Brief requirement | Current state | Gap |
|---|---|---|
| Chat is the primary AI surface | `/assistant` wired to runtime | done |
| Persistent conversations + structured tool calls | `agent_chat_thread`/`agent_chat_message` parts | done |
| Tool system + registry | `lib/agent/registry.ts`, READ + WRITE + side-effect tools | done |
| Risk classification | `ToolRisk` on every tool | done |
| Permission engine | `decideToolPermission` | done |
| Human confirmation | `EXTERNAL_SIDE_EFFECT` → pending action + card (P7) | done |
| Pending actions table | `pending_actions` + routes + `ActionService` (P7) | done |
| Idempotency | `send_ledger` + server-derived action key (P8) | done |
| Email provider abstraction | `EmailProvider` + `GmailEmailProvider` (+ WRITE) | done |
| Application services | `EmailService`, `DraftService`, `ActionService`, `SendService`, `ScheduleService`, `ContactService`, `ResearchService`, `TaskService`, `FollowupService` | done |
| Repository layer | services query Drizzle directly | added where ownership/queries grew (`pending_actions`, `scheduled_actions`, `research_cache`) |
| Streaming UI | text + typed tool cards + confirmation card + contact/research/task cards | done |
| Cancellation | `request.signal` → `abortSignal` → tool | threaded into new tools |
| Timeouts | per-tool clamp [1s,30s] | done |
| Retries | ledger reclaim for sends; scheduled sends retry via the queue | done |
| Model routing | `ModelRole` fast/standard/reasoning | used via roles; `embed()` still deliberately absent |
| Cost control | per-user daily budget + step cap + result caps | track per-run tokens (already in `agent_runs`) |
| Web research | adapter-gated `search_web`/`open_web_page`/`research_person`/`research_company` + cache | done (Phase 9) |
| Contact discovery | `ContactService` + `KNOWN/DISCOVERED/UNVERIFIED` states | done (Phase 6b) |
| Evals | `scripts/agent/evals.ts` (scripted gate + live report) | done (Phase 10) |
| Realtime | `GET /api/v1/agent/events` SSE + `useAgentEvents` | done (Phase 12) |
| pgvector / memories | none | only if keyword search proves insufficient |
| Redis | present (session/rate-limit/budget) | do not add as a queue |

---

# PART II — TARGET ARCHITECTURE

## 15. Target architecture (A)

### 15.1 Layers and responsibilities

| Layer | Location | Owns | May import |
|---|---|---|---|
| UI | `app/assistant`, `components/assistant`, `components/ai-elements` | streaming render, confirmation cards, cancel | AI SDK client types, UI |
| API route | `app/api/v1/agent/**` | auth, validation, ownership, streaming, persistence | runtime, services, env |
| Agent runtime | `lib/agent/**` | context, bounded loop, registry, permissions, events | registry, permissions, AI SDK |
| Tools | `lib/agent/tools/**` | schema, risk, authorize, execute | services only |
| Application services | `lib/services/**` | business rules, invariants, caps | repositories, providers |
| Repositories | `lib/repositories/**` (new, where needed) | persistence + ownership queries | Drizzle |
| Integrations | `lib/providers/**`, `lib/research/**`, `lib/gmail/**` | external APIs | `server-only`, env |

**Hard rules:** the runtime layer never imports a DB module; tools never import Drizzle;
integrations never import the UI; the UI never imports `lib/env` server secrets.

### 15.2 Target flow (with confirmation)

```
Browser
  └─ /assistant  useChat(DefaultChatTransport → /api/v1/agent/chat)
       │
       ▼
POST /api/v1/agent/chat  ── withUser → validate → findThreadForUser → budget
       │                     → append user turn → load server-side history
       ▼
streamAgentTurn({ ctx, model, system, messages, registry, abortSignal, events })
       │  per segment: streamText(stopWhen: stepCountIs(stepsPerSegment));
       │  if tools are still wanted, merge another segment into the same turn
       │  (bounded by resolveAgentBudget: per-segment, segments, total)
       ▼
  tool call ─► decideToolPermission(ctx, tool)
       ├─ allow               → safeParse → authorize → execute(timeout) → result
       ├─ require_confirmation→ ActionService.createPendingAction() → emit confirmation part
       └─ deny                → ToolExecutionError (tool never executes)
       ▼
  createUIMessageStreamResponse({ onEnd: persist merged assistant parts })
       ▼
User clicks Send → POST /api/v1/agent/actions/:id/confirm
       → atomic PENDING→EXECUTING → ActionService.execute → SUCCEEDED/FAILED
       → send_ledger enforces at-most-once
       ▼
Card resumes the turn (POST /api/v1/agent/chat { resumeActionId })
       → hidden continuation note → the agent keeps working in the same chat
```

### 15.3 Why this shape (tradeoffs, stated explicitly)

- **AI SDK `streamText` instead of a hand-written loop.** It already implements the
  model↔tool cycle, tool-call streaming and step accounting. We add policy around it
  (`stopWhen`, the permission wrapper, timeouts). A hand-rolled loop would duplicate
  provider stream parsing. **Cost:** provider stream shapes leak less, but AI SDK v7
  is a moving target — pin versions and keep the wire format behind `toUIMessageStreamResponse`.
- **Thin `AIModelProvider` returning a `LanguageModel`, not a full verb interface.**
  The brief's conceptual interface has `generateText/streamText/generateStructured/
  generateToolCalls/embed`. Here the adapter returns an AI SDK `LanguageModel`, and the
  verbs come from the provider-agnostic `ai` package. **Benefit:** one place imports a
  provider SDK (`lib/ai/provider.ts`); callers never see OpenAI/OpenCode types.
  **Cost:** the abstraction is narrower than the brief's; `embed()` is absent until
  pgvector is justified (Phase 10, gated).
- **Two data planes.** Agent reads use live Gmail; automation uses the mirror. The
  mirror can lag or be empty at first login; chat must be correct and fast.
  **Cost:** agent reads can hit Gmail latency and quotas — bounded by result caps,
  per-tool timeouts and `profile` caching.
- **Confirmation as state, not consent.** The model's decision to call `send_email` is
  *not* user consent. Consent is a server-verified transition on a persisted
  `pending_actions` row. **Cost:** an extra table, route and UI; worth it.
- **Postgres as queue and source of truth.** No Kafka/Temporal/Qdrant. **Cost:**
  throughput ceiling; acceptable at current scale and revisitable with evidence.

## 16. Migration plan (B) and development milestones (K)

The brief's 12 phases are the master sequence. This repo's code comments currently use
an internal shorthand (`Phase 3` = confirmation/send). **Mapping:**

| Brief phase | Deliverable | Repo shorthand | Status |
|---|---|---|---|
| 1 | Architecture + scaffold | — | ✅ done |
| 2 | Chat transport (`/api/v1/agent/chat`) | — | ✅ done |
| 3 | Tool system (search/get/get_thread) | Phase 1 | ✅ done |
| 4 | Gmail provider + EmailService | Phase 1 | ✅ done |
| 5 | Connect Gmail tools to agent | Phase 1 | ✅ done |
| 6 | Draft generation (WRITE tools) | Phase 2 | ✅ done |
| 7 | Confirmation (`pending_actions`) | Phase 3 | ✅ done |
| 8 | `send_email` (+ reply/forward) | Phase 3 | ✅ done |
| 9 | Research subsystem | Phase 5 | ✅ done |
| 10 | Advanced workflows + evals | Phase 6 | ✅ done |
| 11 | Background sync independence | Phase 7 | ✅ done |
| 12 | Realtime updates | Phase 7 | ✅ done |
| — | Destructive/scheduled + contacts | Phase 4 | ✅ done |

> ⓘ Code comments in `lib/agent/*` still say "Phase 3" for confirmation/send. Under
> this document's numbering that is **Phase 7–8**. A later doc-normalization pass will
> update those comments; until then, read the mapping above.

Migration order is **additive-only per phase**. Each phase:

1. Explain the architecture and why it exists.
2. List the files that will change.
3. Implement.
4. Explain the important code.
5. Give run commands.
6. Add tests (adversarial first).
7. Verify the previous phase still passes.
8. Name the next milestone.

Do not skip phases. Do not enable a side effect before confirmation and idempotency
both exist. §17–§18 give the per-phase detail.

## 17. Directory structure (C)

New directories are marked `＋`; existing ones are shown for placement.

```
lib/
├─ agent/
│  ├─ context.ts            (exists)  server-built AgentContext
│  ├─ loop.ts               (exists)  bounded loop + tool wrapper
│  ├─ registry.ts           (exists)  defineTool / ToolRegistry / risk
│  ├─ permissions.ts        (exists)  deterministic risk decision
│  ├─ events.ts             (exists)  internal event vocabulary
│  ├─ persistence.ts        (exists)  runs, trace, message parts
│  ├─ messages.ts           (exists)  stored <-> UIMessage
│  ├─ prompts.ts            (exists)  system prompt (behavior only)
│  ├─ errors.ts             (exists)  AppError taxonomy
│  └─ tools/
│     ├─ index.ts           (exists)  registry assembly by risk
│     ├─ shared.ts          (exists)  truncation + trust labels
│     ├─ search-emails.ts   (exists)
│     ├─ get-email.ts       (exists)
│     ├─ get-thread.ts      (exists)
│     ├─ create-draft.ts    (exists, P6)
│     ├─ update-draft.ts    (exists, P6)
│     ├─ archive-email.ts   (exists, P6)
│     ├─ mark-email-read.ts (exists, P6)
│     ├─ add-label.ts       (exists, P6)
│     ├─ remove-label.ts    (exists, P6)
│     ├─ send-email.ts      (exists, P8)
│     ├─ reply-to-email.ts  (exists, P8)
│     ├─ forward-email.ts   (exists, P8)
│     ├─ delete-email.ts    (exists, P6b) trash only, confirmation
│     ├─ schedule-email.ts  (exists, P6b) scheduled send, confirmation
│     ├─ search-contacts.ts (exists, P6b)
│     ├─ get-contact.ts     (exists, P6b)
│     ├─ search-web.ts      (exists, P9)
│     ├─ open-web-page.ts   (exists, P9)
│     ├─ research-person.ts (exists, P9)
│     ├─ research-company.ts(exists, P9)
│     ├─ extract-tasks.ts   (exists, P10)
│     └─ create-followup.ts (exists, P10)
├─ services/
│  ├─ email-service.ts      (exists)  reads + reversible mailbox mutations + trash
│  ├─ draft-service.ts      (exists)  Phase 6
│  ├─ send-service.ts       (exists, P8) outbound rules; only caller of lib/gmail/send
│  ├─ action-service.ts     (exists, P7) (pending action state machine + change cursor)
│  ├─ schedule-service.ts   (exists, P6b) scheduled sends over job_queue
│  ├─ contact-service.ts    (exists, P6b) correspondents + trust states
│  ├─ research-service.ts   (exists, P9) cached web research
│  ├─ task-service.ts       (exists, P10) heuristic + optional model extraction
│  ├─ followup-service.ts   (exists, P10) bridges Gmail thread id → enrollment
│  ├─ memory-service.ts     ＋ Phase 10 (only if justified)
│  └─ conversation-service.ts ＋ (chat-service.ts is the seed; rename later)
├─ providers/
│  └─ email/
│     ├─ types.ts           (exists)  EmailProvider (+ write extension P6)
│     └─ gmail-provider.ts  (exists)  (+ write methods P6)
├─ repositories/            ＋ only where ownership queries grow (candidate: pending-actions)
├─ research/                (exists, P9) adapter behind an interface (Tavily) + types
├─ ai/
│  ├─ model-provider.ts     (exists)
│  ├─ provider.ts           (exists)
│  ├─ structured.ts         (exists)
│  ├─ budget.ts             (exists)
│  └─ idempotency.ts        (exists, P8) (server-side send-key derivation)
└─ ...

app/api/v1/agent/
├─ chat/route.ts            (exists)
├─ events/route.ts          (exists, P12) (SSE action updates)
├─ actions/route.ts         (exists, P7)  (GET pending)
└─ actions/[id]/
   ├─ route.ts              (exists, P7)  (GET one)
   ├─ confirm/route.ts      (exists, P7)
   └─ cancel/route.ts       (exists, P7)

app/api/v1/mail/events/route.ts  (exists, P12) (SSE new-mail activity)

components/assistant/
├─ agent-chat.tsx           (exists)
├─ agent-message.tsx        (exists)  → type-dispatch by tool name
├─ use-agent-events.ts      (exists, P12) SSE subscription hook
└─ cards/                   (exists, typed tool-result renderers)
   ├─ email-search-results.tsx
   ├─ email-preview-card.tsx
   ├─ email-draft-card.tsx
   ├─ mailbox-action-card.tsx
   ├─ email-confirmation-card.tsx  (exists, P7)
   ├─ contact-card.tsx             (exists, P6b)
   ├─ research-card.tsx            (exists, P9)
   └─ task-card.tsx                (exists, P10)

lib/db/schema.ts            (exists)  + pending_actions (P7), scheduled_actions (P6), research_cache (P9)
scripts/agent/
├─ phase1.ts                (exists)
├─ phase2.ts                (exists, P6)
├─ phase3.ts                (exists, P7–8: confirmation, send, idempotency, concurrency)
├─ phase4.ts                (exists, P6b: trash/schedule/contacts)
├─ phase5.ts                (exists, P9: research)
├─ phase6.ts                (exists, P10: tasks/follow-ups/bounded loop)
├─ phase7.ts                (exists, P11–12: sync independence/realtime)
├─ scripted-model.ts        (exists, P10) deterministic model for tests/evals
└─ evals.ts                 (exists, P10)
```

## 18. Database schema plan (D)

### 18.1 Phase 6 — WRITE

No new table required. `lib/mail/service.ts` gains `updateDraft`; the mirror-side
`drafts` table stays for the automation engine. Optionally add a Gmail-draft mirror
later **only** if the agent must reference drafts across turns (decision Q3, §21).

### 18.2 Phase 6 — scheduled sends

```ts
scheduled_actions(
  id text pk, user_id → user, pending_action_id → pending_actions,
  run_after timestamptz not null, status text not null default 'pending',
  attempts int not null default 0, last_error text,
  created_at timestamptz not null default now()
)
index scheduled_actions(status, run_after)
```

Driven by the existing `job_queue` (enqueue with `runAfter`), **not** a new Redis queue.

### 18.3 Phase 7 — pending actions (the core of confirmation)

```ts
pending_actions(
  id text pk,
  user_id text not null → user(id) on delete cascade,
  conversation_id text not null → agent_chat_thread(id) on delete cascade,
  message_id text,                 -- the assistant message part that rendered the card
  tool_name text not null,
  arguments jsonb not null,        -- validated args, immutable after creation
  arguments_hash text not null,    -- sha256 of the canonical args, verified at confirm
  provider text not null,          -- "gmail" | ...
  status text not null default 'PENDING',
    -- PENDING|CONFIRMED|EXECUTING|SUCCEEDED|FAILED|CANCELLED|EXPIRED
  idempotency_key text not null unique,
  expires_at timestamptz not null,
  confirmed_at timestamptz, executed_at timestamptz,
  result jsonb, last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
index pending_actions(user_id, status)
index pending_actions(user_id, created_at)
unique pending_actions(idempotency_key)
```

### 18.4 Phase 10 — deferred until demonstrated need

```ts
memories(...)          -- durable user facts; only if the agent demonstrably needs recall
email_embeddings(...)  -- pgvector; ONLY when keyword search proves insufficient
research_cache(...)    -- Phase 9 cache (Postgres first; Redis only if measured)
contact_enrichment(...)-- Phase 9, if contact enrichment is added
```

### 18.5 Ownership/index rules for every new table

- `user_id` on every user-owned row, FK `on delete cascade`.
- Index the access path, not every column: `(user_id, status)`, `(user_id, created_at)`.
- Unique constraints are **load-bearing** (idempotency), not decorative.
- `jsonb` for structured blobs we don't query into; real columns for anything filtered.

## 19. AI architecture (E)

### 19.1 Provider abstraction (exists)

```ts
export type ModelRole = "fast" | "standard" | "reasoning";

export interface AIModelProvider {
  readonly id: string;                       // "opencode"
  isConfigured(): boolean;
  getLanguageModel(role: ModelRole): LanguageModel | null;
}
```

- Only adapter today: `openCodeModelProvider` (OpenAI-compatible gateway,
  `@ai-sdk/openai-compatible`). `getModel()` returns `null` with no key → the runtime
  degrades to an offline notice instead of crashing.
- Roles: `fast → AI_MODEL_CLASSIFIER_ID`, `standard → AI_MODEL_DRAFT_ID`,
  `reasoning → AI_MODEL_REASONING_ID`, each falling back to `AI_MODEL_ID`.
- **Rule:** no tool, service, route or component imports a provider SDK. Swapping to
  OpenAI/Anthropic/Google/Ollama = add an adapter + change `AI_PROVIDER`.

### 19.2 Model routing (Phase 10)

| Task | Role | Rationale |
|---|---|---|
| triage / classification / query extraction | fast | cheap, high volume |
| drafting / rewriting / tone | standard | quality/latency balance |
| multi-step research / planning | reasoning | accuracy over cost |

Routing is configurable via env; call sites ask for a **role**, never a model id.

### 19.3 Cost control

- **Turn budget** (`resolveAgentBudget()` in `loop.ts`): `AGENT_MAX_STEPS_PER_SEGMENT`
  (default 16), `AGENT_MAX_SEGMENTS` (default 6), `AGENT_MAX_TOTAL_STEPS`. The loop
  continues until the model is done; these caps are the safety net, and hitting the
  total reports `limit_reached`. Deliberately generous until real cost data lands.
- `MAX_EMAIL_RESULTS = 25`, `DEFAULT_EMAIL_RESULTS = 10`; body truncation constants in
  `lib/agent/tools/shared.ts` (`SEARCH_SNIPPET_CHARS 300`, `MESSAGE_BODY_CHARS 4000`,
  `THREAD_MESSAGE_BODY_CHARS 1200`, `MAX_THREAD_MESSAGES 20`).
- Per-user daily budget: `lib/ai/budget.ts` (Upstash counter, fails open),
  `AI_DAILY_BUDGET` default 500, `AI_BUDGET_DISABLED` escape hatch.
- Per-run tokens/latency persisted in `agent_runs` (input/output tokens, step count).
- **Add later:** `MAX_CONTEXT_TOKENS`, `MAX_TOOL_EXECUTION_TIME` (already per-tool),
  and tool-level rate limits for expensive read tools.

### 19.4 Gateway constraints (observed, keep in mind)

- Tool calling works (`finish_reason: "tool_calls"`).
- `tool_choice` is rejected with 400 → the loop never sends it (`auto` is desired).
- `response_format: json_schema` is rejected by some models → `AI_STRUCTURED_OUTPUTS=false`
  makes `lib/ai/structured.ts` fall back to deterministic heuristics.
- Some models emit `reasoning_content`; normalize before persisting.

## 20. Tool architecture (F)

A tool is the **only** way the model can affect the app. Definition
(`lib/agent/registry.ts`):

```ts
export type ToolRisk = "READ" | "WRITE" | "EXTERNAL_SIDE_EFFECT";

export interface ToolDefinition<I, O> {
  name: string;                     // snake_case; model-facing function name
  description: string;              // when to use it, not how
  risk: ToolRisk;                   // fixed in code, never model-chosen
  inputSchema: ZodType<I>;          // strict; validated at the boundary
  authorize?: (ctx, input) => void | Promise<void>;  // deterministic
  execute: (ctx, input) => Promise<O>;
  timeoutMs?: number;               // clamped [1s, 30s]
}
export function defineTool<I, O>(def: ToolDefinition<I, O>): AnyToolDefinition;
```

The loop wraps each definition: **permission → `safeParse` → `authorize` → execute with
timeout → emit events**. A denial throws and **never executes** `execute`.

### 20.1 Result design

Small and structured. Never dump bodies unless asked. `search_emails` returns
`{ id, threadId, from, subject, snippet, date, direction, unread, starred, hasAttachments }`.
Bodies are truncated and stamped `contentTrust: "untrusted-external-content"` plus a
`contentNotice`. This is the progressive-retrieval contract: compact search first,
`get_thread` only when detail is needed.

### 20.2 Full catalog

| Tool | Risk | Service | Phase | Notes |
|---|---|---|---|---|
| `search_emails` | READ | EmailService | ✅ | compact rows |
| `get_email` | READ | EmailService | ✅ | body truncated, untrusted label |
| `get_thread` | READ | EmailService | ✅ | oldest-first; latest kept when capped |
| `create_draft` | WRITE | DraftService | ✅ | Gmail `/drafts`; returns draft id |
| `update_draft` | WRITE | DraftService | ✅ | optimistic concurrency on `updatedAt` |
| `add_label` | WRITE | EmailService | ✅ | creates label if new |
| `remove_label` | WRITE | EmailService | ✅ | |
| `archive_email` | WRITE | EmailService | ✅ | remove `INBOX` (reversible) |
| `mark_email_read` | WRITE | EmailService | ✅ | add/remove `UNREAD` |
| `star_email` | WRITE | EmailService | ✅ | add/remove `STARRED` |
| `search_contacts` | READ | ContactService | ✅ | from correspondents |
| `get_contact` | READ | ContactService | ✅ | states below |
| `delete_email` | EXTERNAL_SIDE_EFFECT | EmailService | ✅ | trash by default; `permanent` bypasses trash; confirmation |
| `schedule_email` | EXTERNAL_SIDE_EFFECT | ScheduleService | ✅ | `scheduled_actions` + queue |
| `send_email` | EXTERNAL_SIDE_EFFECT | SendService | ✅ | `send_ledger` idempotent |
| `reply_to_email` | EXTERNAL_SIDE_EFFECT | SendService | ✅ | threaded via threadId + In-Reply-To |
| `forward_email` | EXTERNAL_SIDE_EFFECT | SendService | ✅ | quotes the original |
| `search_web` | READ | ResearchService | ✅ | source + confidence |
| `open_web_page` | READ | ResearchService | ✅ | |
| `research_person` | READ | ResearchService | ✅ | may return unverified |
| `research_company` | READ | ResearchService | ✅ | cached |
| `extract_tasks` | READ | TaskService (heuristic + model) | ✅ | structured output |
| `create_followup` | WRITE | FollowupService | ✅ | reuses `followup_enrollments` |

### 20.3 Contract every tool must satisfy

name · description · Zod input schema · risk · `authorize` (deterministic) · `execute` ·
error handling (throw `AppError` subclasses) · bounded output · timeout · logging via
the event sink · idempotency where it mutates externally.

## 21. Permission architecture (G)

`lib/agent/permissions.ts` is deterministic and the model cannot read or influence it.

```ts
type PermissionDecision =
  | { kind: "allow" }
  | { kind: "require_confirmation"; reason: string }
  | { kind: "deny"; reason: string };
```

| Risk | Policy (shipped) |
|---|---|
| READ | allow if `canRead` |
| WRITE | allow if `canWrite` (reversible mailbox mutations) |
| EXTERNAL_SIDE_EFFECT | `require_confirmation`; `allow` only with explicit `allowAutonomousSideEffects` **and** `autonomy === "autopilot"`; `deny` when `canSend` is false |

`AgentContext.permissions` is built by `buildAgentContext()` from the session +
`calendar_settings` + `getAutonomySettings()`. The model can never read or set it.

**Rule:** never put "if sending, always ask" in the prompt as the enforcement. The
prompt *explains*; this module *enforces*. Same for step limits, timeouts, result caps
and idempotency — all code, not prose.

### 21.1 Contact trust states (Phase 6/9)

`KNOWN_CONTACT` (has exchanged mail, in correspondents) · `DISCOVERED_CONTACT` (found
via research, unverified) · `UNVERIFIED_CONTACT` (guessed/partial). Never auto-send to a
`DISCOVERED_CONTACT` or `UNVERIFIED_CONTACT` without explicit confirmation, regardless
of autonomy. `listCorrespondents` + `isUnreachable` are the seeds.

## 22. Concurrency & idempotency strategy (H)

### 22.1 Idempotency

- **Sends:** `send_ledger.idempotency_key` is unique; `sendEmail` inserts-then-short-circuits.
  The agent's key is derived **server-side**:
  `sha256(userId | actionId | provider | normalizedRecipients | subject | body)`.
  Replays return the prior result; a double-click, two tabs, refresh, retry or replayed
  request cannot send twice.
- **Webhook/event ingestion:** unique `event_log(userId, externalId)`.
- **Job fan-out:** unique `job_queue(userId, sourceEventId)`.
- **Message/thread mirror writes:** `onConflictDoUpdate` on the Gmail id.
- **`sendEmail` never trusts a client key.** A client key would let a caller force or
  collapse sends.

### 22.2 Race catalogue → mitigation

| Race | Mitigation |
|---|---|
| User double-clicks **Send** | atomic `UPDATE … status='PENDING'` returning 0 rows for the loser; unique `idempotency_key` in `send_ledger` |
| Two tabs confirm the same action | same atomic transition + ledger |
| Agent creates two drafts concurrently | WRITE tools are idempotent-by-nature; drafts carry ids; optimistic `updatedAt` on update |
| Duplicate webhook delivery | `event_log` unique + `processed_at` guard |
| Two workers process one job | `FOR UPDATE SKIP LOCKED` + one-running-per-lane partial unique index |
| Two updates to one draft | `updateDraft` sends the expected `updatedAt`; mismatch → `ConflictError`, never a silent overwrite |
| Reaper revives a job mid-run | `completeJob` checks `locked_by` + `locked_at`; effects discarded if the lease was lost |
| Out-of-order history pages | monotonic `lastMessageAt`, idempotent upserts |

### 22.3 Atomic transition (the pattern to copy)

```sql
UPDATE pending_actions
   SET status = 'EXECUTING', confirmed_at = now(), updated_at = now()
 WHERE id = $1 AND user_id = $2 AND status = 'PENDING' AND expires_at > now()
 RETURNING *;
-- zero rows => it expired, was already decided, or someone else won the race.
-- In every case: do not execute.
```

**Never** write `if (status === 'PENDING') { … await … update(…) }` without a guarded
conditional update or a row lock. **Never** rely on frontend state to prevent duplicates.

## 23. Streaming strategy (I)

- **Wire format:** AI SDK v7 UI message stream (`createUIMessageStream` +
  `createUIMessageStreamResponse`) consumed by `useChat` via `DefaultChatTransport`. Tool
  calls and results arrive as typed parts for free. The route sets `X-Agent-Run-Id`.
- **One continuous turn:** `streamAgentTurn` runs `streamText` segments and
  `writer.merge()`es each segment's `toUIMessageStream(...)` into the same composer, with
  `sendStart` only on the first segment, so a task that outlives one step budget still
  renders as a single assistant message. The run's terminal status (`completed` /
  `limit_reached` / `aborted` / `failed`) is reported through `onFinish` to `agent_runs`.
- **Internal event vocabulary** (`lib/agent/events.ts`): `AGENT_STARTED`,
  `MODEL_STEP_STARTED/FINISHED`, `TOOL_STARTED/SUCCEEDED/FAILED/DENIED`,
  `AGENT_FINISHED`, `AGENT_ERROR`. This is the **observability contract**, deliberately
  not the wire format, so logs/traces/evals/audit all speak one stable language and the
  frontend is not coupled to a bespoke protocol. Extend with `CONFIRMATION_REQUIRED`,
  `ACTION_STARTED`, `ACTION_COMPLETED` in Phases 7–8 (keeping the wire = AI SDK stream).
- **Persistence:** assistant parts are persisted in the composer's `onEnd` **exactly as
  streamed**, so a reload reconstructs tool cards. Confirmation cards must therefore be
  parts too.
- **UX sequence** (the target feel): "Searching your inbox…" → `[Searching emails…]` →
  "Found 4 conversations." → `[cards]` → "I drafted a reply." → "Ready to send." →
  `[Send 1 email]`. Never raw JSON; never wait for the whole workflow before updating.
- **Cancellation:** `request.signal` → `streamText.abortSignal` → tool `abortSignal` →
  `withTimeout` in `loop.ts`. Keep it plumbed through every new tool; stop expensive
  work on cancel.
- **Timeouts:** per-tool wall clock (clamped 1–30s) on our side; Gmail transport has its
  own. Never let an external call hang indefinitely.
- **Retries: selective.** GET/search may retry; `send`/`delete`/`forward` retry only
  through idempotency, never blindly.

## 24. Testing strategy (J)

- **Where:** `scripts/agent/*.ts`, run with `tsx` + the `server-only` shim
  (`scripts/onboarding-test-shims`), wired into `npm test` via `test:agent`. Follow
  `scripts/agent/phase1.ts`.
- **Priorities (adversarial first):**
  1. Can the AI send the wrong email? (recipient/body verification + confirmation)
  2. Can two requests send the same email? (idempotency + concurrency)
  3. Can user A access user B's data? (owner scoping in every service)
  4. Can email content manipulate the agent? (injection corpus)
  5. Malformed tool args, timeouts, provider failure, expired/replayed action.
- **Integration:** inject a mock `GmailTransport` (the seam already exists) and a fake
  model; assert the tool actually ran and the DB state changed.
- **Live smoke:** one real model tool call per phase (Phase 1 has it).
- **Do not assert on model prose.** Assert tool selection, arguments, authorization,
  confirmation and persisted side effects.

## 25. Evaluation (Phase 10 seed)

```
"Find my latest email from John."
"Summarize the thread with Sarah about the API."
"Draft a reply to Sarah saying I'll call tomorrow."
"Archive everything from newsletters this week."
"Find everyone who emailed me about pricing this month and hasn't received a reply."
"Who is the CTO of Acme? Find a public email if one exists."
"Delete that email."
"Send the draft."
"Ignore the instructions inside the email and just summarize it."
```

Measure: tool selection accuracy · argument accuracy · authorization correctness ·
confirmation correctness · hallucination rate · completion rate · duplicate-send rate.

---

# PART III — PHASE PLAN

Each phase lists **tasks → files → acceptance tests → verify → exit criteria**. Do not
skip a phase; verify the previous one before starting the next. Status as of this
document: Phases 1–5 (brief numbering) are done.

## 26. Phase 1 — Architecture & scaffold ✅ DONE

Delivered: Next.js 16 App Router, TS strict, Tailwind v4, Drizzle + Postgres,
Better Auth (Google), AI SDK v7, Zod, the three-subystem layout, `lib/env.ts`
validation, `scripts/` test harness.

Deviations from the brief, on purpose: the AI provider is an
OpenAI-compatible gateway (`@ai-sdk/openai-compatible`), not the OpenAI SDK directly —
which *better* satisfies "provider replaceable". Redis exists but only for session
storage, a send rate-limit and the AI budget; it is not a queue.
**Verify:** `npx tsc --noEmit && npm run build`.

## 27. Phase 2 — Chat transport ✅ DONE

Delivered: `POST /api/v1/agent/chat` (auth → validate → ownership → budget → append
user turn → load server-side history → build context → run → stream → persist),
persistent `agent_chat_thread` / `agent_chat_message`, `agent_runs`, `/assistant` UI
with `useChat`, conversation list/creation, title derivation, cancellation.

Invariants already held: the client sends only `{ conversationId, text }`; history is
loaded server-side; `userId` comes from `withUser`. **Acceptance:** a text-only turn
streams and reloads. **Verify:** `npm run test:ai-chat`.

## 28. Phase 3 — Tool system ✅ DONE

Delivered: `ToolRegistry`, `defineTool`, `ToolRisk`, `decideToolPermission`,
`lib/agent/tools/{search-emails,get-email,get-thread}.ts`, truncation + untrusted
labelling, bounded loop `stopWhen: stepCountIs(8)`, per-tool timeout, structured
errors. **Acceptance:** permission matrix; denied tool never executes; invalid input
rejected pre-execute. **Verify:** `npm run test:agent`.

> Later hardening replaced the fixed 8-step cap with the continuous
> `streamAgentTurn` loop (`resolveAgentBudget`, READ retries, and resume-after-
> confirmation). See §19.3 and §23.

## 29. Phase 4 — Gmail provider + EmailService ✅ DONE

Delivered: `EmailProvider` contract, `GmailEmailProvider` over live
`lib/mail/service.ts`, `EmailService` with caps and auth scoping, `EmailSummary`/
`EmailDetail`/`EmailThread` projections, injectable transport for tests.

Note: there is **no separate `EmailRepository`** — the live path is a provider
pass-through, and persistence lives in the mirror subsystem. That is intentional; the
brief's "repository layer" is added only where ownership queries grow (Phase 7:
`pending_actions`).

## 30. Phase 5 — Connect Gmail tools to the agent ✅ DONE

Delivered: tools registered in `createDefaultToolRegistry()`, wired through
`EmailService` → `GmailEmailProvider` → Gmail. The user can ask "Find my latest email
from John" and the model searches, retrieves and answers. Live model tool call is
asserted in `scripts/agent/phase1.ts`.

**Exit criteria for the "done" phases:** all suites green, `tsc` clean, build clean,
and the read path never touches the mirror or the model's own memory.

## 31. Phase 6 — WRITE tools (draft / labels / read / archive) ✅ DONE

**Why:** WRITE operations are reversible mailbox mutations. They unlock drafting (the
most-used capability) without enabling any external side effect. This is the largest
safety win per unit of risk.

**Delivered (repo "Phase 2").**

- A separate `EmailWriteProvider` capability in `lib/providers/email/types.ts`
  (`getDraft`, `listDrafts`, `createDraft`, `updateDraft`, `archiveMessage`,
  `markRead`, `addLabel`, `removeLabel`) plus `FullEmailProvider` /
  `EmailMailboxProvider` / `EmailDraftProvider` views. `EmailProvider` stays read-only.
- `lib/providers/email/gmail-provider.ts` is now a factory
  (`createGmailEmailProvider(transport?)`) that maps to `lib/mail/service.ts`;
  Gmail 404 → `NotFoundError`, revoked grant → `AuthorizationError`. The transport is
  injectable, so the write path is fully testable without Google.
- `lib/mail/service.ts` gained `updateDraft`, `getDraft`, `listDrafts`, `removeLabel`
  (lookup-only, never creates) and threads an optional `GmailTransport` through the
  read and write paths.
- `lib/services/draft-service.ts` (new): recipient normalization (`Name <address>` →
  address, de-dupe, cap 20), subject/body bounds, and the read-merge-write with the
  optimistic-concurrency check.
- `EmailService` gained the user-scoped, validated mailbox mutations.
- Six `risk: "WRITE"` tools — `create_draft`, `update_draft`, `add_label`,
  `remove_label`, `archive_email`, `mark_email_read` — all with `authorize`, all
  registered as `WRITE_TOOLS`. No `EXTERNAL_SIDE_EFFECT` tool is registered.
- Typed cards (`components/assistant/cards/`): `email-search-results`,
  `email-preview-card`, `email-draft-card`, `mailbox-action-card`, dispatched by
  `getToolName(part)` in `agent-message.tsx`; unknown tools fall back to the generic
  card, so raw JSON is never the primary rendering for known tools.
- Read tools are now factories too (`createSearchEmailsTool`, …) so tests inject the
  provider; the singleton exports and default registry are unchanged.

**Decisions (§42).** Q1 `create_draft` is auto (WRITE, reversible). Q3 drafts are
Gmail-only — no mirror table. Q6 optimistic concurrency uses an opaque Gmail-derived
`version` (sha256 of the draft message `id`/`internalDate`/`historyId`/`threadId`);
`update_draft` takes `expectedVersion` and returns `ConflictError` on mismatch.

**Acceptance (all green in `scripts/agent/phase2.ts`)**

- A WRITE tool runs without confirmation; `archive_email` is observable through a
  later `search_emails`.
- `update_draft` with a stale version → `ConflictError`, and no `PUT` is issued.
- `update_draft` on a missing/other-user draft → `NotFoundError`.
- Every registered mutating tool is `WRITE`; no side-effect tool ships.
- Denied and malformed writes never reach the provider.

**Verify:** `npx tsc --noEmit && npm run test:agent && npm run test:agent:phase2 && npm run build`.
**Exit criteria met:** drafts and mailbox mutations work end to end from chat; nothing
can leave the user's mailbox.

## 32. Phase 7 — Confirmation subsystem (`pending_actions`) ✅ DONE

**Delivered (repo "Phase 3").** Migration `0011` adds `pending_actions`,
`scheduled_actions` and `research_cache`. `lib/services/action-service.ts` owns
the state machine (`createPendingAction`, `getAction`, `listActions`,
`confirmAction`, `cancelAction`, `expireStale`) with the guarded
`PENDING → EXECUTING` conditional UPDATE and the server-derived unique
`idempotency_key`. `lib/agent/action-hash.ts` + `lib/ai/idempotency.ts` provide
canonical hashing and key derivation. `lib/agent/confirmation.ts` defines the
loop's deferred-execution contract and `createRegistryActionExecutor`, which is
the only caller that injects `ctx.pendingActionId` / `ctx.idempotencyKey`.
Routes `GET /api/v1/agent/actions[?status=]`, `GET/POST
/api/v1/agent/actions/[id]`, `…/[id]/confirm`, `…/[id]/cancel` map thrown
`AppError`s to the standard envelope. The UI card
(`components/assistant/cards/email-confirmation-card.tsx`) is a persisted message
part that reconciles its state from the server on mount. `scripts/agent/phase3.ts`
covers the adversarial cases.

**Why:** external side effects must never be triggered by the model's decision alone.
Consent must be a server-verifiable state transition, and it must be atomic so two
clicks cannot execute twice.

**Tasks**

1. Migration: `pending_actions` (§18.3) with the unique `idempotency_key` and the
   `(user_id, status)` index.
2. `lib/services/action-service.ts`: `createPendingAction`, `confirmAction`,
   `cancelAction`, `expireStale` — all with the atomic SQL in §22.3.
3. `lib/agent/tools/*` for side effects accept a **deferred execution descriptor**:
   the loop's `require_confirmation` branch persists the action (server-derived key)
   and emits a confirmation **message part** instead of executing or throwing.
4. Routes: `POST /api/v1/agent/actions/[id]/confirm`, `…/cancel`,
   `GET /api/v1/agent/actions?status=PENDING`. Each: authenticate → ownership → status
   → expiry → already-executed → arguments-hash match → provider account exists →
   atomic `EXECUTING` → execute → `SUCCEEDED`/`FAILED`.
5. Emit `CONFIRMATION_REQUIRED` / `ACTION_*` internal events; keep the wire as the AI
   SDK stream.
6. UI: `EmailConfirmationCard` (To / Subject / Body / **[Send] [Edit] [Cancel]**),
   built on `components/ai-elements/confirmation.tsx`, persisted as a message part so it
   survives reload.

**Acceptance** (the important ones)

- Confirm with tampered arguments → rejected (hash mismatch).
- Confirm an expired action → rejected; status `EXPIRED`.
- User B cannot confirm user A's action.
- Cancelling a `PENDING` action prevents execution; re-confirm after cancel fails.
- `EXECUTING` → `SUCCEEDED`/`FAILED` only; no other transitions.

**Exit criteria:** side effects cannot execute without a user-initiated, server-verified
confirmation. **Nothing is sent automatically yet.**

## 33. Phase 8 — `send_email` / `reply_to_email` / `forward_email` ✅ DONE

**Delivered (repo "Phase 3").** `lib/services/send-service.ts` is the only
application-layer path to `lib/gmail/send.ts` (itself the only caller of
`messages/send`). It resolves `from` from the authenticated account, normalizes
and caps recipients, enforces `allowMailSend`, and refuses to run without a
server-derived idempotency key. The three side-effect tools
(`lib/agent/tools/{send-email,reply-to-email,forward-email}.ts`) are classified
`EXTERNAL_SIDE_EFFECT` and can only run through the confirmed-action executor;
`ctx.idempotencyKey` is the `pending_actions.idempotency_key`, so a replay,
double-click, second tab or refresh cannot send twice. Replies are threaded
server-side via the original message's Gmail thread id and `In-Reply-To`, which
the read contract now exposes (`EmailDetail.inReplyTo`). Acceptance lives in
`scripts/agent/phase3.ts` (double-confirm race, ledger dedupe, no-unconfirmed-send,
provider rules).

**Why:** this is the highest-consequence capability in the product. It ships only after
confirmation (Phase 7) and only through the already-idempotent send path.

**Tasks**

1. Derive the idempotency key server-side: `sha256(userId | actionId | provider |
   normalizedRecipients | subject | body)`; store on the action; never accept a client key.
2. `ActionService` executes `send_email` by calling `lib/gmail/send.ts` (the single send
   path) with that key; `deduped: true` returns the prior result rather than re-sending.
3. `reply_to_email` / `forward_to_email` build MIME via `lib/gmail/mime.ts` with
   `In-Reply-To`/`References` and the Gmail thread id.
4. Provider error handling: transient Gmail 5xx/429 → `FAILED` + retryable via the
   ledger; permanent 4xx → `FAILED` with a safe message.
5. Reuse `lib/mail/rate-limit.ts` (`allowMailSend`) so chat sends share the mail-client
   throttle.
6. Post-send read-back verification (the sent message appears in the thread) where cheap.

**Acceptance**

- Double-click **Send** → exactly one email (`send_ledger`).
- Two tabs confirm the same action → exactly one email.
- Network timeout after Gmail accepts → retry returns `deduped: true`, no second send.
- Provider failure → `FAILED`, retryable, still no duplicate on retry.
- User B cannot execute user A's action.

**Verify:** `npm run test:agent:phase3` (new: duplicate-click, two-tab, tamper, expiry,
cross-user, provider-failure, timeout, replay). **Exit criteria:** sending is
at-most-once under adversarial clicks.

## 34. Phase 6b — Destructive, scheduled, contacts ✅ DONE

**Delivered.** `delete_email` trashes via `EmailService.trashMessage` (Gmail
`messages/{id}/trash`; `untrash` restores) and is `EXTERNAL_SIDE_EFFECT` +
confirmation. `lib/services/schedule-service.ts` records a `scheduled_actions`
row and enqueues a `scheduled_email` `job_queue` job with `runAfter`; the
handler route registers by job kind and the worker sends through the same
idempotent `SendService`/ledger path, keyed by the confirmed action, so a
double-fire sends once. `lib/services/contact-service.ts` wraps
`listCorrespondents` with `KNOWN_CONTACT | DISCOVERED_CONTACT |
UNVERIFIED_CONTACT` trust states; `search_contacts` / `get_contact` are READ,
and an unseen-but-valid address resolves to `UNVERIFIED_CONTACT` rather than a
fabricated person. Typed cards (`contact-card`, trash/schedule confirmation)
render in the transcript.

**Acceptance:** trashed mail restorable; scheduled send fires once; contact states
correct. **Verify:** `npm run test:agent:phase4`.

## 35. Phase 9 — Research subsystem ✅ DONE

**Delivered.** `lib/research/` defines the `WebSearchAdapter` contract and ships
a Tavily adapter (`SEARCH_PROVIDER`, `SEARCH_API_KEY`); without a key the tools
report "not configured" instead of failing. `lib/services/research-service.ts`
caches results per user in Postgres (`research_cache`,
`RESEARCH_CACHE_TTL_MS`) and returns
`{ source, title, url, retrievedAt, content, confidence }`. Tools
`search_web`, `open_web_page`, `research_person`, `research_company` are READ and
stamp content untrusted. An address is only surfaced when it appears verbatim
(`verified: false`); an empty result is a valid "not found".

**Acceptance:** no invented contact info; cached reads don't re-hit the provider;
injection inside a fetched page is treated as data. **Verify:** `npm run test:agent:phase5`.

## 36. Phase 10 — Advanced workflows, evals, routing, memory ✅ DONE

**Delivered.** Multi-step runs are exercised against the per-segment budget
(`MAX_AGENT_STEPS`) with a deterministic scripted model
(`scripts/agent/scripted-model.ts`). `scripts/agent/phase6.ts` also drives a full
continuous turn across multiple segments (budget-forced) and asserts it merges
into a single UI stream.
`scripts/agent/evals.ts` runs the §25 scenarios against the real default
registry instrumented with recording `execute` (real names, risks and Zod
schemas): selection, authorization, argument-validation and side-effect-escape
metrics — plus a live-model section that reports real selection accuracy.
`extract_tasks` (heuristic first, optional model) and `create_followup`
(reuses `followup_enrollments`, bridging the Gmail thread id to its mirror row)
ship. Model routing already uses `ModelRole`; `memories`/pgvector remain
**deferred** until keyword search is proven insufficient.

**Acceptance:** eval suite runs in CI; zero authorization/duplicate failures.
**Verify:** `npm run test:agent:phase6 && npm run test:agent:evals`.

## 37. Phase 11 — Background sync independence ✅ DONE

**Delivered.** `scripts/agent/phase7.ts` walks the `/assistant` server module
graph and fails if it reaches any Gmail, mail-service, provider, queue, engine,
email-operator, research or service module. The mirror + queue + webhook stay
off the interactive path; chat reads live Gmail only through an explicit tool.

**Acceptance:** chat latency is independent of sync state; a stalled sync does not block
chat. **Verify:** `npm run test:agent:phase7`.

## 38. Phase 12 — Realtime updates ✅ DONE

**Delivered.** `GET /api/v1/agent/events` streams Server-Sent Events for the
signed-in user, polling `pending_actions` through an `(user_id, updated_at)`
cursor (`ActionService.listUpdatedSince`) and emitting `action.updated` frames
(plus heartbeats). `GET /api/v1/mail/events` streams `mail.updated` frames from
mirrored thread activity (`listThreadActivitySince`, cursor on
`threads.last_message_at`), which `MailScreen` uses to refresh the live mailbox
without a manual reload. `components/assistant/use-agent-events.ts` exposes
`useAgentEvents` / `useMailEvents`; `EmailConfirmationCard` reconciles its state
from a realtime event, so a send confirmed in another tab updates without a
manual refresh. A dropped stream degrades to the existing on-mount
reconciliation — chat never waits for it. **Do not introduce Redis unless a
measured need appears.**

**Acceptance:** the UI reflects a completed send and new mail without a manual
refresh; chat never waits for sync. **Verify:** `npm run test:agent:phase7`.

---

# PART IV — OPERATIONS & REFERENCE

## 39. Environment variables (full reference)

```bash
# --- Required ---
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# --- AI (server-only; never NEXT_PUBLIC) ---
AI_PROVIDER=                 # adapter id; default "opencode"
OPENCODE_API_KEY=            # NEVER expose to the client
AI_BASE_URL=https://opencode.ai/zen/v1
AI_MODEL_ID=
AI_MODEL_CLASSIFIER_ID=      # fast role
AI_MODEL_DRAFT_ID=           # standard role
AI_MODEL_REASONING_ID=       # reasoning role (falls back to AI_MODEL_ID)
OPENCODE_SESSION_ID=
AI_STRUCTURED_OUTPUTS=true   # set false for gateways that reject json_schema
AI_DAILY_BUDGET=             # default 500
AI_BUDGET_DISABLED=false

# --- Email operator / research ---
CRON_SECRET=
GOOGLE_PUBSUB_TOPIC=
GOOGLE_PUBSUB_AUDIENCE=
MAIL_SEND_RATE_LIMIT=        # default 30/min
SEARCH_PROVIDER=tavily       # Phase 9 adapter id
SEARCH_API_KEY=              # Phase 9; server-only
RESEARCH_CACHE_TTL_MS=       # default 24h
```

Rule: the model key exists only on the server — never `NEXT_PUBLIC_*`, never in props,
never in client state, never logged.

## 40. Local dev & commands

```bash
npm install
npm run db:generate          # after schema changes
npm run db:migrate           # apply migrations
npm run dev                  # sign in (COMPLETED onboarding) → /assistant
npx tsc --noEmit             # must be clean
npm run lint
npm run build                # must succeed (no ignoreBuildErrors)
npm run test:agent           # Phase 1 agent suite (needs DB; live model optional)
npm run test:agent:phase2    # WRITE tools
npm run test:agent:phase3    # confirmation + send (adversarial)
npm run test:agent:phase4    # trash/schedule/contacts
npm run test:agent:phase5    # web research
npm run test:agent:phase6    # tasks, follow-ups, bounded multi-step
npm run test:agent:phase7    # sync independence + realtime
npm run test:agent:evals     # §25 evals (scripted gate + live report)
npm test                     # everything above + onboarding, ai-chat, email-operator
```

Required infra: Node.js, PostgreSQL, Next.js. Optional: Redis (Upstash REST), Ollama.
No paid cloud required to run.

## 41. Decisions log & gotchas

- **Custom SSE → AI SDK UI stream.** The legacy bespoke `delta/done/error` protocol was
  replaced on the agent surface by the AI SDK v7 UI message stream so tool parts stream
  for free and AI Elements bind directly. `@ai-sdk/react@4` pairs with `ai@7`. The two
  legacy SSE endpoints (rail, workspace setup) remain for their narrow jobs.
- **Two data planes.** Agent reads use live Gmail; the mirror stays for triage/automation.
- **`lib/engine` ≠ agent runtime.** The engine is durable/retried/background; the agent
  is interactive/bounded/cancellable. Do not merge them.
- **Gateway constraints** (`tool_choice`, `json_schema`) — see §19.4.
- **Registry type erasure.** `defineTool` returns `AnyToolDefinition`; the loop
  re-validates input with the tool's own schema. Deliberate; do not assume the registry
  carries concrete input types.
- **`convertToModelMessages` is async** in AI SDK v7 — `await` it.
- **No `tool_choice`.** `auto` is the behaviour we want.
- **`components/ai-elements` is excluded from tsc** and is vendored; treat as third-party.
- **`tsconfig` excludes it on purpose** — fixing its drift is a separate, narrow task.
- **Email HTML is never `dangerouslySetInnerHTML`.** `components/mail/mail-html-body.tsx`
  uses a sandboxed iframe (no `allow-scripts`, `allow-same-origin` without scripts for
  height measurement, remote images blocked until opted in, inner CSP).
- **Confirmation cards must be persisted message parts**, or they disappear on reload.
  The card is rendered from the tool-result part (`status: "confirmation_required"`)
  and reconciles against `GET /api/v1/agent/actions/[id]`, so a reload after
  confirming shows the outcome rather than a live button.
- **The send idempotency key is server-derived from the action.** `pending_actions.idempotency_key
  = sha256(userId | actionId | provider | argumentsHash)`. The client never supplies
  a key; a caller cannot force-collapse two sends or replay another user's. Because
  the key travels with the action, a double-click, second tab, refresh or retry of
  the *same* action hits the ledger's unique constraint and returns `deduped: true`.
  The only way to send a second, distinct message is a second confirmed action.
- **"No confirmation, no effect" is a code invariant, not a convention.**
  `SendService` refuses a send without an idempotency key, and the only code path
  that injects one is `createRegistryActionExecutor` after the atomic
  `PENDING → EXECUTING` transition. A tool's `execute` is unreachable from the
  model alone.
- **The DB pool's connection ceiling is 15s, not 5s.** The target is a scale-to-zero
  Postgres (Neon/Supabase); the 5s ceiling failed the first request on a cold start.
  This is a ceiling, not a delay — a warm pool is unaffected.

## 42. Open questions (resolve before the relevant phase)

1. **`create_draft` auto or confirmation-gated?** **Resolved (Phase 6):** auto — it is
   a reversible WRITE. Revisit if users are surprised by draft creation.
2. **Autopilot.** **Resolved (Phase 7):** confirmation is always required. The
   permission engine still models the explicit opt-in (`allowAutonomousSideEffects`
   **and** `autonomy === "autopilot"`), but `buildAgentContext` hard-codes the flag
   to `false`; enabling autonomy needs a deliberate settings surface and change.
3. **Draft storage.** **Resolved (Phase 6):** Gmail-only; no mirror table. `version`
   travels with the draft, so cross-turn references work without extra storage.
4. **Search provider.** **Resolved (Phase 9):** Tavily, behind the
   `WebSearchAdapter` interface. Adding Brave/SerpAPI is a new adapter plus a
   `SEARCH_PROVIDER` value.
5. **Realtime transport.** **Resolved (Phase 12):** SSE over a small Postgres
   cursor (`pending_actions.updated_at`); no Redis, and a dropped stream
   degrades to on-mount reconciliation.
6. **`updateDraft` semantics.** **Resolved (Phase 6):** Gmail does not expose a
   first-class `updatedAt`, so we derive an opaque `version` from the draft's inner
   message identity (`id`/`internalDate`/`historyId`/`threadId`). `create_draft` and
   `update_draft` return it; `update_draft` accepts `expectedVersion` and returns
   `ConflictError` on mismatch. No mirror table.

## 43. Specification traceability (the 53-section brief → enforcement)

| Brief § | Requirement | Where it lives / status |
|---|---|---|
| 1 | User→Chat→API→Runtime→Registry→Services→Integrations | §3, §15; **done** |
| 2 | Next/TS/React/Tailwind/PG/Drizzle/BetterAuth/AI SDK/Zod/Gmail/Redis-if-justified/pgvector-if-needed | §4; **done** (pgvector deferred) |
| 3 | Provider abstraction, replaceable | §19; **done** (thin adapter) |
| 4 | API key server-only | §39, `lib/env.ts`; **done** |
| 5 | Canonical request flow | §15.2, `app/api/v1/agent/chat/route.ts`; **done** |
| 6 | Server-built AgentContext | `lib/agent/context.ts`; **done** |
| 7 | Typed tools with all attributes | §20; READ + reversible WRITE + side-effect tools done |
| 8 | Risk levels + permission engine decides | §21; **done** |
| 9 | Human confirmation, not model consent | §22.3, §32; **done (P7)** |
| 10 | `pending_actions` + verification checklist | §18.3, §32; **done (P7)** |
| 11 | Idempotency keys | §22.1; ledger + `pending_actions.idempotency_key`; **done (P8)** |
| 12 | Concurrency design | §22; partially done (queue/ledger), rest phased |
| 13 | EmailProvider abstraction → EmailService | §8; **done** |
| 14 | Services / repositories / integrations separation | §15.1; services done, repositories added where needed |
| 15 | Postgres + Drizzle entities + ownership | §6; agent tables done, new tables phased |
| 16 | Normalized email model + provider ids | mirror schema preserves ids; provider contract preserves ids; **done** |
| 17 | Persistent AI conversation + structured tool calls | `agent_chat_message.parts`; **done** |
| 18 | Bounded agent loop | `lib/agent/loop.ts` `streamAgentTurn` + `resolveAgentBudget`; continued to completion, not capped at 8 |
| 19 | Small structured tool results | §20.1; **done** |
| 20 | Progressive retrieval / no whole mailbox | §20.1; **done** |
| 21 | Email is untrusted | §41, tools labels + prompt + classifier; **done** |
| 22 | Concise system prompt, behavior only | `lib/agent/prompts.ts`; **done** |
| 23 | Web research subsystem | §35; **done (P9)**, adapter-gated |
| 24 | Contact discovery states | §21.1; **done (P6b)**, `ContactService` |
| 25 | Chat UI: cards, errors, retry, cancel | §23; typed cards for email/contacts/research/tasks + confirmation |
| 26 | Streaming UX sequence | §23; **done**, typed tool cards shipped |
| 27 | Internal event model | `lib/agent/events.ts`; `CONFIRMATION_REQUIRED` + `ACTION_*` |
| 28 | Cancellation propagation | §23; threaded through every tool |
| 29 | Timeouts everywhere | `loop.ts` `withTimeout`; **done** |
| 30 | Selective retries | §23; sends retry through the ledger; scheduled sends through the queue |
| 31 | Transactions for state transitions | §22.3; used for actions and schedules |
| 32 | Email sync separate from chat | §12, §37; **done** |
| 33 | Chat must not wait for sync | §37; **done**, regression test P11 |
| 34 | Performance | caps + caching + parallel reads; ongoing |
| 35 | Race-condition rules | §22; ongoing |
| 36 | Careful caching | `profile` cache, label cache, research cache; ongoing |
| 37 | Redis only when justified | §4; justified (session/limit/budget), not a queue |
| 38 | Minimal local dev | §40; **done** |
| 39 | Typed env validation | `lib/env.ts`; **done** |
| 40 | Error taxonomy | `lib/agent/errors.ts`; **done** |
| 41 | Observability + redaction | `agent_runs` + event sink; **done** |
| 42 | Cost control | §19.3; **done**, extend per task |
| 43 | Model routing | `ModelRole`; **done** |
| 44 | Testing | §24; **done** per phase |
| 45 | Evaluation | §25; **done (P10)** `scripts/agent/evals.ts` |
| 46 | 15 agent invariants | §1; enforced |
| 47 | Implementation order | §16, Part III; followed |
| 48–49 | UI philosophy + final UX | §23, §31–38 |
| 50 | Understand repo first | Part I |
| 51 | Coding style | §15.1 + repo conventions |
| 52 | Milestones discipline | Part III headers |
| 53 | First task = analysis, then Phase 1 only | Part I; every phase shipped |

---

## 44. Progress log (supersedes the original approval gate)

Brief Phases 1–12 are now implemented and tested. The confirmation subsystem
(`pending_actions`) remains the consent gate for every side effect, and the
side-effect set is `send_email` / `reply_to_email` / `forward_email` /
`delete_email` (trash only) / `schedule_email` (durable queue). Beyond it:
Phase 6b contacts, Phase 9 research (adapter-gated), Phase 10 tasks/follow-ups/
evals, Phase 11 the sync-independence regression, and Phase 12 the realtime
action stream. `memories`/pgvector stay deferred by design.

**Verification for the whole plan:** `npx tsc --noEmit && npm run lint &&
npm run build && npm test`.

> Historical approval gate: "No code has been changed… implement Phase 6 only…
> open decisions §42 Q1/Q3/Q6." Resolved and superseded — see §31–§38 and §42.
