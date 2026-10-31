/**
 * Pre-paint theme bootstrap.
 *
 * Runs synchronously while the document is parsed, before the first paint:
 * applies the user's stored choice, else the OS preference, else the
 * brand-default dark — by toggling the `dark` class that the light palette in
 * `:root` / dark in `.dark` (globals.css) keys off. Mirrors `lib/theme.ts`;
 * keep the storage key in sync.
 *
 * This lives in its own module — no `"use client"`, no DOM helpers — because
 * two places must agree on the *exact* bytes:
 *
 * - `app/layout.tsx` renders it as an inline `<script>`.
 * - `lib/security/csp.ts` pins it with a SHA-256 hash, so the strict
 *   nonce-based policy authorizes it on authenticated routes without giving
 *   the element a per-request `nonce` attribute.
 *
 * Why not `next/script`? Its `beforeInteractive` branch inherits the nonce
 * from React context on the server (`""` when a page carries no CSP) but has
 * no nonce during client hydration (`undefined`), which React reports as an
 * attribute hydration mismatch on every page. A plain inline script with an
 * identical hash-authorized body hydrates cleanly.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=window.localStorage.getItem("theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.classList.toggle("dark",t==="dark");}catch(e){}})();`;
