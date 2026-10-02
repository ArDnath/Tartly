# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Solo founders and operators: individuals who live in their inbox and personally
do the routine work of email — triaging, deciding, replying, scheduling, and
following up. They are comfortable with software, want the busywork handled, and
are unwilling to give up the final say over what leaves their mailbox.

## Product Purpose

Lunabox exists to get a person's inbox handled while keeping them in control. It
triages incoming mail, drafts replies in the user's voice, finds and books meeting
times, and chases threads that have gone quiet. Success is "inbox handled, control
kept": the routine work is done for the user, and no outgoing message surprises
them.

## Positioning

A **full email client with an AI operator built in**, not a bolt-on assistant.
`/mail` is a complete, live Gmail client (folders, labels, search, compose,
read/star/archive/trash) and the AI rides on top of it: `/inbox` is the triage
surface and the agent can operate the mailbox through tools. The operator is
**approval-first by default** — it drafts and proposes, the user approves and
sends — with an explicit **autopilot** mode that may send on its own only when
the send gate and guardrails pass.

## Operating Context

- Google-only: Gmail for mail, Google Calendar for availability and events. There
  is no Outlook/IMAP integration.
- Onboarding: Google sign-in → create profile → connect inbox + calendar → meeting
  preferences, then into the app.
- A single **send gate** (`egress`) reads mailbox autonomy and per-contact
  overrides. `copilot` (the default) never sends silently; `autopilot` is opt-in
  and still subject to guardrails and the idempotent send ledger.
- Autonomy is configurable (copilot vs. autopilot, working hours, timezone,
  meeting duration/buffer, per-contact overrides).
- Runs on the open web in any modern browser; OAuth and the session cookie are
  pinned to one canonical origin.

## Capabilities and Constraints

Confirmed and durable: live Gmail client; AI triage views (Needs you / Waiting on
them / Handled); voice-matched drafts with a single approval gate; meeting
detection, slot-finding, and booking with Google Meet links; follow-up tracking
with stop rules; a tool-using agent that can search, read, draft, send (with
confirmation), schedule, and research; activity/runs observability. Sending is
gated so it is safe to retry (idempotency via `send_ledger` / `event_log`). All
Google access is scope-limited and approved separately from sign-in.

## Brand Commitments

- Name: **Lunabox**. Support contact: support@lunabox.app.
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
4. **Google-only, deliberately.** Depth on Gmail + Calendar beats shallow coverage
   of every provider.
5. **Privacy is a feature contract.** Limited scopes, separate consent for inbox
   access, no data selling, no ad use.
