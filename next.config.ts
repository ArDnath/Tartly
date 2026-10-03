import type { NextConfig } from "next";

/**
 * Canonical origin. OAuth (`redirect_uri`) and the session cookie are pinned to
 * this one origin, so every alternate host that has ever served the app must
 * funnel here — otherwise a sign-in started on an alias sets its state cookie
 * on the alias and the callback (on the canonical host) fails with
 * "State not found".
 */
const CANONICAL_ORIGIN = (
  process.env.NEXT_PUBLIC_BETTER_AUTH_URL ?? "https://apemail.ariyaman.in"
).replace(/\/$/, "");

/**
 * Hosts that must never serve the app directly. These are the project's stable
 * `*.vercel.app` aliases; per-deployment and preview URLs are intentionally
 * left alone so preview builds stay reachable.
 */
const LEGACY_HOSTS = [
  "apeemail-one.vercel.app",
  "app-server-xi-one.vercel.app",
  "app-server-ariyamans-projects.vercel.app",
];

const nextConfig: NextConfig = {
  // Emit `.next/standalone` (traced server + minimal node_modules) so the
  // production container (Dockerfile) can ship without a full install. Vercel
  // ignores this and uses its own bundling.
  output: "standalone",
  // Ship the smallest possible initial payload: no framework fingerprint
  // header, and aggressive per-module imports for the big component barrels
  // (`lucide-react` and `date-fns` are optimized by Next already).
  poweredByHeader: false,
  reactStrictMode: true,
  compress: true,
  experimental: {
    // Per-module imports for the big component barrels. `lucide-react` and
    // `date-fns` are already optimized by Next; these are the app's own heavy
    // barrels that would otherwise pull every export into the compile graph.
    optimizePackageImports: [
      "@base-ui/react",
      "cmdk",
      "motion",
      "use-stick-to-bottom",
    ],
    // Reuse dynamic page segments in the client Router Cache for 30s so
    // back/forward and repeat clicks resolve without a server round trip.
    // Mutations stay correct because they update the client store optimistically
    // and call `router.refresh()` when the server view must change.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
  // Baseline security headers on every response. CSP is emitted per-request by
  // `proxy.ts` (Phase C6) because a nonce policy needs a dynamic render; see
  // `lib/security/csp.ts`. These static headers apply to every response.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // HTTPS-only for two years. No `preload` yet — that is a one-way
          // commitment that must be deliberate.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          // Never let a browser sniff a response into a different type (XSS).
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Do not leak the full URL cross-origin.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Clickjacking defense (superseded by CSP frame-ancestors, kept for
          // older browsers).
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
        ],
      },
    ];
  },
  // Collapse every legacy alias onto the canonical origin with a 308 so no
  // request is ever served (or authenticated) off-origin.
  async redirects() {
    const hostRedirects = LEGACY_HOSTS.map((host) => ({
      source: "/:path*",
      has: [{ type: "host" as const, value: host }],
      destination: `${CANONICAL_ORIGIN}/:path*`,
      permanent: true,
    }));

    return [
      ...hostRedirects,
      // `/metrics` was an early, orphaned duplicate of the richer `/activity`
      // board — same page title, linked from nowhere. Fold it into the
      // canonical surface so old bookmarks never land on a dead card grid.
      { source: "/metrics", destination: "/activity", permanent: true },
    ];
  },
};

export default nextConfig;
