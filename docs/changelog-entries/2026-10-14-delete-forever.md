# 2026-10-14 — Delete forever: permanent delete from Trash (and by the agent)

## What changed

Mail could only ever be *trashed* (reversible for 30 days); there was no way
to delete for good. Gmail's permanent delete needs a scope the app did not
request — `gmail.modify` is documented as never allowing "immediate, permanent
deletion of threads and messages, bypassing the trash". So this adds the
restricted full-mailbox scope (`https://mail.google.com/`) to the connect flow
and builds permanent delete end to end.

- **Scope.** `GOOGLE_PERMANENT_DELETE_SCOPE` is added to `GOOGLE_CONNECT_SCOPES`
  (`lib/onboarding/constants.ts`), so the connect page, the settings panel, the
  list's reconnect button, and the onboarding verification all pick it up. An
  existing grant that lacks it surfaces as the usual `403 gmail_not_connected`
  → "reconnect", which re-requests the wider scope.
- **Gmail.** `deleteMessages` (chunked `messages.batchDelete`) and `emptyTrash`
  (list `in:trash` → batch-delete) in `lib/mail/service.ts`. No new route holds
  a raw `messages.delete` per-id loop.
- **Outlook.** `deleteOutlookMessages` / `emptyOutlookTrash` use Graph's
  `POST /me/messages/{id}/permanentDelete` and list Deleted Items.
- **BFF.** `POST /api/v1/mail/messages/delete` and `POST /api/v1/mail/trash/empty`
  (`deleteMessagesUnified`, `emptyTrashUnified`), plus contracts and client
  helpers. Spec regenerated.
- **Web UI.** In the Trash view "Delete" becomes "Delete forever" (row hover,
  reader, bulk selection bar) and an **Empty trash** button with a confirm
  dialog appears in the toolbar. `deleteForever` removes rows from the union
  with no Undo; `emptyTrash` clears Trash and invalidates its cached page.
- **Agent.** `delete_email` gains `permanent: false` (default). It stays
  `EXTERNAL_SIDE_EFFECT`, so the model can only *propose* it and the existing
  confirmation gate holds; `permanent: true` routes to
  `EmailService.deleteMessageForever`. The confirmation and result cards show a
  distinct "Confirm permanent delete" / "Permanently deleted" state and an
  irreversible warning.

## Not changed

- Trash itself stays the default "delete" everywhere; nothing auto-deletes.
- The agent still cannot permanently delete without a confirmed user action.

## Verification

`npx tsc --noEmit` · `npx eslint` (changed files) · `npx vitest run` (260) ·
`npm run test:agent:phase2|phase6|evals` (new permanent-delete assertions) ·
`npm run openapi:check`.
