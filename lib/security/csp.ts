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
 *    In development `style-src-elem` falls back to `'unsafe-inline'` **without**
 *    the nonce (see {@link buildCsp}): a nonce makes browsers ignore
 *    `'unsafe-inline'`, and dev injects styles at runtime (React style hoisting,
 *    the Next dev overlay, font loaders) with no nonce to attach.
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

/**
 * ImageKit's default CDN. Images, video and HLS manifests are loaded directly
 * by the browser, so they must be allowed in `img-src`, `media-src` and
 * `connect-src`. A per-request `imagekitOrigin` (parsed from
 * `NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT`) additionally covers custom domains.
 */
const IMAGEKIT_HOSTS = ["https://ik.imagekit.io", "https://*.imagekit.io"];

export type BuildCspOptions = {
  /** Fresh, unpredictable per-request nonce (base64 or base64url). */
  nonce: string;
  /** Development relaxes `script-src` (React eval) and allows the HMR socket. */
  isDev: boolean;
  /** Optional violation sink, e.g. `/api/csp-report`. */
  reportUri?: string;
  /**
   * Extra origin allowed for images, media and `connect-src` — used for a
   * custom ImageKit domain. Pass the origin (scheme + host) of
   * `NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT`.
   */
  imagekitOrigin?: string;
};

/** Build the full policy string for one request. */
export function buildCsp({
  nonce,
  isDev,
  reportUri,
  imagekitOrigin,
}: BuildCspOptions): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    // CSP3: trust scripts that a nonced script injects, not host allowlists.
    "'strict-dynamic'",
    "'wasm-unsafe-eval'",
  ];
  if (isDev) scriptSrc.push("'unsafe-eval'");

  const mediaHosts = imagekitOrigin
    ? [...BLOB_HOSTS, ...IMAGEKIT_HOSTS, imagekitOrigin]
    : [...BLOB_HOSTS, ...IMAGEKIT_HOSTS];

  const connectSrc = ["'self'", ...mediaHosts];
  if (isDev) {
    // Next's HMR channel is a websocket on the dev origin.
    connectSrc.push("ws:", "wss:");
  }

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    // Fallback for browsers without CSP level 3 `style-src-elem`/`-attr`.
    // Dev needs `'unsafe-inline'` here too, or CSP2 browsers block runtime
    // styles the `-elem` override never gets to see.
    `style-src 'self'${isDev ? " 'unsafe-inline'" : ""}`,
    // Inline <style> elements and stylesheet loads must carry the nonce.
    //
    // Dev is the exception: React's style hoisting, the Next dev overlay and
    // font loaders inject <style> at runtime without a nonce. A nonce in the
    // same directive makes browsers *ignore* `'unsafe-inline'`, so dropping it
    // is what lets those styles apply — the approach Next's CSP guide
    // prescribes for development. Production keeps the nonce; Next stamps its
    // own inline styles during SSR.
    isDev
      ? `style-src-elem 'self' 'unsafe-inline'`
      : `style-src-elem 'self' 'nonce-${nonce}'`,
    // React style={{…}} attributes cannot carry a nonce.
    "style-src-attr 'unsafe-inline'",
    // `https:`/`http:` are for the live mail reader: email HTML rendered in a
    // sandboxed srcdoc frame *inherits this policy*, so without them every
    // remote image a message references is blocked and newsletters render with
    // empty boxes. In production `upgrade-insecure-requests` (below) rewrites
    // `http:` first; the bare scheme is what keeps local http dev working.
    `img-src 'self' blob: data: https: http: ${[...mediaHosts, ...IMAGE_HOSTS].join(" ")}`,
    `media-src 'self' blob: ${mediaHosts.join(" ")}`,
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(" ")}`,
    // Dodo checkout is a top-level redirect to its own hosted page, so no frame
    // or script origin needs to be allowed here.
    "frame-src 'self'",
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
