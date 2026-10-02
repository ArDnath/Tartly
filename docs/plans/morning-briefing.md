# Plan — Interactive Morning Briefing, unified inbox buckets, promises, gating, per-thread autonomy

Status: refined (v2) · Scope: the "killer UX" + the four pipeline gaps + per-thread autonomy
Hard rule: **additive and non-disruptive.** No existing route path changes; legacy
`?view=needs_you|waiting|handled` deep links keep working as aliases. All outbound mail keeps going
through the `egress` gate and `lib/gmail/send.ts`. Guardrails still force a draft regardless of any
autonomy level.

---

## 0. Product goal

Open the app and instead of 73 unread emails, the agent has a **Briefing conversation** waiting:

```
Good morning Ariyaman. You have 6 things worth your attention.

1. Investor replied
   AI summary: They want your updated traction numbers.
   Draft prepared: "Hey John, absolutely. We're currently at..."
   [Send] [Edit]

2. Client hasn't responded
   You emailed Rahul 4 days ago about the proposal.
   Suggested follow-up: "Hey Rahul, just wanted to check..."
   [Send] [Tomorrow] [Ignore]

3. Meeting tomorrow
   You have a meeting with X at 11:00.
   AI prepared: previous conversations · outstanding questions · last proposal ·
   relevant emails · meeting objective · suggested agenda
   [View brief]
```

And you can just reply in that thread — *"tell me more about #1"*, *"autopilot this thread"*,
*"push Rahul to next week"* — because it is a normal agent conversation.

Sidebar buckets: **Needs reply · Waiting on someone · Follow up today · Meetings · AI handled ·
FYI.**

### Decisions locked (from review)

| Question | Decision |
|---|---|
| Briefing home | **Interactive briefing thread** in the agent sidebar — a real conversation the agent posts into; you can reply and keep chatting. No separate `/today` route. |
| Overdue promises | **Surface both** directions; **draft on overdue** (chaser if they owe us, reminder if we owe them). |
| Bucket overlap | **Mutually exclusive** by precedence, so counts equal lists. |
| Auto-memory | **Off by default**; opt-in in Settings. |
| Briefing [Send] | Immediate manual send (an explicit click is approval). Background sends still obey autonomy. |
| Per-thread Autopilot | **Strongest override, both directions**, and it steers the background inbound operator too (see Phase 2). |

### What already exists (reuse, don't rebuild)

- Agent chat: `agent_chat_thread` / `agent_chat_message` with a `isWorkspaceSetup` special-thread
  precedent (`lib/db/schema.ts`), conversation route
  `app/api/v1/agent/conversations/[conversationId]/route.ts`, cards in
  `components/assistant/cards/*`, rich message parts in `agent-message.tsx`.
- Digest engine `lib/ai/features/digest.ts`; meeting briefs `lib/ai/features/meeting-brief.ts`
  (route already exists); thread summaries `lib/ai/features/summarize-thread.ts`; reply memory
  `lib/ai/features/reply-memory.ts`; follow-ups `lib/followup/*`; single send gate
  `lib/engine/steps/egress.ts`; 3-bucket inbox `lib/inbox/service.ts`.

---

## 1. Data model (`lib/db/schema.ts`)

### 1.1 New: commitments

```ts
export const COMMITMENT_DIRECTIONS = ["we_owe", "they_owe"] as const;
export const COMMITMENT_STATUSES = ["open", "fulfilled", "cancelled", "expired"] as const;
export type CommitmentDirection = (typeof COMMITMENT_DIRECTIONS)[number];

export const commitments = pgTable(
  "commitments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    threadId: text("thread_id").references(() => threads.id, { onDelete: "set null" }),
    contactEmail: text("contact_email"),
    direction: text("direction").$type<CommitmentDirection>().notNull(),
    description: text("description").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: text("status").notNull().default("open"),
    sourceMessageId: text("source_message_id").references(() => messages.id, { onDelete: "set null" }),
    confidence: text("confidence"),
    /** Last nudge attempt, so the chaser job is idempotent + bounded. */
    nudgedAt: timestamp("nudged_at", { withTimezone: true }),
    nudgeCount: integer("nudge_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    index("commitments_user_status_idx").on(t.userId, t.status, t.dueAt),
    index("commitments_thread_idx").on(t.threadId),
    index("commitments_contact_idx").on(t.userId, t.contactEmail),
  ],
);
```

### 1.2 New: per-thread settings (autonomy + pin)

```ts
export const threadSettings = pgTable(
  "thread_settings",
  {
    threadId: text("thread_id").primaryKey().references(() => threads.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    /** null = inherit contact → mailbox. "copilot" | "autopilot" wins both ways. */
    autonomy: text("autonomy"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [index("thread_settings_user_idx").on(t.userId)],
);
```

### 1.3 Additive columns

- `drafts.sentBy: text("sent_by")` — `"user" | "ai" | null`. Powers the **AI handled** bucket.
- `agent_chat_thread.kind: text("kind").notNull().default("chat")` — `"chat" | "briefing"`.
  Partial unique index `(user_id) where kind = 'briefing'` gives one persistent briefing thread.
- `assistantSettings`: `briefingEnabled boolean default true`, `briefingHour integer default 8`,
  `commitmentsEnabled boolean default true`, `memoryAutoExtract boolean default false`.

Migration: `npm run db:generate` → commit SQL → `npm run db:migrate`.

---

## 2. Phase 1 — Action gating + per-thread autonomy

### 2.1 Action-required gate

`lib/engine/flow.ts` `buildInboundEmailGraph()`: triage already emits `action ∈ {draft, none,
handoff}` but the flow drafts everything. Add an `extract-commitments` node and a gate:

```jsonc
{ "from": "u", "to": "cm", "when": { "field": "action", "notEquals": "none" } }, // apply-rules → commitments
{ "from": "u", "to": "r",  "when": { "field": "action", "equals": "none" } },    // straight to log-trace
{ "from": "cm", "to": "m" },
```

`nextNode` returns the first matching edge; conditions are mutually exclusive.

### 2.2 Per-thread autonomy precedence

`lib/engine/steps/egress.ts` currently reads mailbox then contact. New precedence (all levels
override both ways):

```
thread_settings.autonomy  >  contacts.autonomyOverride  >  mailboxes.autonomy  >  "copilot"
```

Guardrails (`forcedDraft`) still force a draft at every level. Update `lib/settings/autonomy.ts`
with `getThreadAutonomy`, `setThreadAutonomy`, and return thread overrides from
`getAutonomySettings`.

### 2.3 API + UI + tool

- `GET/PATCH /api/v1/threads/[threadId]/autonomy` — `Vary: { autonomy: "copilot"|"autopilot"|null }`.
- Generalize `components/assistant/mailbox-autonomy.tsx` into an `AutonomySwitch` that takes a
  scope (`mailbox` | `contact` | `thread`). Mount on `components/inbox/thread-view.tsx` and the
  mail reader header so any conversation can be flipped.
- Agent tool `set_thread_autonomy` (WRITE, reversible) in `lib/agent/tools/` — lets the user say
  *"autopilot this thread"* in the briefing conversation.

**Acceptance:** a Copilot mailbox with a thread set to Autopilot auto-sends on that thread's next
inbound; a Copilot thread on an Autopilot mailbox always drafts; a guardrail violation still
drafts.

---

## 3. Phase 2 — Promises / commitments

- New step `lib/engine/steps/extract-commitments.ts` (`best_effort`): one `fast` `generateObject`
  call over the thread → ≤3 `{ direction, description, dueAt, confidence }`; dedupe open rows by
  `(threadId, description)`; honors `commitmentsEnabled`.
- New `lib/commitments/service.ts`: `listOpenCommitments`, `extractCommitmentsForThread`,
  `fulfillCommitment`, `dismissCommitment`, `resolveOpenCommitmentsForThread`, and
  `enqueueDueCommitments()`.
- **Recall:** `buildDraftContext` (`draft-context.ts`) gains a commitments block injected into
  `draft-reply`; also injected into `followup-draft.ts` and `meeting-brief.ts` open items.
- **Overdue drafting:** `enqueueDueCommitments()` runs in the daily cron (and the follow-ups
  cron on Pro). For each open commitment past `dueAt` and under a nudge cap, it creates/refreshes a
  pending draft on the thread — a chaser when `they_owe`, a reminder when `we_owe`. It never sends
  directly; the draft goes through `egress`. Sends keyed idempotently on
  `commitment:<id>:<nudgeCount>` via `send_ledger`.
- Agent tool `get_commitments` (READ).
- Manual `fulfill`/`dismiss` routes: `POST /api/v1/commitments/[id]/fulfill|dismiss`.

**Acceptance:** a promise made in a thread shows in the next draft's context; an overdue promise
surfaces a chaser/reminder in the briefing the next morning, sent only if that thread is Autopilot
and guardrails pass.

---

## 4. Phase 3 — Unified 6-bucket inbox

Extend `lib/inbox/service.ts`:

```ts
export type InboxView =
  | "needs_you" | "needs_reply" | "waiting" | "follow_up_today"
  | "meetings" | "ai_handled" | "fyi" | "handled"; // handled → alias for fyi, needs_you → needs_reply
```

Precedence (first match wins, so counts == lists):

1. `needs_reply` — `category ∈ {needs_reply, meeting_request}` or `action = handoff`
2. `follow_up_today` — active enrollment with `nextEvalAt <= endOfLocalDay(now)`
3. `meetings` — upcoming `meetings.startAt >= now`, or `meeting_request` with an active proposal
4. `waiting` — `category = awaiting_reply` or `replyStatus = awaiting_them`
5. `ai_handled` — latest outbound is `drafts.sentBy = 'ai'`, no newer inbound (window 7 days)
6. `fyi` — `category ∈ {fyi, invoice, newsletter, spam}`

`getInboxCounts` returns all six; `matchesView` mirrors the same precedence for JS bucketing.
Also update: `components/inbox/inbox-sidebar.tsx`, `inbox-view.tsx` (`VIEW_META`, tabs),
`app/inbox/page.tsx` `parseView`, `app/api/v1/inbox/route.ts` enum.

**Acceptance:** sidebar counts equal listed rows; `?view=handled` still renders FYI.

---

## 5. Phase 4 — Automatic memory (opt-in)

- New step `lib/engine/steps/update-memory.ts` (`best_effort`), runs after send/draft.
- New `extractMemoriesFromExchange({ incoming, reply })` in `reply-memory.ts`, reusing the existing
  durability rules/scopes but reading the exchange instead of a draft diff.
- Gated by `assistantSettings.memoryAutoExtract` (**default false**).
- Existing edit-based learning in `approveDraft` is unchanged.

**Acceptance:** with the toggle off, byte-for-byte current behavior; on, a recurring fact is stored
once and appears in later drafts.

---

## 6. Phase 5 — The interactive briefing thread

### 6.1 Composition service

`lib/briefing/service.ts` → `buildBriefing(userId, now)` (deterministic, cheap, cached in Redis
10 min):

```ts
type Briefing = {
  greeting: { name: string; total: number };
  counts: InboxCounts;               // six buckets
  replies:   Array<{ threadId; from; subject; summary; draft: { id; body } | null; commitments }>;
  followups: Array<{ enrollmentId; threadId; from; subject; dueAt; lastSentAt; draft: { id; body } | null }>;
  promises:  Array<{ commitmentId; threadId; direction; description; dueAt; draft: { id; body } | null }>;
  meetings:  Array<{ meetingId; subject; startAt; meetLink; brief: MeetingBrief | null }>;
};
```

Sources: `listInbox({ view: "needs_reply" })` + pending drafts + `summarizeThread`; due
enrollments + `enqueueDueFollowups`; `listMeetings` (next 48h) + `generateMeetingBrief`; open
`commitments`.

### 6.2 Extend the meeting brief

`lib/ai/features/meeting-brief.ts` schema/prompt gain `objective`, `agenda[]`,
`outstandingQuestions[]`, `lastProposal`, `relevantEmails[{threadId, subject, when}]`; open
commitments fold into `openItems`. Bump `MEETING_BRIEF_VERSION` (cache already keys on day).

### 6.3 The briefing conversation

- Reuse `agent_chat_thread`. Add `kind = "briefing"`; ensure one per user (partial unique index),
  pinned at the top of the agent sidebar.
- **Seeding:** `lib/briefing/thread.ts` → `ensureBriefingThread(userId)` and
  `postBriefingMessage(userId, briefing)`. The daily cron calls both (throttled by
  `briefingHour`), and opening the sidebar/thread lazily calls `ensureBriefingThread`.
- **Message parts:** extend `ChatMessagePart` with a `briefing` part:

```ts
export type ChatBriefingPart = {
  type: "briefing";
  kind: "reply" | "followup" | "promise" | "meeting";
  threadId?: string;
  draftId?: string;
  enrollmentId?: string;
  commitmentId?: string;
  meetingId?: string;
  title: string;
  subtitle?: string;
  summary?: string;
  body?: string;          // prepared draft text
  brief?: MeetingBrief;   // meetings only
  actions: Array<"send" | "edit" | "tomorrow" | "ignore" | "view_brief">;
};
```

The agent posts one assistant message whose parts are the greeting text + a `briefing` part per
card. Rendering: new `components/briefing/*` wired into `agent-message.tsx` (same pattern as the
existing `cards/*`).

- **Interactivity:** the composer is the normal agent chat. Follow-up questions ("tell me more
  about #1", "autopilot this thread") are answered with the existing tools plus
  `set_thread_autonomy`, `get_commitments`, and `create_followup`.
- **Actions:**
  - **[Send]** → `approveDraft` (immediate manual send; explicit click = approval).
  - **[Edit]** → opens the draft in the existing draft editor.
  - **[Tomorrow]** → `POST /api/v1/followups/[id]/snooze { days: 1 }` (new).
  - **[Ignore]** → `POST /api/v1/followups/[id]/stop` (exists).
  - **[View brief]** → `GET /api/v1/meetings/[id]/brief` (exists), shown in a sheet.

### 6.4 Routes

| Route | Status |
|---|---|
| `GET /api/v1/briefing` | new (payload; used by CLI/tests and the cron post) |
| `GET /api/v1/agent/conversations/[conversationId]` | exists (rehydrates the thread) |
| `GET /api/v1/meetings/[id]/brief` | exists, fields extended |
| `POST /api/v1/followups/[id]/snooze` | new |
| `POST /api/v1/drafts/[id]/approve` | exists |
| `POST /api/v1/commitments/[id]/fulfill|dismiss` | new |

### 6.5 Cron

`runDailyMaintenance()` additionally calls `ensureBriefingThread` + `maybePostBriefing(userId)`
(throttled by `briefingHour`), so the 8:30 screen is pre-populated. A live open still works if the
cron missed.

**Acceptance:** the sidebar shows a pinned **Briefing** conversation; opening it shows the card
types with working Send / Edit / Tomorrow / Ignore / View brief; replying with a question returns a
tool-grounded answer; total equals the six-bucket sum.

---

## 7. Phase 6 — Polish & observability

- Metrics: `aiHandled`, `promisesOpen`, `briefingCards`, `briefingActions`.
- Reuse `buildFallbackDigestNarrative` for the briefing headline.
- Settings: `briefingEnabled`, `briefingHour`, `commitmentsEnabled`, `memoryAutoExtract`.
- Tests (`scripts/…`, matching the existing suite): gating (`action=none` → no draft), autonomy
  precedence, commitment extraction/dedupe/injection, bucket predicate parity, briefing composition
  with no model, memory opt-in on/off.

---

## 8. File-by-file summary

**New**
- `lib/commitments/service.ts`, `lib/briefing/service.ts`, `lib/briefing/thread.ts`
- `lib/engine/steps/extract-commitments.ts`, `lib/engine/steps/update-memory.ts`
- `components/briefing/{briefing-card,reply-card,followup-card,promise-card,meeting-card,meeting-brief-sheet}.tsx`
- `app/api/v1/briefing/route.ts`
- `app/api/v1/threads/[threadId]/autonomy/route.ts`
- `app/api/v1/followups/[id]/snooze/route.ts`
- `app/api/v1/commitments/[id]/{fulfill,dismiss}/route.ts`
- `lib/agent/tools/{get-commitments,set-thread-autonomy}.ts`
- migration SQL under `drizzle/`

**Edited**
- `lib/db/schema.ts` (commitments, thread_settings, columns)
- `lib/engine/flow.ts` (gate + nodes); `lib/engine/steps/send-email.ts` (`sentBy="ai"`)
- `lib/engine/steps/egress.ts` + `lib/settings/autonomy.ts` (thread precedence)
- `lib/inbox/service.ts`; `components/inbox/*`; `app/inbox/page.tsx`; `app/api/v1/inbox/route.ts`
- `lib/ai/features/{draft-context,draft-reply,followup-draft,meeting-brief,digest}.ts`
- `lib/email-operator/cron.ts` (briefing warm + due commitments)
- `components/assistant/{mailbox-autonomy,agent-message}.tsx` (scoped switch; briefing parts)
- `lib/env.ts` + `.env.example`

---

## 9. Risks & decisions

- **Bucket overlap** → solved by the precedence ladder; counts and lists share one function.
- **`ai_handled` needs history** → only possible after `drafts.sentBy` ships (Phase 1); capped to a
  7-day window.
- **Three autonomy levels can confuse** → the switch always shows the *effective* mode and where it
  comes from (thread/contact/mailbox), so "separation of intent" stays legible.
- **Auto-send safety unchanged** → nothing bypasses `egress`; thread Autopilot + guardrails still
  govern, and manual clicks on briefing cards are explicit approvals.
- **Briefing thread growth** → one persistent thread, briefing messages pruned/summarized like chat
  via existing compaction; cards link to threads rather than embed everything.
- **Hobby cron** → briefing computed live, cron only warms it: a miss costs latency, not
  correctness.
- **Backward compatibility** → legacy `?view=` aliases retained; no route removed.

---

## 10. v3 — catch-up popup supersedes the briefing thread

Status: shipped. The interactive briefing **conversation** (§6.3) is retired.

Opening the app no longer posts the briefing into a thread. Instead:

1. **Reload popup.** `components/briefing/catch-up-gate.tsx` is mounted once in
   `AppShell`, so it rides along on every app screen. On the first load of the
   local day it fetches `GET /api/v1/briefing` and, when there is anything to
   say, shows a big time-aware card: *"You're late, {name}."* plus
   *"6h past your 8:00 briefing"* and a short preview. "Later" snoozes it for
   the day; "Catch me up" records the day and navigates to
   `/assistant?catchup=1`. Nothing is written to a transcript.
2. **The agent plan.** `?catchup=1` opens a fresh **Catch-up** conversation and
   hands the client the plan (`lib/briefing/catchup.ts` → `buildCatchUp`). The
   plan (`components/briefing/catch-up-plan.tsx`) lists only the options the
   briefing actually supports — Catch me up, Draft the replies, Prep today's
   meetings, Check my promises, Nudge silent threads, Triage my inbox. Choosing
   one sends a real user turn; the agent answers with its tools.
3. **Retired.** `lib/briefing/thread.ts` (ensure/post/refresh) is gone; the
   daily cron no longer warms a thread; `listChatThreads` hides `kind =
   'briefing'` rows. `buildBriefing` is unchanged and still backs the popup.

Copy: the headline is `buildCatchUpHeadline` (lateness beats the daypart
greeting); `lateLabel` appears from `LATE_AFTER_HOURS` (2) past `briefingHour`.
The popup shows only when `total > 0`, so an empty day stays quiet.
