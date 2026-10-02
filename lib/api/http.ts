import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { toSafeError } from "@/lib/agent/errors";
import { jsonError } from "@/lib/api/error-envelope";
import {
  beginIdempotent,
  MAX_IDEMPOTENCY_KEY_LENGTH,
} from "@/lib/api/idempotency";
import { apiRateLimitPerMin } from "@/lib/env";
import {
  resolveRequestId,
  runWithRequestContext,
  setRequestUserId,
} from "@/lib/observability/context";
import { logger } from "@/lib/observability/logger";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";

/** Correlation header echoed on every response. */
export const REQUEST_ID_HEADER = "x-request-id";

/** Default body cap for JSON/RPC routes: 1 MiB. Multipart routes override it. */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/** Standard success envelope: `{ data }`. */
export function ok(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, init);
}

/** Standard error envelope: `{ error: { code, message, trace_id } }`. */
export function apiError(
  code: string,
  message: string,
  status: number,
  init?: Omit<ResponseInit, "status">,
  details?: unknown,
): NextResponse {
  const headers: Record<string, string> = {};
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
  }
  return jsonError(code, message, status, {
    ...(details !== undefined ? { details } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  });
}

/**
 * Map a thrown `AppError` (or anything else) to the standard error envelope,
 * collapsing non-exposed detail so provider/DB messages never reach a client.
 */
export function apiErrorFrom(error: unknown): NextResponse {
  const safe = toSafeError(error);
  return apiError(safe.code, safe.message, safe.httpStatus);
}

export type UserRouteHandler<Ctx = unknown> = (
  userId: string,
  request: NextRequest,
  context: Ctx,
) => Promise<Response>;

export type UserRouteOptions = {
  /**
   * Per-user rate limit. Omit for the default API ceiling; pass `false` to
   * disable for an internal/streaming route that manages its own pacing.
   */
  rateLimit?: false | { limit: number; windowSeconds?: number; scope?: string };
  /** Maximum accepted request body size in bytes (header-based fast reject). */
  maxBodyBytes?: number;
  /**
   * Honour an `Idempotency-Key` header on mutating requests: the first call
   * runs and its JSON response is replayed for retries with the same key.
   * Defaults to on; set `false` for routes where replay would be wrong.
   */
  idempotency?: boolean;
};

function methodHasBody(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function exceedsBodyLimit(
  request: NextRequest,
  maxBodyBytes: number,
): boolean {
  if (!methodHasBody(request.method.toUpperCase())) return false;
  const header = request.headers.get("content-length");
  if (!header) return false;
  const length = Number(header);
  return Number.isFinite(length) && length > maxBodyBytes;
}

/** Best-effort correlation header; streamed/immutable responses are left as-is. */
function attachRequestId(response: Response, requestId: string): Response {
  try {
    response.headers.set(REQUEST_ID_HEADER, requestId);
  } catch {
    // Some streamed responses expose immutable headers; correlating the log
    // line is enough in that case.
  }
  return response;
}

/**
 * Wraps a cookie-authenticated route. `userId` always comes from the session,
 * never from the request body or query. Handlers return a `Response`.
 *
 * On every call the wrapper:
 *  1. opens a request-scoped context (`trace_id` on all downstream logs),
 *  2. rejects oversize bodies fast from `Content-Length`,
 *  3. authenticates,
 *  4. applies a per-user rate limit (fail-open),
 *  5. logs the outcome with status + latency and echoes `x-request-id`.
 */
export function withUser<Ctx = unknown>(
  handler: UserRouteHandler<Ctx>,
): (request: NextRequest, context: Ctx) => Promise<Response>;
export function withUser<Ctx = unknown>(
  options: UserRouteOptions,
  handler: UserRouteHandler<Ctx>,
): (request: NextRequest, context: Ctx) => Promise<Response>;
export function withUser<Ctx = unknown>(
  optionsOrHandler: UserRouteOptions | UserRouteHandler<Ctx>,
  maybeHandler?: UserRouteHandler<Ctx>,
): (request: NextRequest, context: Ctx) => Promise<Response> {
  const options: UserRouteOptions =
    typeof optionsOrHandler === "function" ? {} : optionsOrHandler;
  const handler =
    typeof optionsOrHandler === "function" ? optionsOrHandler : maybeHandler;
  if (!handler) throw new Error("withUser requires a handler");

  return async (request: NextRequest, context: Ctx): Promise<Response> => {
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    const startedAt = Date.now();

    return runWithRequestContext(
      {
        requestId,
        method: request.method,
        path: request.nextUrl.pathname,
        startedAt,
      },
      async () => {
        const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
        if (exceedsBodyLimit(request, maxBodyBytes)) {
          logger.warn("request.payload_too_large", {
            status_code: 413,
            limit_bytes: maxBodyBytes,
          });
          return attachRequestId(
            apiError("payload_too_large", "Request body too large.", 413),
            requestId,
          );
        }

        const session = await getSession();
        if (!session?.user) {
          logger.warn("request.unauthorized", { status_code: 401 });
          return attachRequestId(
            apiError("unauthorized", "Unauthorized", 401),
            requestId,
          );
        }
        setRequestUserId(session.user.id);

        const configuredLimit = options.rateLimit;
        if (configuredLimit !== false) {
          const rateLimit = configuredLimit ?? {
            limit: apiRateLimitPerMin(),
            scope: "api",
          };
          const result = await checkRateLimit({
            subject: session.user.id,
            limit: rateLimit.limit,
            ...(rateLimit.windowSeconds
              ? { windowSeconds: rateLimit.windowSeconds }
              : {}),
            ...(rateLimit.scope ? { scope: rateLimit.scope } : {}),
          });
          if (!result.allowed) {
            logger.warn("request.rate_limited", {
              status_code: 429,
              retry_after_seconds: result.retryAfterSeconds,
            });
            return attachRequestId(
              apiError(
                "rate_limited",
                "Too many requests. Try again shortly.",
                429,
                { headers: { "Retry-After": String(result.retryAfterSeconds) } },
              ),
              requestId,
            );
          }
        }

        const idempotencyKey =
          options.idempotency === false
            ? null
            : (request.headers.get("idempotency-key")?.trim() ?? null);
        let finishIdempotency: ((response: Response) => Promise<void>) | null = null;
        if (
          idempotencyKey &&
          idempotencyKey.length > 0 &&
          idempotencyKey.length <= MAX_IDEMPOTENCY_KEY_LENGTH &&
          methodHasBody(request.method.toUpperCase())
        ) {
          const outcome = await beginIdempotent({
            userId: session.user.id,
            key: idempotencyKey,
          });
          if (outcome.kind === "replay") {
            logger.info("request.idempotent_replay", {
              status_code: outcome.response.status,
            });
            return attachRequestId(outcome.response, requestId);
          }
          if (outcome.kind === "in_flight") {
            logger.warn("request.idempotency_conflict", { status_code: 409 });
            return attachRequestId(
              apiError(
                "conflict",
                "A request with this Idempotency-Key is already in progress.",
                409,
                { headers: { "Retry-After": "1" } },
              ),
              requestId,
            );
          }
          finishIdempotency = outcome.finish;
        }

        try {
          const response = await handler(session.user.id, request, context);
          if (finishIdempotency) await finishIdempotency(response);
          logger.info("request.completed", {
            status_code: response.status,
            latency_ms: Date.now() - startedAt,
          });
          return attachRequestId(response, requestId);
        } catch (error) {
          if (finishIdempotency) {
            await finishIdempotency(new Response(null, { status: 500 }));
          }
          const safe = toSafeError(error);
          logger.error("request.failed", {
            status_code: safe.httpStatus,
            error_code: safe.code,
            latency_ms: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
          });
          return attachRequestId(apiErrorFrom(error), requestId);
        }
      },
    );
  };
}
