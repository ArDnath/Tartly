import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { toSafeError } from "@/lib/agent/errors";
import { getSession } from "@/lib/session";

/** Standard success envelope: `{ data }`. */
export function ok(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, init);
}

/** Standard error envelope: `{ error: { code, message } }`. */
export function apiError(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * Map a thrown `AppError` (or anything else) to the standard error envelope,
 * collapsing non-exposed detail so provider/DB messages never reach a client.
 */
export function apiErrorFrom(error: unknown): NextResponse {
  const safe = toSafeError(error);
  return apiError(safe.code, safe.message, safe.httpStatus);
}

/**
 * Wraps a cookie-authenticated route. `userId` always comes from the session,
 * never from the request body or query. Handlers return a `Response`.
 */
export function withUser<Ctx = unknown>(
  handler: (
    userId: string,
    request: NextRequest,
    context: Ctx,
  ) => Promise<Response>,
) {
  return async (request: NextRequest, context: Ctx): Promise<Response> => {
    const session = await getSession();
    if (!session?.user) {
      return apiError("unauthorized", "Unauthorized", 401);
    }

    try {
      return await handler(session.user.id, request, context);
    } catch (error) {
      console.error("[api] unhandled error", error);
      // Never echo a raw Postgres/provider message to the client; collapse it
      // to a safe envelope while the full detail stays in the server log.
      return apiErrorFrom(error);
    }
  };
}
