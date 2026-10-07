# 2026-10-05 — Gmail-style conversation threading in Mail

## What changed

The live mail client (`/mail`) now shows **conversations**, not a flat list of
messages — the way Gmail does.

- **Threaded list.** Rows are grouped by Gmail `threadId`. A conversation with
  several messages collapses to one row: the participant names, the base subject
  (reply/forward prefixes stripped), the newest snippet, a message count, and
  aggregate unread / starred / attachment state. Unread if *any* message is.
- **Full-thread reader.** Opening a row fetches the whole conversation from
  Gmail (`GET /api/v1/mail/threads/{id}`) so it includes messages the current
  view no longer carries (an archived reply, say). Messages render oldest first,
  the newest expanded and the rest collapsed to a line, exactly as Gmail does;
  each message can be expanded or collapsed. Reply / Reply all / Forward act on
  the newest message.
- **Conversation-scoped actions.** Archive, delete, snooze, spam, label, star
  and read operate on every message in the thread. The selection bar counts
  conversations, and `x` / select-all select whole conversations.
- **Read on open.** Opening a conversation clears its unread state in Gmail in
  one `batchModify`, the same way Gmail marks a thread read.
- **Deep links preserved.** `/mail/[id]` resolves a message id to its
  conversation, and also accepts a bare thread id.

## Notes

- Grouping is client-side over the existing metadata page, so no extra Gmail
  round trip is paid for the list. The per-row message count reflects the
  messages visible in the current view; the reader is authoritative for the full
  thread.
- `MailMessage` gained the required `threadId` field; new `MailConversation`
  and `MailThread` types back the grouping and reader.
