# Plan — Gmail sync fix + topple-style Mail client (`/mail`)

Status: ready to implement
Decisions locked with the user:

1. **Placement** — add a full Gmail-style mail client at **`/mail`**; keep the AI triage inbox at `/inbox`.
2. **Data source** — the mail client reads **live from Gmail** (no mirror). Triage/meetings/follow-ups keep using the Postgres mirror.
3. **Theme** — **adapt** topple's `mail-*` tokens to the existing Lunabox dark base (`#1b1b1b`).

Source of the UI: `/home/ariyaman/Dev/fight/topple/apps/web/src/features/mail/**` + `apps/api/src/services/gmail.service.ts`.

---

## 0. Why (recap of the confirmed bug)

The DB currently has `mailboxes = 0`, `threads = 0`, `messages = 0`. Onboarding is `COMPLETED`
with `connected_email_provider = google`, but nothing downstream was ever created. Three gaps:

- `ensureMailbox()` is only called by test scripts — the onboarding callback never creates a mailbox.
- `syncInbox()` ("Sync now") enqueues `inbound_email`, whose handler only re-processes **already-mirrored**
  threads; it never calls `syncMailbox`. Only the Pub/Sub webhook and the daily cron sync Gmail.
- `isEmailOperatorEnabled()` is false because `GOOGLE_PUBSUB_TOPIC` is unset → webhook 503, no watch.

Part A fixes the pipeline; Parts B–E add the live mail client; Part F is the `.env`/keys runbook.

---

## Part A — Fix the Gmail data pipeline (mirror for triage)

Goal: connecting Google reliably creates a mailbox, starts a watch, and performs an initial sync;
"Sync now" actually pulls new mail; the daily cron backfills.

### A1. Create the mailbox on connect
File: `app/api/onboarding/sync-email/complete/route.ts`

After the existing scope check and `advanceOnboarding`, add a best-effort block (never block onboarding
on a Gmail hiccup):

```ts
import { env } from "@/lib/env";
import { ensureMailbox } from "@/lib/email-operator/mailbox";
import { getGmailProfile } from "@/lib/gmail/sync";
import { registerMailboxWatch } from "@/lib/gmail/watch";
import { enqueueJob } from "@/lib/queue/queue";
import { JOB_KIND_MAILBOX_SYNC } from "@/lib/email-operator/job-kinds";
import { pool } from "@/lib/db";

if (connected) {
  try {
    const profile = await getGmailProfile(session.user.id);
    const mailbox = await ensureMailbox({
      userId: session.user.id,
      email: profile.emailAddress ?? session.user.email,
      historyId: profile.historyId ?? null,
    });
    if (env.GOOGLE_PUBSUB_TOPIC) {
      await registerMailboxWatch({
        userId: session.user.id,
        mailboxId: mailbox.id,
        topicName: env.GOOGLE_PUBSUB_TOPIC,
      });
    }
    // Initial backfill + triage, deduped on the mailbox id.
    await enqueueJob(pool, session.user.id, {
      kind: JOB_KIND_MAILBOX_SYNC,
      laneKey: `mailbox:${mailbox.id}`,
      payload: { mailboxId: mailbox.id },
      sourceEventId: `connect:${mailbox.id}`,
    });
  } catch (error) {
    console.error("[onboarding] mailbox bootstrap failed", error);
  }
}
```

### A2. New `mailbox_sync` job kind (the missing sync step)
Files: `lib/email-operator/job-kinds.ts`, new `lib/email-operator/handlers/mailbox-sync.ts`,
register it in `lib/email-operator/jobs.ts` (`ALL_HANDLERS`).

```ts
export const JOB_KIND_MAILBOX_SYNC = "mailbox_sync";
```

```ts
// handlers/mailbox-sync.ts
async function handleMailboxSync(job, ctx) {
  const mailboxId = typeof job.payload.mailboxId === "string" ? job.payload.mailboxId : null;
  if (!mailboxId) return;

  const mailbox = await getMailboxForUserById(job.userId, mailboxId);
  if (!mailbox) return;

  // 1) Pull new mail from Gmail into the mirror (this is what was missing).
  await syncMailbox(job.userId, mailboxId);

  // 2) Hand the newly-mirrored threads to the triage/draft flow.
  await enqueueJob(pool, job.userId, {
    kind: JOB_KIND_INBOUND_EMAIL,
    laneKey: `mailbox:${mailboxId}`,
    payload: { mailboxId },
    sourceEventId: `post-sync:${mailboxId}:${Date.now()}`,
  });
}
```

### A3. Make "Sync now" actually sync
File: `lib/inbox/service.ts` → `syncInbox()`
Change the enqueued kind from `JOB_KIND_INBOUND_EMAIL` to `JOB_KIND_MAILBOX_SYNC` (keep the
`kickDrain` call and the `409 no_mailbox` response). After A1, a freshly connected user has a mailbox,
so this path now works even with no Pub/Sub configured.

### A4. Self-heal for already-onboarded users
Because existing users (like your account) already have `COMPLETED` rows but no mailbox, add a small
reconciler:

- `lib/email-operator/mailbox.ts` → `ensureMailboxForUser(userId)`:
  if no mailbox row and a Google account with the inbox scopes exists, `ensureMailbox(...)` then enqueue
  `mailbox_sync` (dedupe on `connect:<mailboxId>`).
- Call it (best-effort, `after()`) from `app/inbox/layout.tsx` next to the existing `kickDrain`, and from
  the new `/mail` layout (Part E). This turns "I'm logged in but empty" into a self-correcting state.
- Optional: also call it once in `runDailyMaintenance` for any connected user without a mailbox.

### A5. Cron already backfills
`lib/email-operator/cron.ts` already loops mailboxes and calls `syncMailbox`. No change required, but add
`enqueueJob(JOB_KIND_INBOUND_EMAIL, …)` after each backfill if you want triage on the daily pass.

### A6. Tests
Extend `scripts/email-operator/phase1-gmail.ts` with: connect → mailbox exists → `mailbox_sync` drains →
threads mirrored. Add a case asserting `syncInbox` enqueues `mailbox_sync`.

---

## Part B — Live Gmail API for the mail client

The topple client is backed by `apps/api/src/services/gmail.service.ts`, a **stateless live Gmail
pass-through** (no mirror). Port it into app-server, reusing the existing transport in
`lib/gmail/client.ts` (`getGoogleAccessToken` + `gmailJson`).

### B1. Extend the Gmail client for `204 No Content`
File: `lib/gmail/client.ts` → `gmailJson` currently always calls `response.json()`. `messages/batchModify`
returns 204. Add:

```ts
if (response.status === 204) return undefined as T;
```
before the JSON parse (topple's `gmailFetch` does exactly this).

### B2. New `lib/mail/service.ts` (port of `gmail.service.ts`)
Port these, keeping app-server's `(userId, …)` + `gmailJson` signature instead of `(token, …)`:

- `MailAddress`, `MailAttachment`, `MailMessage`, `Correspondent` types (mirror topple's).
- `parseAddressList`, `stripHtml`, `extractBody`, `collectAttachments`, `formatBytes`.
- `deriveBox(labelIds)`, `deriveTag(labelIds)`, `senderLine(from, to)`, `toMailMessage(...)`.
- `userLabelMap`, `listLabels`, `labelIdForName`.
- `BOX_LOOKUP` + `listMessages(userId, { box, search, limit, pageToken })` (metadata format, pooled
  concurrency 8).
- `getMessage(userId, id)` (format=full).
- Mutations via `batchModify`: `setRead`, `setStarred`, `archive`, `unarchive`, `setSpam`.
- `trash`/`untrash` (per-message POST, pooled).
- `applyLabel`, `createLabel`.
- `profile(userId)` → `{ emailAddress, messagesTotal }`.
- `listCorrespondents` (optional for now; it powers the AI directory).

Prefer reusing `lib/gmail/parse.ts` where it overlaps, but keep the richer list-row fields
(`box/tag/labels/unread/starred/replied/attachments`) since the UI needs them.

### B3. Sending — reuse the existing idempotent path
`lib/gmail/send.ts` (`sendEmail`) already has the `sendLedger` idempotency + `lib/gmail/mime.ts` already
supports `cc`, `inReplyTo`, `references`. To serve the composer:

- Add `bcc?: string[]` to `OutboundEmail` in `lib/gmail/mime.ts` and emit a `Bcc` header.
- Add an optional `bcc` pass-through in `sendEmail`'s call to `buildRawMessage`.
- `/api/v1/mail/send` calls `sendEmail({ userId, email, gmailThreadId, idempotencyKey: 'mail:'+nanoid() })`
  and returns `{ id, threadId }`.
- Drafts: `saveDraft(userId, mail)` → `POST /drafts` (new, small helper in `lib/mail/service.ts`).

### B4. AI compose draft (optional, recommended)
Topple's composer has a "Draft with AI" button (`generateMailDraft`). Wire an app-server equivalent:
`POST /api/v1/mail/draft` → use `lib/ai/provider.ts` + `lib/ai/structured.ts` (or `generateText`) to write a
body from `{ to, subject, instruction }`. Reuse `tryConsumeAiBudget`. Never auto-send.

### B5. New API routes (cookie-auth, `withUser`)
Under `app/api/v1/mail/`:

| Method | Path | Notes |
|---|---|---|
| GET | `/profile` | `{ emailAddress, messagesTotal }` |
| GET | `/messages` | `?box=&search=&limit=&pageToken=` → `{ messages, labels, nextPageToken? }` |
| GET | `/messages/[id]` | full body |
| POST | `/messages/read` | `{ ids, read }` |
| POST | `/messages/star` | `{ ids, starred }` |
| POST | `/messages/archive` | `{ ids, archived }` |
| POST | `/messages/trash` | `{ ids, trashed }` |
| POST | `/messages/spam` | `{ ids, spam }` |
| POST | `/messages/label` | `{ ids, label }` |
| POST | `/labels` | `{ label }` |
| POST | `/send` | `{ to, cc?, bcc?, subject, body, threadId?, inReplyTo? }` |
| POST | `/drafts` | same body |
| POST | `/draft` | `{ to, subject, instruction? }` → AI body (optional) |

Validate with Zod, mirror the `{ data }` / `{ error: { code, message } }` envelope (`lib/api/http.ts`),
and rate-limit `/send` like topple (`rateLimit`-style; app-server can reuse an Upstash counter).

---

## Part C — Port the mail UI

Source → destination (`components/mail/**`, `lib/mail/**`):

| topple | app-server |
|---|---|
| `features/mail/components/MailScreen.tsx` | `components/mail/mail-screen.tsx` |
| `MailHeader.tsx` | `components/mail/mail-header.tsx` |
| `MailSidebar.tsx` | `components/mail/mail-sidebar.tsx` |
| `MailToolbar.tsx` | `components/mail/mail-toolbar.tsx` |
| `MailList.tsx` | `components/mail/mail-list.tsx` |
| `MailRow.tsx` | `components/mail/mail-row.tsx` |
| `MailRowMenu.tsx` | `components/mail/mail-row-menu.tsx` |
| `MailReader.tsx` | `components/mail/mail-reader.tsx` |
| `MailHtmlBody.tsx` | `components/mail/mail-html-body.tsx` |
| `MailTagBadge.tsx` | `components/mail/mail-tag-badge.tsx` |
| `MailCheckbox.tsx` | `components/mail/mail-checkbox.tsx` |
| `MailUndoToast.tsx` | `components/mail/mail-undo-toast.tsx` |
| `ComposeDialog.tsx` | `components/mail/compose-dialog.tsx` |
| `store/mail.store.ts` | `components/mail/mail-store.ts` |
| `lib/mail-filter.ts`, `lib/mail-format.ts` | `lib/mail/filter.ts`, `lib/mail/format.ts` |
| `types/mail.types.ts` | `lib/mail/types.ts` |
| `services/mail.service.ts` | `lib/mail/client.ts` (fetch wrapper, not the Gmail service) |

### C1. Dependencies
- **Add `zustand`** (topple's store) — smallest-friction port; alternative is a `useReducer` context.
- `@base-ui/react` is **already installed** (used by `MailRowMenu`). ✅
- `lucide-react` ✅, `@/lib/utils` (`cn`) ✅.
- **Add `components/ui/skeleton.tsx`** (only missing primitive; used by `MailList` loading rows).

### C2. Store wiring
`mail-store.ts` keeps topple's optimistic-then-confirm pattern, undo batch, page cache (`absorb`), and
keyboard cursor. Point `services/mail.service.ts` at the new `/api/v1/mail/*` routes. Keep
`confirm()` → reload-on-error so the UI snaps back to Gmail truth.

### C3. Safety
Keep `MailHtmlBody` exactly as-is: sandboxed `<iframe>` (`allow-same-origin allow-popups`, **no**
`allow-scripts`), per-frame CSP, remote images blocked until the user opts in. This is the XSS boundary —
do not replace with `dangerouslySetInnerHTML`.

### C4. Compose
Port `ComposeDialog` as-is (chips, Cc/Bcc, expand, save-draft, "Draft with AI"). Replace
`generateMailDraft` (orchestrator) with `POST /api/v1/mail/draft` (B4). Adapt the send button styling to
the Lunabox tokens (below).

---

## Part D — Theming: adapt `mail-*` tokens to the dark base

Add to `app/globals.css` (single dark palette; no light variant needed):

### D1. Token values (dark)
```css
:root {
  /* Mail client — re-anchored on the #1b1b1b dark canvas */
  --mail-surface: var(--card);          /* #222222 */
  --mail-rail: #1f1f1f;
  --mail-rail-active: var(--accent);    /* #2e2e2e */
  --mail-line: var(--border);           /* rgba(255,255,255,0.08) */
  --mail-row-hover: #262626;
  --mail-row-selected: #2e2e2e;
  --mail-strong: var(--foreground);     /* #f4f4f5 */
  --mail-muted: var(--muted-foreground);/* #a1a1aa */
  --mail-unread: #8ab4f8;
  --mail-draft: #f28b82;
  --mail-connected: #4ade80;
  --mail-chip: #2e2e2e;
  --mail-chip-foreground: #c6c4bf;
  --mail-tag-important: #4a2320;
  --mail-tag-important-foreground: #f6aea9;
  --mail-tag-newsletter: #46330f;
  --mail-tag-newsletter-foreground: #fdd663;
  --mail-tag-calendar: #38254c;
  --mail-tag-calendar-foreground: #d7aefb;
  --mail-recipient: #8ab4f8;
  --mail-recipient-surface: rgba(138, 180, 248, 0.14);
  --mail-compose-chrome: #262626;
}
```
Register them in `@theme inline` (`--color-mail-*`) exactly as topple does, so `bg-mail-surface`,
`text-mail-strong`, `border-mail-line`, etc. resolve.

### D2. Utilities to add (topple has these; app-server does not)
- `.scrollbar-none`
- `.surface-ai-gradient` (keep topple's orange→violet ramp for AI-authored affordance)
- `.surface-primary-gradient` (dark variant: `linear-gradient(180deg,#333 0%,#111 100%)` is *lighter* than
  the canvas — instead use `bg-primary text-primary-foreground`, or a subtle `#2e2e2e → #262626` ramp)
- `.shadow-row`, `.shadow-fab`

### D3. Adapt component classes
Replace light-only assumptions while porting:
- Compose "Compose mail" button: `surface-primary-gradient … text-white` → `bg-primary text-primary-foreground`
  (Lunabox primary is light-on-dark).
- `bg-card`/`border-border`/`text-foreground` already map; keep them.
- Keep `rounded-[10px]` card frame so the client reads as one surface inside `AppShell`.

---

## Part E — Route + shell wiring

### E1. New route
- `app/mail/layout.tsx` — session + onboarding guard (copy `app/inbox/layout.tsx`), render
  `<AppShell sidebar={<MailNavSidebar/>}>`, and `after()` a best-effort `ensureMailboxForUser` + `kickDrain`.
- `app/mail/page.tsx` — render `<MailScreen/>` (client).
- `app/mail/[id]/page.tsx` — optional deep link that opens a message (set store `openId`).

`MailScreen` must fill the shell's main column: `flex min-h-0 flex-1`.

### E2. Navigation
- `components/app-shell/app-sidebar.tsx` → add `{ href: "/mail", label: "Mail", icon: Mail, match: "/mail" }`
  to `PRIMARY_NAV` (above Inbox).
- New `components/mail/mail-nav-sidebar.tsx` = `AppSidebar` with the contextual compose button + view
  list, **or** reuse the mail client's own internal `MailSidebar` and pass a plain `AppSidebar` to the
  shell (decide during build; topple renders its own in-screen sidebar, so the shell sidebar can stay the
  primary nav).
- `components/app-shell/command-palette.tsx` → add a "Mail" destination and a "Compose" action.

### E3. Sidebar badges (optional)
Compute a live unread count for the Mail nav item (e.g. from `/api/v1/mail/profile` `messagesTotal` or a
lightweight `in:unread` count), or reuse the triage `counts.unread`.

---

## Part F — `.env` and keys runbook (get running & testing)

> `.env.example` currently contains a **real Neon password and a real Google client secret** (flagged in
> `docs/plans/lunabox-whatsapp-email-infra.md`). Rotate both and scrub the file before pushing. Never commit
> real values.

### F1. Required for the app to boot
| Key | Where to get it |
|---|---|
| `DATABASE_URL` | Neon dashboard → Project → Connection string (pooled, `?sslmode=verify-full`) |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | `http://localhost:3000` locally |
| `NEXT_PUBLIC_BETTER_AUTH_URL` | same as above |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud Console → APIs & Services → Credentials → OAuth client (Web) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash console → Redis → REST API |

`lib/env.ts` validates these at import — the app throws a readable error if any is missing.

### F2. Google Cloud setup (once)
1. **Create/select a project** at console.cloud.google.com.
2. **Enable APIs**: Gmail API, Google Calendar API, Cloud Pub/Sub API.
3. **OAuth consent screen** → External → **Testing** → add your Gmail as a **test user**.
   Gmail scopes are *restricted*; stay in Testing until Google verification + CASA.
4. **OAuth client (Web application)** → Authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google` (Better Auth)
   - `http://localhost:3000/api/onboarding/sync-email/complete`
   - Add the deployed equivalents too.
5. Copy client id/secret into `.env`.
6. The onboarding "sync your inbox" step requests `gmail.modify`, `gmail.send`,
   `calendar.readonly`, `calendar.events` (see `lib/onboarding/constants.ts`).

### F3. Pub/Sub (real-time; optional for local testing)
1. Cloud Pub/Sub → **Create topic** `gmail-inbox`.
2. Topic → Permissions → add principal `gmail-api-push@system.gserviceaccount.com` → role
   **Pub/Sub Publisher**.
3. **Create subscription** on the topic → Delivery type **Push** → endpoint
   `https://<your-domain>/api/webhooks/gmail` → **Enable authentication** with a service account and set
   the **audience** to the same URL.
4. `.env`:
   ```
   GOOGLE_PUBSUB_TOPIC="projects/<project-id>/topics/gmail-inbox"
   GOOGLE_PUBSUB_AUDIENCE="https://<your-domain>/api/webhooks/gmail"
   CRON_SECRET="$(openssl rand -base64 32)"
   ```
   Pub/Sub needs a **billing account** even on free tier.

**Local dev without Pub/Sub:** skip F3. After Part A, the mail client works live from Gmail and the triage
inbox fills via the **"Sync now"** button (`mailbox_sync`) and the daily cron. To test the webhook
locally, expose the app with `ngrok http 3000` and point the push subscription at the ngrok URL.

### F4. AI (triage, drafts, AI compose)
| Key | Notes |
|---|---|
| `OPENCODE_API_KEY` | OpenCode Console service-account key (free to create). Without it the app falls back to a deterministic response and triage uses the heuristic classifier. |
| `AI_BASE_URL` | OpenAI-compatible base URL; defaults to `https://opencode.ai/zen/v1`. |
| `AI_MODEL_ID` | Model id; defaults to `space-bunny-free`. Free ids end in `-free`; swap to a paid id like `deepseek-v4-flash` when you want more quality. |
| `AI_MODEL_CLASSIFIER_ID` / `AI_MODEL_DRAFT_ID` | optional cheap/draft models |
| `AI_DAILY_BUDGET` | per-user daily model-call cap (default 500) |

### F5. Optional
- `NEXT_PUBLIC_BOOKING_URL` — meeting fallback link.
- `NEXT_PUBLIC_CAL_BOOKING_LINK` — onboarding book-a-call step.

### F6. Run it
```bash
npm install
npm run db:migrate        # apply drizzle migrations
npm run dev               # http://localhost:3000
```
Then:
1. Sign in with Google (test user).
2. Onboarding → "Sync your inbox" → grant the four scopes → finish.
3. Open **`/mail`** — messages load live from Gmail.
4. Open **`/inbox`** — press **Sync now**; the triage inbox fills from the mirror.
5. `npm test` — onboarding + ai-chat + email-operator smoke suites.

### F7. Verify the DB (should no longer be empty)
```bash
node -e 'require("dotenv").config();const{Client}=require("pg");(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();for(const t of ["mailboxes","threads","messages","thread_states"]){console.log(t,(await c.query(`select count(*)::int n from ${t}`)).rows[0].n)}await c.end()})()'
```

---

## Phase checklist

### Phase A — Sync fix (unblocks data)
- [ ] A1 mailbox bootstrap in `sync-email/complete`
- [ ] A2 `mailbox_sync` kind + handler + registration
- [ ] A3 `syncInbox` enqueues `mailbox_sync`
- [ ] A4 `ensureMailboxForUser` self-heal in inbox/mail layouts (+ optional cron)
- [ ] A5 cron triage enqueue after backfill
- [ ] A6 phase1 test extension

### Phase B — Live Gmail API
- [ ] B1 `gmailJson` 204 handling
- [ ] B2 `lib/mail/service.ts` port
- [ ] B3 `bcc` in `mime.ts`; `/send` via `sendEmail`; `/drafts`
- [ ] B4 `POST /api/v1/mail/draft` (AI)
- [ ] B5 routes under `app/api/v1/mail/**`

### Phase C — UI port
- [ ] C1 add `zustand` + `components/ui/skeleton.tsx`
- [ ] C2 store + `lib/mail/client.ts`
- [ ] C3 components under `components/mail/**`
- [ ] C4 compose + AI draft wiring

### Phase D — Theme
- [ ] D1 `mail-*` tokens + `@theme inline`
- [ ] D2 utilities (`scrollbar-none`, gradients, shadows)
- [ ] D3 class adaptations

### Phase E — Route/shell
- [ ] E1 `app/mail/{layout,page}.tsx`
- [ ] E2 nav + command palette
- [ ] E3 unread badge

### Phase F — Env
- [ ] F1–F5 fill `.env`, rotate leaked secrets
- [ ] F6 run + smoke test
- [ ] F7 verify DB counts
