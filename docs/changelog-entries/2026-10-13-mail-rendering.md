# 2026-10-13 — Mail reader: legible bodies, working images, faster frames

## What changed

Three reader problems shared one root cause — the message body runs in a
`srcdoc` iframe that *inherits the host page's CSP*.

- **Remote images were blocked.** A `srcdoc` document inherits the parent
  policy (CSP3 §7.8), and `buildCsp` allowed only `'self' blob: data:` for
  `img-src`, so every image a message referenced was refused. `img-src` now
  also carries `https:`/`http:` (`lib/security/csp.ts`); in production
  `upgrade-insecure-requests` rewrites `http:` first, and the bare scheme keeps
  local http dev working.
- **Lazy and inline images were missing.**
  - `lib/mail/render-email.ts` (new, pure) promotes `data-src`/`data-srcset`
    placeholders to real `src`/`srcset` — no JavaScript runs in the frame, so
    the swap never happened.
  - Gmail and Outlook inline parts (`Content-ID`) are now mapped onto a
    same-origin byte proxy, so `cid:` images render.
- **Text was hard to read.** Senders author for a light client and often pin
  near-black text with no background, which vanished on the reader's `#222`
  canvas. Two things fix this:
  - The frame `<style>` carries the page's per-request CSP nonce, **and the
    sender's own `<style>` blocks are given the nonce too**. A `srcdoc` document
    inherits the host policy, which (in production) only allows nonced `style`
    elements — so previously a white newsletter's background was stripped while
    its dark text survived, leaving grey-on-dark. Inside the sandboxed,
    scriptless frame a style element can only affect the message, never the app
    UI, so this is safe and the message renders as authored.
  - `hasLightBackground` detects a sender-supplied light surface; when there is
    none the frame forces a readable light-on-dark default, and when there is
    one the sender's palette is left untouched.
- **Newsletters render on a white canvas.** Any message tagged `newsletter`
  opens in a light frame (`#fff`, dark text, `color-scheme: light`), clipped to
  the app's `xl` radius so it reads as a card on the dark reader. This is the
  surface those designs target, so they read correctly without relying on the
  contrast fallback (which applies only to the dark variant).

## New / touched

- `app/api/v1/mail/attachments/route.ts` — authenticated byte proxy for inline
  images. Echoes only image types, always `nosniff`, with an inert CSP so even a
  directly-opened SVG cannot run script on our origin.
- `lib/mail/render-email.ts` — pure `applyStyleNonce`, `promoteLazyImages`,
  `rewriteInlineImages`, `hasLightBackground`.
- `lib/mail/service.ts`, `lib/outlook/service.ts`, `lib/mail/unified.ts` — build
  the inline-image map and the proxy URLs; add `getAttachment` /
  `getOutlookAttachment` / `getUnifiedAttachment`.
- `components/app/mail/mail-html-body.tsx` — contrast fallback; `ResizeObserver`
  sizing (replacing three fixed `setTimeout` measurements) and `React.memo`.
- `app/mail/page.tsx`, `app/mail/[id]/page.tsx`, `mail-screen.tsx`,
  `mail-reader.tsx` — thread the CSP nonce to the frame.

## Not changed

- The reason a conversation takes a moment to open is the `format=full` thread
  fetch, not rendering; this change does not touch that. Hover/row prefetch of
  a thread remains an easy follow-up.

## Verification

`npx tsc --noEmit` · `npx eslint` (changed files) · `npx vitest run` →
35 files / 260 tests.
