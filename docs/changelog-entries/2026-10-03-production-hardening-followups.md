# 2026-10-03 — Production-hardening follow-ups (C1/C2/C6)

## What changed

The remaining optional items in `PLAN-production-hardening.md` were executed.

- **CSP is enforcing by default (C6).** `CSP_MODE` now defaults to `enforce`
  instead of `report`. `style-src` was tightened: inline `<style>` elements must
  carry the per-request nonce (`style-src-elem 'self' 'nonce-…'`) while React
  `style={{…}}` attributes stay allowed (`style-src-attr 'unsafe-inline'`).
  Rollback is a single env var: `CSP_MODE=report`.
- **Contract validation is enforcing by default (C1).** `API_CONTRACT_VALIDATION`
  now defaults to `enforce` in every environment; invalid inbound query/params/
  body fail fast with `400 { error: { code: "validation", details } }`. Set
  `API_CONTRACT_VALIDATION=warn|off` to relax it without a deploy.
- **Repository consolidation (C2).** The feature-local read models
  `lib/repositories/engine-lookups.ts` and `lib/repositories/gmail-persistence.ts`
  were folded into the canonical per-table repositories (`mailboxes`, `threads`,
  `messages`, `meetings`) and deleted. No behaviour change; the repo-wide
  "no SQL outside `lib/db` / `lib/repositories` / `lib/queue`" invariant holds.

## Not changed (deliberately)

- Field-level response schemas (88 `z.unknown()` placeholders) — documentation
  only; response schemas do not gate requests.
- D3 read-replica wiring and D5 OTLP span export — infra-gated; wiring them
  blind is a correctness risk. See the D3/D5 caveats and
  `docs/runbooks/scaling-and-connections.md`.

## Verification

`npx tsc --noEmit` · `npm run lint` (one pre-existing warning) ·
`npm run test:coverage` → 21 files / 165 tests · `npm run test:integration` →
5 files / 86 tests (Postgres 16) · `npm run build` · `npm run openapi:check`.
