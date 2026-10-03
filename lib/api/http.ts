import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { toSafeError } from "@/lib/agent/errors";
import {
  contractValidationMode,
  matchOperation,
  type ContractValidationMode,
} from "@/lib/api/contracts";
import {
  validateInbound,
  type ValidationIssue,
} from "@/lib/api/contracts/validate";
import { jsonError } from "@/lib/api/error-envelope";
import {
  beginIdempotent,
  MAX_IDEMPOTENCY_KEY_LENGTH,
} from "@/lib/api/idempotency";
import type { PaginationMeta } from "@/lib/api/pagination";
import { apiRateLimitPerMin } from "@/lib/env";
import {
  resolveRequestId,
  runWithRequestContext,
  setRequestUserId,
} from "@/lib/observability/context";
import { logger } from "@/lib/observability/logger";
import { recordHttpRequest } from "@/lib/observability/metrics";
import { parseTraceparent } from "@/lib/observability/trace";
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

/**
 * Success envelope for cursor-paginated lists: `{ data, pagination }`
 * (SKILL §2.4). `data` keeps the resource-shaped body the client already
 * reads (e.g. `{ items }`); `pagination` is added alongside, never in place of
 * it, so existing clients keep working.
 */
export function okPage(data: unknown, pagination: PaginationMeta): NextResponse {
  return NextResponse.json({ data, pagination });
}

/**
 * `201 Created` with the standard `{ data }` body and an optional `Location`
 * pointing at the new resource (SKILL §2.3).
 */
export function created(
  data: unknown,
  options: { location?: string } = {},
): NextResponse {
  return NextResponse.json(
    { data },
    {
      status: 201,
      ...(options.location ? { headers: { Location: options.location } } : {}),
    },
  );
}

/** `204 No Content` for successful deletes (SKILL §2.3). */
export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
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

/**
 * Per-user rate limit for the legacy raw handlers that deliberately bypass
 * `withUser` (SSE/redirect transports). Returns the `429` response to send when
 * the subject is over budget, or `null` to continue. Fail-open, like every
 * other limiter: a Redis outage must not block the request.
 */
export async function enforceUserRateLimit(
  userId: string,
  options: { limit?: number; scope?: string; windowSeconds?: number } = {},
): Promise<NextResponse | null> {
  const result = await checkRateLimit({
    subject: userId,
    limit: options.limit ?? apiRateLimitPerMin(),
    ...(options.scope ? { scope: options.scope } : {}),
    ...(options.windowSeconds ? { windowSeconds: options.windowSeconds } : {}),
  });
  if (result.allowed) return null;
  logger.warn("request.rate_limited", {
    status_code: 429,
    retry_after_seconds: result.retryAfterSeconds,
  });
  return apiError(
    "rate_limited",
    "Too many requests. Try again shortly.",
    429,
    { headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
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
 * Validate the inbound request against its registered contract (Phase C1,
 * SKILL §2.5). Returns the offending fields when the contract is enforced, or
 * `null` when there is no contract / it is valid / the mode is off or warn.
 *
 * The JSON body is read through `request.clone()` so the handler's own
 * `request.json()` still works; there is no double-consumption.
 */
async function contractIssues(
  request: NextRequest,
  mode: ContractValidationMode,
): Promise<ValidationIssue[] | null> {
  if (mode === "off") return null;
  const matched = matchOperation(
    request.method.toUpperCase(),
    request.nextUrl.pathname,
  );
  if (!matched) return null;
  const { operation } = matched;
  if (!operation.params && !operation.query && !operation.body) return null;

  let body: unknown;
  let hasBody = false;
  if (operation.body && methodHasBody(request.method.toUpperCase())) {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.toLowerCase().includes("application/json")) {
      try {
        body = await request.clone().json();
        hasBody = true;
      } catch {
        // Malformed JSON: let the handler's own parser produce the 400.
        hasBody = false;
      }
    }
  }

  const issues = validateInbound(operation, {
    searchParams: request.nextUrl.searchParams,
    params: matched.params,
    body,
    hasBody,
  });
  return issues.length > 0 ? issues : null;
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
    const method = request.method.toUpperCase();
    // Bounded metric label: the contract path template, never the raw path.
    const routeTemplate =
      matchOperation(method, request.nextUrl.pathname)?.operation.path ??
      "unmatched";
    const traceparent = parseTraceparent(request.headers.get("traceparent"));

    /** Records RED metrics and echoes the correlation id on every exit. */
    const finalize = (response: Response): Response => {
      recordHttpRequest({
        method,
        route: routeTemplate,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      return attachRequestId(response, requestId);
    };

    return runWithRequestContext(
      {
        requestId,
        method: request.method,
        path: request.nextUrl.pathname,
        startedAt,
        ...(traceparent
          ? { traceId: traceparent.traceId, parentId: traceparent.parentId }
          : {}),
      },
      async () => {
        const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
        if (exceedsBodyLimit(request, maxBodyBytes)) {
          logger.warn("request.payload_too_large", {
            status_code: 413,
            limit_bytes: maxBodyBytes,
          });
          return finalize(
            apiError("payload_too_large", "Request body too large.", 413),
          );
        }

        const session = await getSession();
        if (!session?.user) {
          logger.warn("request.unauthorized", { status_code: 401 });
          return finalize(apiError("unauthorized", "Unauthorized", 401));
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
            return finalize(
              apiError(
                "rate_limited",
                "Too many requests. Try again shortly.",
                429,
                { headers: { "Retry-After": String(result.retryAfterSeconds) } },
              ),
            );
          }
        }

        const contractMode = contractValidationMode();
        const issues = await contractIssues(request, contractMode);
        if (issues) {
          if (contractMode === "warn") {
            logger.warn("contract.violation", {
              contract: `${request.method} ${request.nextUrl.pathname}`,
              issues,
            });
          } else {
            logger.warn("request.contract_invalid", {
              status_code: 400,
              issue_count: issues.length,
            });
            return finalize(
              apiError("validation", "Invalid request.", 400, undefined, issues),
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
            return finalize(outcome.response);
          }
          if (outcome.kind === "in_flight") {
            logger.warn("request.idempotency_conflict", { status_code: 409 });
            return finalize(
              apiError(
                "conflict",
                "A request with this Idempotency-Key is already in progress.",
                409,
                { headers: { "Retry-After": "1" } },
              ),
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
          return finalize(response);
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
          return finalize(apiErrorFrom(error));
        }
      },
    );
  };
}
