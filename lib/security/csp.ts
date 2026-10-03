import "server-only";

/**
 * Content Security Policy (Phase C6, SKILL §4.3).
 *
 * A single, pure policy builder shared by the proxy (which stamps the per-request
 * nonce) and the unit tests. Keeping the string construction here — rather than
 * inline in `proxy.ts` — means the exact directive set is testable without
 * booting Next, and there is one place to tighten a source later.
 *
 * Threat model: the primary goal is to blunt stored/reflected XSS in an app that
 * renders user-controlled email HTML and model output. `script-src` uses a
 * per-request nonce plus `'strict-dynamic'` so only the framework's own loader
 * (and scripts it injects) may execute; `object-src 'none'`, `base-uri 'self'`
 * and `frame-ancestors 'none'` close the classic injection pivots.
 *
 * Deliberate allowances:
 *  - CSS is split by origin type. `style-src-elem` (inline `<style>` elements and
 *    stylesheet loads) is bound to the per-request nonce plus `'self'`, so an
 *    injected `<style>` block cannot restyle or overlay the UI. `style-src-attr`
 *    keeps `'unsafe-inline'` because React `style={{…}}` attributes — and the
 *    chart/animation libs that set them at runtime — can never carry a nonce, and
 *    a style *attribute* is a far weaker primitive than a `<style>` element.
 *  - `'wasm-unsafe-eval'` — Rive (`@rive-app/react-webgl2`) compiles WebAssembly.
 *  - `worker-src blob:` — Rive/worker bundles create object URLs.
 */

export type CspMode = "off" | "report" | "enforce";

export const CSP_HEADER = "Content-Security-Policy";
export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";

/**
 * Normalize `CSP_MODE`. Unset or unrecognized means `enforce`: the report-only
 * burn-in (2026-10-03) shipped a collector at `/api/csp-report` and the policy
 * was tightened (nonce-bound `style-src-elem`), so the header now blocks by
 * default. Set `CSP_MODE=report` to fall back to the non-blocking
 * `Content-Security-Policy-Report-Only` header, or `off` to disable it.
 */
export function parseCspMode(value: string | undefined): CspMode {
  if (value === "off" || value === "report" || value === "enforce") return value;
  return "enforce";
}

/** Response header name for a mode. `off` callers must not call this. */
export function cspHeaderName(mode: Exclude<CspMode, "off">): string {
  return mode === "enforce" ? CSP_HEADER : CSP_REPORT_ONLY_HEADER;
}

/**
 * Object-storage origins the browser talks to directly: `@vercel/blob/client`
 * streams bytes to the store, and Rive loads `.riv` assets from the public
 * store. The double entry covers both the bare host and multi-label subdomains
 * across browser wildcard implementations.
 */
const BLOB_HOSTS = [
  "https://blob.vercel-storage.com",
  "https://*.blob.vercel-storage.com",
];

/** Google account avatars. */
const IMAGE_HOSTS = ["https://*.googleusercontent.com"];

export type BuildCspOptions = {
  /** Fresh, unpredictable per-request nonce (base64 or base64url). */
  nonce: string;
  /** Development relaxes `script-src` (React eval) and allows the HMR socket. */
  isDev: boolean;
  /** Optional violation sink, e.g. `/api/csp-report`. */
  reportUri?: string;
};

/** Build the full policy string for one request. */
export function buildCsp({ nonce, isDev, reportUri }: BuildCspOptions): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    // CSP3: trust scripts that a nonced script injects, not host allowlists.
    "'strict-dynamic'",
    "'wasm-unsafe-eval'",
  ];
  if (isDev) scriptSrc.push("'unsafe-eval'");

  const connectSrc = ["'self'", ...BLOB_HOSTS];
  if (isDev) {
    // Next's HMR channel is a websocket on the dev origin.
    connectSrc.push("ws:", "wss:");
  }

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    // Fallback for browsers without CSP level 3 `style-src-elem`/`-attr`.
    "style-src 'self'",
    // Inline <style> elements and stylesheet loads must carry the nonce.
    `style-src-elem 'self' 'nonce-${nonce}'`,
    // React style={{…}} attributes cannot carry a nonce.
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' blob: data: ${[...BLOB_HOSTS, ...IMAGE_HOSTS].join(" ")}`,
    `media-src 'self' blob: ${BLOB_HOSTS.join(" ")}`,
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(" ")}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  // Upgrading is meaningless (and disruptive) against a local http origin.
  if (!isDev) directives.push("upgrade-insecure-requests");
  if (reportUri) directives.push(`report-uri ${reportUri}`);

  return directives.join("; ");
}
