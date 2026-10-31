# Outlook parity for the shared inbox and AI operator

## What changed

- **One shared inbox.** Gmail and Outlook mail are merged newest-first. A new
  All / Gmail / Outlook filter sits in the mail toolbar whenever both mailboxes
  are connected; each scope has its own cached page walk.
- **Outlook is a full mail client.** Graph now backs drafts, labels
  (categories), read/star/archive/trash/spam, permanent delete, empty trash,
  attachments (including inline `cid:` images), folder-aware message boxes, and
  unsubscribe headers.
- **Sending works on both accounts.** Replies go back through the account that
  owns the thread. New messages can be sent from either account, the composer
  shows a From selector, and both paths use the shared send ledger for
  at-most-once delivery. Outlook sends support file attachments and inline
  images.
- **AI parity.** `lib/providers/email/unified-provider.ts` merges both mailboxes
  for `search_emails`, `get_email`, `get_thread`, contacts, drafts and every
  mailbox tool; Outlook ids use the same `outlook:` namespace as the client.
  Agent drafts and sends can target Outlook explicitly, and pending-action
  provider checks are provider-aware.
- **AI triage parity.** Outlook inbox/sent mail is mirrored into the same
  Postgres thread/message tables through a bounded Graph sync. The triage inbox,
  follow-ups, autopilot and briefing paths therefore see both mailboxes, and
  draft approval sends from the right provider.
- **Onboarding.** Connecting Outlook during onboarding now lands on a real
  callback that verifies the mailbox scope, records the provider and advances
  the flow (instead of bouncing back to the connect step).

## Configuration

Outlook stays optional. Set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`
(and `MICROSOFT_TENANT_ID` if not `common`), register
`${BETTER_AUTH_URL}/api/auth/callback/microsoft`, and set
`NEXT_PUBLIC_MICROSOFT_CONNECT_ENABLED="true"`. Existing Google-only
deployments are unchanged.

## Verification

- `npx tsc --noEmit`
- `npm run test:unit`
- `npm run openapi:check`

The Graph transport is injectable throughout (`OutlookTransport`), so the mail
and provider layers can be exercised without a live Microsoft account.
