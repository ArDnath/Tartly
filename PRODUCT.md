# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Engineering Core

The primary engineering artifact is **Tartly Flow Runtime**
(`packages/flow-runtime`): a dependency-free, deterministic step-graph runtime
with a durable checkpoint journal, resume/replay, guarded edges, and
cycle/step-ceiling guards. It validates a graph before any side effect, records
the post-node state and the edge actually chosen before advancing, and replays a
journal without re-invoking completed steps.

The email operator is the runtime's **reference application**. It supplies the
step registry and Postgres journal adapter (`lib/engine/runtime-adapter.ts`);
the inbound-email pipeline is a production 16-node graph executed by the core.
The boundary is documented in `CORE.md` and enforced by imports: the runtime
imports nothing from the application.

## Users

Solo founders and operators: individuals who live in their inbox and personally
do the routine work of email — triaging, deciding, replying, scheduling, and
following up. They are comfortable with software, want the busywork handled, and
are unwilling to give up the final say over what leaves their mailbox.

## Product Purpose

Tartly exists to get a person's inbox handled while keeping them in control. It
triages incoming mail, drafts replies in the user's voice, finds and books meeting
times, and chases threads that have gone quiet. Success is "inbox handled, control
kept": the routine work is done for the user, and no outgoing message surprises
them.

## Positioning

A **full email client with an AI operator built in**, not a bolt-on assistant.
`/mail` is a complete, live mail client for Gmail and Outlook (folders, labels
and categories, search, compose, read/star/archive/trash) and the AI rides on
top of it: `/inbox` is the triage
surface and the agent can operate the mailbox through tools. The operator is
**approval-first by default** — it drafts and proposes, the user approves and
sends — with an explicit **autopilot** mode that may send on its own only when
the send gate and guardrails pass. The product is also the reference
application for the repository's reusable flow runtime; the runtime is the
engineering core, and the operator proves it under real mail, scheduling, and
send-gate constraints.

## Operating Context

- Gmail and Outlook for mail (both can be connected at once and merged into one
  shared inbox with an All / Gmail / Outlook filter). Google Calendar supplies
  availability and events; Outlook calendar support is not part of this surface
  yet.
- Onboarding: sign-in → create profile → connect Gmail and/or Outlook → meeting
  preferences, then into the app.
- A single **send gate** (`egress`) reads mailbox autonomy and per-contact
  overrides. `copilot` (the default) never sends silently; `autopilot` is opt-in
  and still subject to guardrails and the idempotent send ledger.
- Autonomy is configurable (copilot vs. autopilot, working hours, timezone,
  meeting duration/buffer, per-contact overrides).
- Runs on the open web in any modern browser; OAuth and the session cookie are
  pinned to one canonical origin.

## Capabilities and Constraints

Confirmed and durable: live Gmail and Outlook clients merged into one shared
inbox; AI triage views (Needs you / Waiting on them / Handled) over both
mailboxes; voice-matched drafts with a single approval gate; meeting detection,
slot-finding, and booking with Google Meet links; follow-up tracking with stop
rules; a tool-using agent that can search, read, draft, send (with
confirmation), schedule, and research on either mailbox; activity/runs
observability. Sending is gated so it is safe to retry (idempotency via
`send_ledger` / `event_log`). Provider access is scope-limited and approved
separately from sign-in.

**24/7 Autopilot** extends the send gate with an opt-in mailbox policy. When it
is enabled, Tartly may send safe replies on its own inside a window the user
chooses (mode, timezone, days, hours), subject to a minimum confidence, a
known-sender requirement, a category allowlist, per-hour/day/thread caps and loop
protection. Any guardrail violation, unknown category/confidence, or error
resolves to a draft. It is off by default, adds no OAuth scopes, and can be
paused per mailbox or disabled platform-wide with `AUTOPILOT_ENABLED=false`. Every
evaluation is audited in `autopilot_decisions` — reason codes and boolean checks
only, never message content.

## Brand Commitments

- Name: **Tartly**. Support contact: support@tartly.in.
- Voice: calm, plain-spoken, control-oriented. It explains permissions and
  consequences honestly and never implies more autonomy than the user granted.
- Approval is framed as a promise, not a limitation: "nothing leaves your inbox
  without your approval" describes the default mode.

## Evidence on Hand

Real content exists for the marketing surface: benefit copy, the permissions list,
and the data/privacy promises. There are **no** real testimonials, customer logos,
usage benchmarks, press mentions, or third-party endorsements — future work must
not fabricate them.

## Product Principles

1. **Approval is the default; autonomy is earned and explicit.** The product's
   promise is control. Any automatic action is an opt-in mode with visible
   guardrails, never a silent default.
2. **The inbox is the product, not a backdrop.** The full-fidelity mail client is
   first-class; the AI augments it rather than hiding it.
3. **Do real work on real data, honestly.** Every number a screen shows is derived
   from rows the runtime actually wrote; nothing is invented or embellished.
4. **Two real mailboxes, one inbox.** Gmail and Outlook are full peers for mail;
   the AI works on whichever account the message belongs to. Coverage stops at
   those two providers rather than spreading thin across every protocol.
5. **Privacy is a feature contract.** Limited scopes, separate consent for inbox
   access, no data selling, no ad use.
