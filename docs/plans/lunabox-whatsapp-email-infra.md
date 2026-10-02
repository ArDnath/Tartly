# Lunabox — WhatsApp Business + Gmail Core Infrastructure Plan

Status: build-ready plan (no implementation yet)
Target: ship a working **WhatsApp (WAHA/NOWEB) + Gmail** backend for the beta, deployed on **AWS EC2 (stateful tier)** + **Vercel (Next.js app)**, reusing tested patterns from `DeskcommCRM` and `ChatbotX`.

---

## 0. Non-negotiables / decisions locked

| Decision | Choice |
|---|---|
| WhatsApp channel | **WAHA, engine = NOWEB** (Baileys-class). QR + pairing-code connect. |
| WhatsApp realtime | **Bidirectional WebSocket** (browser ↔ core ↔ WAHA REST) |
| Email | **Gmail only** (Google API), all 7 requested features |
| Email realtime | **SSE** (server → client), fed by Gmail `users.watch` + Cloud Pub/Sub |
| Human behavior | `sendGuard` layer: presence/typing, delays, rate limits, warmup, variation |
| Stateful host | **AWS EC2** (Docker Compose: Caddy, WAHA, core, Redis) |
| App host | **Vercel** (Next.js UI, auth, Gmail OAuth, Gmail webhook, token minting) |
| DB | Existing Neon Postgres (Drizzle) |
| Object storage | Cloudflare R2 (S3-compatible) for media/attachments |
| Onboarding | Instinct-style: phone OTP → connect WhatsApp → agent says hello |

### Known traps (read before building)
- **Vercel Hobby forbids commercial use.** Free while beta is non-paying; move to Pro ($20/user/mo) before charging.
- **WAHA is a persistent process** → cannot run on Vercel. Lives on EC2.
- **Hobby/edge function duration caps (~60s) break long-lived SSE** → SSE lives on EC2 core.
- **Unofficial WhatsApp = ban risk.** Humanization reduces but does not remove it. Keep the `channel` adapter seam so official Cloud API can replace WAHA later without re-architecting.
- **Gmail sensitive scopes** require Google verification; until then max ~100 test users. Pub/Sub requires a Google Cloud billing account.
- **SECURITY: `.env.example` currently contains a real Neon password and a real Google client secret.** Rotate both and scrub the file before any push/deploy.
- **AWS free tier is 12 months only** (t3.micro/t2.micro). After that, budget ~$15–30/mo for a t3.small/medium. WAHA NOWEB needs headroom (2 GB RAM min for a few sessions).

---

## 1. Architecture

```
                         ┌──────────────── Vercel (Next.js) ────────────────┐
 Browser ──HTTPS───────▶ │ UI · better-auth (Google + phone OTP)            │
   │                     │ /api/realtime/token  (mint 60s JWT)              │
   │                     │ /api/integrations/google/{connect,callback}      │
   │                     │ /api/webhooks/gmail  (Pub/Sub push)              │
   │                     │ /api/whatsapp/*      (proxy → core)              │
   │                     └───────────────┬──────────────────────────────────┘
   │                                     │ internal REST (X-Internal-Secret)
   │  WSS  /ws   (WhatsApp, bidi)        ▼
   ├─────────────────────────┐   ┌──────────────── AWS EC2 (Docker) ─────────────────┐
   │  SSE  /sse/email        └──▶│ Caddy (TLS)                                       │
   │                             │  ├─ core (Node TS): ws + sse + REST + workers     │
   │                             │  ├─ WAHA (NOWEB)  ── webhook ──▶ core/webhooks/waha│
   │                             │  └─ Redis (pub/sub + queues)                      │
   └─────────────────────────────└───────────────────────────────────────────────────┘
                    Neon Postgres (Drizzle)  ·  Cloudflare R2 (media)
```

**Responsibilities**
- **Next.js (Vercel):** UI, auth, Gmail OAuth + API calls, Gmail Pub/Sub webhook, mint short-lived realtime JWT, proxy WhatsApp ops to core.
- **core (EC2, always-on):** owns WAHA session calls, receives WAHA webhooks, persists messages, runs `sendGuard`, hosts the WS + SSE realtime gateway, subscribes to Redis, runs event workers.
- **Redis (EC2):** pub/sub between core webhook/workers and the realtime gateway; lightweight queues.
- **WAHA (EC2):** WhatsApp protocol engine; never exposed publicly (internal Docker network only).

Optional simplification (if cross-service auth feels heavy): co-locate the Next.js app on the same EC2 via Caddy and drop the internal-secret hop. The plan works either way; the split above is the recommended default.

---

## 2. Repo layout (inside `app-server`)

```
app-server/
├─ app/
│  ├─ api/
│  │  ├─ realtime/token/route.ts              # mint short-lived JWT
│  │  ├─ integrations/google/
│  │  │  ├─ connect/route.ts                  # start OAuth (offline+consent)
│  │  │  ├─ callback/route.ts                 # exchange code, store tokens
│  │  │  └─ disconnect/route.ts
│  │  ├─ webhooks/gmail/route.ts              # Pub/Sub push → fetch → publish
│  │  └─ whatsapp/
│  │     ├─ sessions/route.ts                 # list/create (proxy → core)
│  │     ├─ sessions/[id]/route.ts            # status/delete
│  │     ├─ sessions/[id]/qr/route.ts         # QR proxy
│  │     ├─ sessions/[id]/pairing-code/route.ts
│  │     ├─ sessions/[id]/reconnect/route.ts
│  │     └─ messages/route.ts                 # send (proxy → core)
│  └─ (app)/whatsapp/... , (app)/mail/...     # UI (later)
├─ components/
│  ├─ onboarding/steps/connect-whatsapp-step.tsx
│  ├─ whatsapp/qr-dialog.tsx
│  └─ mail/...
├─ services/core/                             # NEW: EC2 service (own tsconfig + Dockerfile)
│  ├─ src/
│  │  ├─ index.ts                             # http + ws server bootstrap
│  │  ├─ routes/{sessions,messages,webhooks,internal,health}.ts
│  │  ├─ realtime/{ws.ts,sse.ts,events.ts,subscriber.ts}
│  │  ├─ waha/{client.ts,ingest.ts,envelope.ts,webhook-auth.ts,message-id.ts,send.ts,media.ts}
│  │  ├─ channels/{index.ts,adapters/waha.ts,capabilities.ts}
│  │  ├─ guard/{send-guard.ts,presence.ts,rate-limit.ts,warmup.ts}
│  │  ├─ workers/{event-drain.ts,media-persist.ts}
│  │  └─ db.ts                                # imports ../../lib/db
│  ├─ Dockerfile
│  └─ tsconfig.json
├─ lib/
│  ├─ db/schema.ts                            # extended (see §5)
│  ├─ integrations/google/{oauth.ts,client.ts,tokens.ts}
│  ├─ realtime/{token.ts,events.ts}
│  └─ crypto/secret-box.ts                    # AES-256-GCM token encryption
├─ docker/
│  ├─ docker-compose.core.yml
│  └─ Caddyfile
└─ .env.example                               # extended (see §3)
```

> `services/core` must be excluded from the Next build (`tsconfig.json` `exclude` + not under `app/`). It shares `lib/db/schema.ts` so both processes speak the same tables.

---

## 3. Environment variables (append to `.env.example`)

```bash
# ── Auth / app ────────────────────────────────────────────────
BETTER_AUTH_SECRET=            # rotate existing
BETTER_AUTH_URL=https://app.example.com
NEXT_PUBLIC_BETTER_AUTH_URL=https://app.example.com
GOOGLE_CLIENT_ID=              # rotate existing
GOOGLE_CLIENT_SECRET=          # rotate existing

# ── Database (Neon) ───────────────────────────────────────────
DATABASE_URL=                  # rotate existing; never commit real value

# ── Token encryption (AES-256-GCM, base64 32 bytes) ───────────
# openssl rand -base64 32
TOKEN_ENCRYPTION_KEY=

# ── Redis on EC2 ──────────────────────────────────────────────
REDIS_URL=redis://:PASSWORD@core.internal:6379

# ── core (EC2) ↔ Next.js trust ───────────────────────────────
CORE_BASE_URL=https://rt.example.com
CORE_INTERNAL_SECRET=          # openssl rand -base64 48
REALTIME_BROADCAST_SECRET=     # openssl rand -base64 48 (min 32 chars)

# ── WAHA (core only; never public) ────────────────────────────
WAHA_API_BASE_URL=http://waha:3000
WAHA_API_KEY=                  # dashboard key
WAHA_HMAC_SECRET=              # SHA512 hex configured in WAHA
WAHA_WEBHOOK_REQUIRE_SIGNATURE=false   # true only on WAHA Plus/proxy

# ── Gmail push (Google Cloud) ─────────────────────────────────
GMAIL_PUBSUB_TOPIC=projects/PROJECT_ID/topics/gmail-push
GMAIL_PUBSUB_VERIFICATION_TOKEN=       # random; used in push URL
PUBLIC_APP_URL=https://app.example.com

# ── Object storage (Cloudflare R2, S3-compatible) ─────────────
R2_ENDPOINT=https://ACCOUNT.r2.cloudflarestorage.com
R2_BUCKET=lunabox-media
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=

# ── AWS EC2 compose only ──────────────────────────────────────
DOMAIN=rt.example.com
REDIS_PASSWORD=
```

---

## 4. WAHA service (EC2)

### 4.1 Run
```yaml
# docker/docker-compose.core.yml
services:
  caddy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
    depends_on: [core]

  waha:
    image: devlikeapro/waha:latest
    environment:
      WHATSAPP_DEFAULT_ENGINE: NOWEB
      WHATSAPP_HOOK_URL: http://core:8080/webhooks/waha
      WHATSAPP_HOOK_EVENTS: message,message.any,message.ack,message.edited,message.revoked,session.status,state.change
      WHATSAPP_HOOK_HMAC_KEY: ${WAHA_HMAC_SECRET}
      WAHA_API_KEY: ${WAHA_API_KEY}
      # keep the store/lid translation usable if you need @lid→phone
      WHATSAPP_NOWEB_STORE_ENABLED: "true"
    volumes: [waha_sessions:/app/.sessions]
    # NO ports: internal network only
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--requirepass", "${REDIS_PASSWORD}", "--appendonly", "yes"]
    volumes: [redis_data:/data]
    restart: unless-stopped

  core:
    build: { context: .., dockerfile: services/core/Dockerfile }
    env_file: [../.env]
    depends_on: [waha, redis]
    restart: unless-stopped

volumes: { caddy_data: {}, waha_sessions: {}, redis_data: {} }
```

```caddyfile
# docker/Caddyfile
rt.example.com {
  handle /ws*    { reverse_proxy core:8080 }
  handle /sse/*  { reverse_proxy core:8080 }
  handle /internal/* { reverse_proxy core:8080 }
  handle /webhooks/* { reverse_proxy core:8080 }
  handle /healthz { reverse_proxy core:8080 }
}
```
> WAHA's dashboard/QR endpoints are **not** published by Caddy. The app talks to WAHA only from inside the Docker network (or via `core`).

### 4.2 WAHA REST endpoints used (port from `DeskcommCRM/lib/waha/client.ts`)
| Purpose | Method + path |
|---|---|
| Version/engine | `GET /api/server/version` |
| Create session | `POST /api/sessions` `{ name, start:false, config:{ ignore, webhooks } }` |
| Start session | `POST /api/sessions/{name}/start` |
| Session snapshot (status/qr/me) | `GET /api/sessions/{name}` |
| Stop / logout / delete | `POST /api/sessions/{name}/stop\|logout`, `DELETE /api/sessions/{name}` |
| Update config (GET then PUT) | `PUT /api/sessions/{name}` `{ name, config }` |
| Send text (optionally `reply_to`) | `POST /api/sendText` |
| Send media | `POST /api/sendImage\|sendVideo\|sendVoice\|sendFile` |
| Presence (typing) | `POST /api/{session}/presence` `{ chatId, presence:"typing"\|"paused"\|"recording" }` |
| Seen | `POST /api/sendSeen` `{ session, chatId, messageId }` |
| Contact exists | `GET /api/contacts/check-exists?session=&phone=` |
| Profile picture | `GET /api/contacts/profile-picture?session=&contactId=` |
| Resolve `@lid` → phone | `GET /api/{session}/lids/{lid}` |

**Client rules to preserve (hard-won in Deskcomm):**
- Always send `X-Api-Key`. Use `AbortSignal.timeout` (15s default, **30s for media**).
- **Never** leak WAHA response bodies to logs or clients; surface status only (`waha_<op>_<status>`).
- `createSession` is never proof of ownership — always confirm with `GET` of the exact name.
- `PUT /api/sessions/{name}` **replaces the whole config** → always `GET` first and merge (`ignore`, `webhooks`).
- Engine must be `NOWEB`; refuse incompatible sessions.

### 4.3 Session lifecycle
`STARTING → SCAN_QR_CODE → WORKING` (and `STOPPED / FAILED`).

Connect flow:
1. `POST /api/whatsapp/sessions` (Next.js) → proxy `core` → reserve row (`channel_sessions.status='STARTING'`) idempotently.
2. `core` → WAHA create+start → returns status.
3. UI shows **QR** (`GET .../qr`, PNG proxied, `no-store`) **and** a **pairing-code** option (`POST .../pairing-code`).
4. Status changes arrive via WAHA `session.status` webhook → `core` updates DB → publishes `session.status` → WS pushes to UI.
5. On `WORKING`: store `phoneNumber`, set `status='WORKING'`, and trigger the **first agent greeting**.
6. Reconnect = `stop`+`start` (soft) or `{force:true}` = `logout`+`start` (credentials dead).
7. Delete/Logout: logout + delete; keep history rows.

UI: port `DeskcommCRM/components/connections/ConnectionsClient.tsx` `QrDialog` behavior — poll status every 3s as a **fallback** and refresh the QR image every ~15s (QR expires ≈20s). Prefer the WS `session.status` push for instant state.

### 4.4 Webhook ingest (`core/src/waha/ingest.ts`)
Order (fail-closed):
1. Read **raw body** (`req.text()`), never the parsed object, for HMAC.
2. Resolve session by envelope (`session` name / webhook path token).
3. HMAC-SHA512 verify (`lib/waha/webhook-auth.ts` logic): if a signature is present and doesn't match → reject; if `WAHA_WEBHOOK_REQUIRE_SIGNATURE=true` → require; otherwise accept + record `signatureVerified:false`.
4. **Always archive** raw event to `webhook_events`.
5. Strict contract parse (zod) → drop malformed.
6. Route:
   - `message` / `message.any`, `fromMe=false` → inbound
   - `message` / `message.any`, `fromMe=true` → operator's own phone (pause bot; detect our echo)
   - `message.ack` → update `messages.ack` (use `bareWaMessageId`)
   - `message.edited` / `message.revoked` → update body / stamp `revokedAt`
   - `session.status` / `state.change` → update `channel_sessions.status`

**Idempotency + identity (must port):**
- `messages` unique on `(user_id, external_id)`; treat Postgres `23505` as "already have it".
- Echo dedup via `wahaEchoExternalIds(externalId, recipient)` and `chatIdFromWaMessageId` (`lib/waha/message-id.ts`).
- `contacts.waIdentity` canonical `phone:+E164` | `lid:<digits>`; resolve `@lid` first, phone second when sending (`lib/waha/send.ts` logic).
- Ignore groups/status/broadcast/channels at the **WAHA config level** (`ignore` in session config) to save storage/CPU.

### 4.5 Outbound + humanization (`core/src/guard/send-guard.ts`)
Every send passes through, in order:
1. **Rate limit** — per session: `INCR` fixed window in Redis; reject over cap.
2. **Warmup ramp** — new session starts at a low daily cap, ramps over N days (`warmupDay`, `dailyCap`).
3. **Business hours** — optional per-user window; queue outside.
4. **Typing simulation** — `setPresence(..., "typing")`; sleep `clamp(len * 30–80ms, 800ms, 6000ms)` + jitter; then `setPresence("paused")`.
5. **Read receipt** — `sendSeen` with small randomized delay.
6. **Variation** — avoid byte-identical repeats of the same reply within a window.
7. **Send** via WAHA.
8. **Auto-pause** — on repeated send errors/health signals, set `channel_sessions.status='PAUSED'` instead of hammering.

Port Deskcomm's `channel_knobs`, warmup, throttle, and STOP/opt-out detection rather than reinventing.

### 4.6 Media
- Inbound: WAHA payload → download (30s timeout) → upload to **R2** → store `mediaPath`.
- Outbound: upload to R2 → generate **signed URL (≈10 min)** → hand URL to WAHA (never base64).
- Endpoint map: text=`sendText`, image=`sendImage`, video=`sendVideo` (`convert:true`), voice=`sendVoice`, file=`sendFile`.

---

## 5. Data model (extend `lib/db/schema.ts`)

```ts
// WhatsApp
channelSessions: id, userId, provider('waha'), sessionName (unique), engine, status,
  phoneNumber, webhookSecretEnc, warmupDay (int, default 0), dailyCap (int), knobs jsonb,
  archivedAt, createdAt, updatedAt
contacts: id, userId, waIdentity (unique per user), phone, name, avatarPath, createdAt
conversations: id, userId, channelSessionId, contactId, isGroup, unreadCount,
  lastMessageAt, botPausedUntil, createdAt
messages: id, userId, conversationId, externalId, direction('in'|'out'), status,
  ack (int), body, mediaPath, mediaMime, replyToMessageId, sentVia, editedAt, revokedAt, createdAt
  // UNIQUE (userId, externalId)
webhookEvents: id, userId, provider, eventType, externalId, validSignature, raw jsonb, createdAt

// Event bus
events: id, userId, type, entityKind, entityId, payload jsonb, status('pending'|'processing'|'done'|'dead'),
  attempts int, createdAt, processedAt

// Gmail
emailAccounts: id, userId, provider('google'), emailAddress, accessTokenEnc, refreshTokenEnc,
  scope, expiresAt, historyId, watchExpiration, createdAt, updatedAt
  // UNIQUE (userId, emailAddress)
emailThreads: id, emailAccountId, gmailThreadId, subject, snippet, labelIds jsonb, lastMessageAt
emailMessages: id, threadId, gmailMessageId (unique), from, to, cc, subject,
  bodyText, bodyHtml, labelIds jsonb, direction, receivedAt
emailAttachments: id, messageId, gmailAttachmentId, filename, mimeType, sizeBytes, storagePath
emailWatches: id, emailAccountId, kind('reply'|'from'|'subject'), criteria jsonb, active, lastNotifiedAt

// Guard state (optional if you keep it in Redis)
sendGuardState: id, channelSessionId, sentToday, dayStart, lastSentAt
```

Indexes: `messages(conversationId, createdAt)`, `events(status, createdAt)`, `emailMessages(threadId, receivedAt)`.
Migration: `npx drizzle-kit generate` → `npm run db:migrate`.

---

## 6. Realtime gateway (core)

### 6.1 Auth (port `ChatbotX/packages/partysocket-config`)
- JWT **HS256** via `jose`, audience `user:<id>`, `TOKEN_TTL_SECONDS = 60`, secret `REALTIME_BROADCAST_SECRET` (min 32 chars).
- Next.js `GET /api/realtime/token` mints it for the logged-in user.
- Browser connects: `wss://rt.example.com/ws?token=<jwt>` and `https://rt.example.com/sse/email?token=<jwt>`. Core verifies on connect (and re-verifies on reconnect).

### 6.2 Event contract (`lib/realtime/events.ts`, shared)
```ts
type RealtimeEvent =
  | { type: "session.status"; sessionId; status }
  | { type: "message.created"; conversationId; message }
  | { type: "message.updated"; messageId; patch }
  | { type: "message.ack"; messageId; ack }
  | { type: "conversation.updated"; conversationId; patch }
  | { type: "email.received"; accountId; threadId; message }
  | { type: "email.sent"; accountId; threadId; messageId }
  | { type: "email.updated"; accountId; threadId; patch }
  | { type: "resubscribed" }   // sent after reconnect → client refetches
```

### 6.3 WS (`/ws`) — WhatsApp, bidirectional
- Server → client: JSON `RealtimeEvent` filtered by the user's audience.
- Client → server: `{ op:"send", conversationId, body }`, `{ op:"read", conversationId }`, `{ op:"typing", conversationId }`.
- Heartbeat ping/pong; on reconnect the client invalidates queries (refetch).
- Outbound from WS → `sendGuard` → WAHA.

### 6.4 SSE (`/sse/email`) — Gmail, server → client
- `Content-Type: text/event-stream`, `Cache-Control: no-store`, `Connection: keep-alive`.
- Emits `email.*` events; heartbeat comment every ~25s to defeat proxy idle-timeouts.
- Outbound email actions go through REST, not SSE.

### 6.5 Client hooks (port the resilience contract, not Supabase)
Port the *behavior* of `DeskcommCRM/hooks/realtime/useRealtimeChannel.ts` to your own transports:
- exponential backoff (cap 30s), fresh connection each attempt (never re-subscribe a dead socket),
- `status` state, `ultimaEntrega` ref,
- emit a synthetic `resubscribed` after a reconnect so consumers **refetch what they missed**,
- `useRefetchDeSeguranca` + `refetchOnWindowFocus`.

---

## 7. Gmail infrastructure

### 7.1 Scopes (avoid `https://mail.google.com/` → no CASA audit)
```
openid email profile
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/gmail.compose
https://www.googleapis.com/auth/gmail.settings.basic
```
OAuth params: `access_type=offline`, `prompt=consent`, `include_granted_scopes=true` (incremental). Reuse the existing Google client (add the callback URI); keep these scopes **off** the Better Auth sign-in.

### 7.2 Token storage
- `lib/crypto/secret-box.ts`: AES-256-GCM (`TOKEN_ENCRYPTION_KEY`), store `iv:tag:ciphertext` base64.
- Store encrypted `accessToken`/`refreshToken` in `email_accounts`.
- Refresh when `expiresAt - 60s < now`; on `invalid_grant` mark the account disconnected and notify over SSE.

### 7.3 Feature → API mapping
| Feature | Gmail API | Scope |
|---|---|---|
| Find & summarize emails/threads | `users.messages.list` (with `q`), `users.threads.get` | readonly |
| Extract deadlines/decisions/attachments/invoices/action items | MIME parse + `users.messages.attachments.get`; files → R2; AI extraction later | readonly |
| Draft replies in your voice | `users.drafts.create` | compose |
| Send after review (recipient + exact body) | `users.drafts.send` / `users.messages.send`; resolve `sendAs` | compose |
| Labels, filters, archive/organize | `users.labels.create`, `users.threads.modify` (drop `INBOX` = archive), `users.settings.filters.create` | modify + settings.basic |
| Watch for a reply / specific email | `users.watch` → Pub/Sub push → `users.history.list` | readonly/modify |
| Multiple accounts, correct sender | per-account adapter; **always** resolve `From` from the account row (`users.settings.sendAs.list`) | — |

Send API detail: build RFC822 raw message (`raw` = base64url) with `From` = account's sendAs address; never a global default.

### 7.4 Push notifications (`users.watch`)
1. Google Cloud: create Pub/Sub topic `gmail-push`; grant `gmail-api-push@system.gserviceaccount.com` → `roles/pubsub.publisher`; create a **push subscription** to `https://app.example.com/api/webhooks/gmail?token=<GMAIL_PUBSUB_VERIFICATION_TOKEN>`.
2. `POST https://gmail.googleapis.com/gmail/v1/users/me/watch` `{ topicName, labelIds:["INBOX"] }` → returns `historyId`, `expiration`.
3. **Renew every ~6 days** (cron) — a cron route on EC2 core or Vercel.
4. On push: decode Pub/Sub body → `users.history.list(startHistoryId)` since stored `historyId` → persist new messages → publish `email.received` → SSE.

### 7.5 Multi-account isolation
- Every query/mutation is scoped by `emailAccountId` (and `userId`).
- Adapter per account (`lib/integrations/google/client.ts` factory keyed by account).
- The UI always shows which account is active; the send path asserts `accountId` from the request, never from a client-supplied `From`.

---

## 8. Cross-service API contract (Next.js ↔ core)

All core `/internal/*` calls require header `X-Internal-Secret: <CORE_INTERNAL_SECRET>`.

| Method | Path | Body / notes |
|---|---|---|
| POST | `/internal/whatsapp/sessions` | `{ userId, name? }` → create+start, returns snapshot |
| GET | `/internal/whatsapp/sessions/:name` | snapshot (status, qr, me) |
| POST | `/internal/whatsapp/sessions/:name/reconnect` | `{ force?: boolean }` |
| POST | `/internal/whatsapp/sessions/:name/logout` | logout + delete |
| GET | `/internal/whatsapp/sessions/:name/qr` | PNG stream (proxied) |
| POST | `/internal/whatsapp/sessions/:name/pairing-code` | `{ phoneNumber }` |
| POST | `/internal/whatsapp/messages` | `{ userId, conversationId, body, replyTo? }` (goes through sendGuard) |
| POST | `/internal/events/publish` | `{ userId, event }` → publish to Redis (used by Gmail path) |

Public on core: `GET /healthz`; `POST /webhooks/waha` (HMAC); `GET /ws`; `GET /sse/email`.

---

## 9. Onboarding (Instinct-style)

```
Landing → phone number → OTP (better-auth phoneNumber plugin)
        → workspace created
        → "Connect WhatsApp" (QR or pairing code)
        → WORKING → agent sends the first greeting to the user's own number
        → Gmail connect (optional, second)
        → done
```
Replace the current mock `create-profile`/`sync-email` path for the WhatsApp/Gmail connection step. Keep the existing onboarding step machine; the connect step simply drives `/api/whatsapp/*` and `/api/integrations/google/*`.

---

## 10. Porting map (exact sources)

**From `DeskcommCRM` (WAHA + realtime + workers).** Adapt Supabase client chains → Drizzle; keep the patterns.
| Need | File |
|---|---|
| WAHA REST client | `lib/waha/client.ts` |
| Webhook verify (fail-closed) | `lib/waha/webhook-auth.ts` |
| Ingest / dispatch / idempotency | `lib/waha/ingest.ts`, `lib/waha/envelope.ts` |
| Echo + `@lid` id handling | `lib/waha/message-id.ts`, `lib/waha/send.ts` |
| Session connect/reservation | `lib/channels/connect-waha.ts`, `lib/channels/nome-da-sessao.ts` |
| Pairing code | `lib/channels/pairing-code.ts` |
| Adapter seam + capabilities | `lib/channels/index.ts`, `lib/channels/adapters/waha.ts`, `lib/channels/capabilities.ts` |
| Media | `lib/messaging/media/waha-source.ts`, `lib/waha/media-send.ts` |
| Anti-ban knobs / warmup | `channel_knobs` schema + warmup logic |
| Worker model (event drain) | `lib/event-log/*`, `app/api/v1/cron/*` |
| QR dialog UX | `components/connections/ConnectionsClient.tsx` (QrDialog) |
| Realtime resilience contract | `hooks/realtime/useRealtimeChannel.ts`, `useRefetchDeSeguranca.ts` |
| Outbound email (optional) | `lib/email/resend.ts` |

**From `ChatbotX`.**
| Need | File |
|---|---|
| Realtime JWT (HS256, audience, 60s) | `packages/partysocket-config/src/auth.ts` |
| Broadcast helpers / event contract | `packages/partysocket-config/src/{lib.ts,schemas.ts}` |
| One-time-token connect auth (pattern) | `apps/builder` one-time-token route + `packages/auth` |
| Transactional mail (MJML+nodemailer) | `packages/mail`, `integrations/smtp` |
| (Future) official Cloud API adapter | `integrations/whatsapp/src/{client,api/auth,api/webhook}.ts`, `.../outgoing-message/*` |

> Neither repo has inbound Gmail; that is net-new. Neither repo has raw Baileys; WAHA/NOWEB covers it.

---

## 11. Build phases & checklists

### P0 — Foundation (nothing broken)
- [ ] `services/core` scaffold: HTTP server (`node:http` or Fastify) + `ws` + SSE + `/healthz`.
- [ ] `lib/crypto/secret-box.ts` (AES-256-GCM) with a unit test round-trip.
- [ ] `lib/realtime/token.ts` (sign/verify) + `/api/realtime/token`.
- [ ] Extend `lib/db/schema.ts`; `drizzle-kit generate`; migrate.
- [ ] Redis client in core (`ioredis`) + pub/sub smoke test.
- [ ] `docker-compose.core.yml` + Caddyfile; `docker compose up` on EC2; `/healthz` green over HTTPS.
- **Verify:** mint token in the app → open `wss://.../ws` and `.../sse/email` → receive a manually published `{type:"resubscribed"}`.

### P1 — WhatsApp
- [ ] Port WAHA client + session lifecycle + QR/pairing routes.
- [ ] `POST /api/whatsapp/sessions` proxy; QR dialog in onboarding; status via WS.
- [ ] Webhook receiver + HMAC + archive + strict parse + idempotent persistence.
- [ ] Inbound → `message.created` over WS; contacts/conversations upsert.
- [ ] Outbound REST + `sendGuard` (rate limit, warmup, typing, seen, variation).
- [ ] Media → R2; signed-URL sends.
- [ ] First-greeting on `WORKING`.
- **Verify:** real number → scan QR → send/receive live in the UI without refresh; ack updates; duplicate webhook produces one row; restart core → WS auto-reconnects and refetches.

### P2 — Gmail core
- [ ] `googleapis` dep; OAuth connect/callback; AES token storage; refresh.
- [ ] Inbox list + thread view (search via `q`); label list; archive; label create.
- [ ] Draft create + reviewed send; per-account `sendAs`.
- **Verify:** connect 2 accounts; search/summarize a thread; archive a thread; draft + send from the correct account; wrong-account send is impossible by construction.

### P3 — Gmail realtime
- [ ] Pub/Sub topic + push subscription + verification token.
- [ ] `users.watch` + 6-day renewal cron.
- [ ] Push → `history.list` → persist → `email.received` → SSE.
- [ ] Watch rules (reply/from/subject) → notify.
- **Verify:** send an email to the connected inbox → appears via SSE without refresh; reply detection fires once.
