import { NextResponse, after } from "next/server";

import { auth } from "@/lib/auth";

/**
 * Fast sign-out endpoint.
 *
 * The response clears the auth cookies immediately so the browser is
 * logged out the instant the UI navigates — the durable cleanup (Redis
 * key + mirrored PostgreSQL session row + provider bookkeeping) is
 * deferred with `after()` and runs once the response has been sent.
 *
 * Trade-off: the browser is logged out before the server-side session is
 * gone. The orphaned session expires on its own TTL if the deferred job
 * fails (e.g. process frozen), and a concurrent request carrying the old
 * token could still be accepted for the duration of the job.
 */
export async function POST(request: Request) {
  const requestHeaders = request.headers;

  after(async () => {
    try {
      await auth.api.signOut({ headers: requestHeaders });
    } catch (error) {
      console.error("[sign-out] deferred session cleanup failed", error);
    }
  });

  const { authCookies } = await auth.$context;
  const response = NextResponse.json({ success: true });

  for (const cookie of [
    authCookies.sessionToken,
    authCookies.sessionData,
    authCookies.accountData,
  ]) {
    response.cookies.set({
      name: cookie.name,
      value: "",
      path: cookie.attributes.path ?? "/",
      httpOnly: cookie.attributes.httpOnly ?? true,
      sameSite: (
        cookie.attributes.sameSite ?? "lax"
      ).toLowerCase() as "lax" | "strict" | "none",
      secure: cookie.attributes.secure ?? false,
      maxAge: 0,
      expires: new Date(0),
    });
  }

  return response;
}
