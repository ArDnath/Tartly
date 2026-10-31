# Compose attachments: upload, drafts, forwarding and Outlook

## What changed

- **"Attach a file" now uploads.** The composer uses the same ticket-based
  asset flow as Settings → Assets and the chat composer: the browser hashes the
  file, streams bytes directly to storage, and the server registers, scans and
  extracts it. The resulting asset id is attached to the message; the old
  name-only chips that never sent are gone.
- **Drafts keep their files.** `POST /api/v1/mail/drafts` now accepts
  `assetIds` and `inlineImageIds`, resolves them to bytes at save time, and
  writes a complete MIME draft for Gmail or a Graph draft with attachments for
  Outlook.
- **Forwarding carries the originals.** A forward seeds the composer with the
  original message's attachments. They remain provider references until the
  user sends or saves, then an owner-scoped import copies them through the
  normal asset pipeline (MIME allow-list, size limit, malware scan, dedupe).
  Replies keep standard mail-client behaviour and do not re-attach the
  original files.
- **Outlook sends and drafts support large files.** Small attachments are
  posted directly to the draft; files above 3 MB use a Graph upload session.
  Inline images keep their `cid:`/`contentId` mapping.
- **Bounded and consistent limits.** One shared `MAX_OUTBOUND_ASSETS` (20)
  governs the API contract, the server resolver and both composers. Duplicate
  ids are collapsed, an asset is either attached or inline (never both), and a
  failed send/save reopens the composer instead of dropping the draft.

## Verification

- `npx tsc --noEmit`
- `npm run test:unit` (302 tests)
- `npm run openapi:check`
- `npx eslint` on the touched files
