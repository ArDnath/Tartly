import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

import {
  buildCsp,
  cspHeaderName,
  parseCspMode,
} from "@/lib/security/csp";

/**
 * Route guard + Content-Security-Policy (Next.js 16 Proxy).
 *
 * **Auth.** Optimistic cookie check only — no DB hit on the proxy path.
 * Authoritative session validation happens on each page/route via `getSession`
 * (which also confirms the user still exists).
 *
 * - Not signed in + any private page → redirect to /auth
 * - /api/* is excluded (routes enforce their own auth and must answer with
 *   JSON, not a redirect).
 *
 * There is deliberately no "cookie present + /auth → /mail" redirect here.
 * A cookie can outlive the session (expired token, reseeded database), and a
 * presence-only bounce would ping-pong against the authoritative `/auth`
 * guard in `app/auth/page.tsx`. That page already redirects a *valid* session
 * to `/mail`, so the optimistic proxy stays out of it.
 *
 * **CSP (Phase C6).** A fresh nonce is minted per request and written to both
 * the request (`x-nonce` + a `Content-Security-Policy` header, which Next parses
 * to stamp framework/inline scripts) and the response
 * (`Content-Security-Policy-Report-Only`, or the enforcing header when
 * `CSP_MODE=enforce`). Nonce-based CSP requires dynamic rendering, so the
 * statically-prerendered marketing pages (`PUBLIC_PATHS`) are skipped: they have
 * no per-request render to receive a nonce and would otherwise report pure
 * false positives. Authenticated app pages are already dynamic.
 */

/** Pages anyone can view without a session. Their static render cannot carry a nonce. */
const PUBLIC_PATHS = new Set(["/", "/pricing", "/terms", "/privacy"]);

/**
 * Origin of the configured ImageKit endpoint, allowed by CSP so images/video
 * load from a custom domain. Returns `undefined` for the default
 * `ik.imagekit.io` host (already allowed) or when delivery is unconfigured.
 */
function imagekitCspOrigin(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT;
  if (!raw) return undefined;
  try {
    return new URL(raw).origin;
  } catch {
    return undefined;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = getSessionCookie(request);
  const isAuthPage = pathname === "/auth" || pathname.startsWith("/auth/");
  const isPublicPage = isAuthPage || PUBLIC_PATHS.has(pathname);

  if (!sessionCookie && !isPublicPage) {
    // Preserve the intended destination (e.g. `/checkout?interval=year`) so the
    // sign-in flow can return the user to it. `/auth` validates `next` as an
    // in-app relative path before using it.
    const next = `${pathname}${request.nextUrl.search}`;
    return NextResponse.redirect(
      new URL(`/auth?next=${encodeURIComponent(next)}`, request.url),
    );
  }

  const mode = parseCspMode(process.env.CSP_MODE);
  if (mode === "off" || PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    // Blank value means "use the in-repo collector"; set CSP_REPORT_URI to
    // override it (or to an external sink).
    reportUri: process.env.CSP_REPORT_URI || "/api/csp-report",
    // Allow a custom ImageKit domain for images, video and HLS manifests.
    imagekitOrigin: imagekitCspOrigin(),
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Read by Next during SSR to apply the nonce to scripts and inline tags.
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set(cspHeaderName(mode), policy);
  return response;
}

export const config = {
  // The proxy only guards pages. API routes enforce their own auth (and must
  // answer with JSON, not a redirect), and static assets are served directly.
  // The extension check is anchored to the end of the path so a dot inside a
  // dynamic segment (e.g. `/mail/foo.bar`) can never slip past the guard.
  matcher: [
    "/((?!api/|dev-profile|_next/static|_next/image|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)",
  ],
};
