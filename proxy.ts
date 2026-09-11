import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Route guard (Next.js 16 Proxy).
 *
 * Optimistic cookie check only — no DB hit on the proxy path.
 * Authoritative session validation happens on each page/route
 * via `getSession` (which also confirms the user still exists).
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
 */

/** Pages anyone can view without a session. */
const PUBLIC_PATHS = new Set(["/", "/terms", "/privacy"]);

export async function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  const { pathname } = request.nextUrl;
  const isAuthPage = pathname === "/auth" || pathname.startsWith("/auth/");
  const isPublicPage = isAuthPage || PUBLIC_PATHS.has(pathname);

  if (!sessionCookie && !isPublicPage) {
    return NextResponse.redirect(new URL("/auth", request.url));
  }

  return NextResponse.next();
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
