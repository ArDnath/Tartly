# Chat attachments: PDFs and images in the AI composer

## What changed

- **A "+" button in the AI composer.** The assistant input now stages up to six
  files per turn. Files can be picked, dragged onto the composer, or pasted;
  each appears as a removable chip until the turn is sent.
- **Files land in the asset library.** The browser hashes each file, gets a
  scoped upload ticket, streams bytes directly to object storage, and registers
  the asset. Bytes never pass through a function, and the same file dedupes.
- **The agent can read them.** Images are sent to the vision model as image
  content. PDFs are parsed server-side with `unpdf`; text, HTML, JSON, XML and
  CSV use the existing extractors. Document text is bounded per file and per
  turn so a large attachment cannot crowd out the conversation.
- **Context survives follow-ups.** The newest image-bearing turn is kept in
  context, and extracted document text is available on later turns. Only an
  owner-scoped asset id is persisted, never base64 bytes.
- **Trust boundary.** Attachment content is explicitly labelled as data in the
  prompt, with delimiter neutralization, and the system prompt tells the model
  never to follow instructions found inside a file. Infected assets (scan
  `enforce`) and unsupported image formats are never sent to the model.

## Configuration

No new variables are required. `ASSETS_ENABLED`, the configured storage driver
(`ASSET_STORAGE_DRIVER`), `ASSET_MAX_BYTES`, and `ASSET_ALLOWED_MIME` govern
uploads exactly as they already did for Settings → Assets. `ASSET_EXTRACT_ENABLED`
(cache extracted text at rest) is optional; PDFs are parsed on demand when it is
off.

`unpdf` requires Node 22, which matches the application and container runtime.

## Verification

- `npx tsc --noEmit`
- `npx vitest run tests/unit` (296 tests)
- `npm run openapi:check`
- `npm run build`
