import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getRequestId } from "@/lib/observability/context";

/**
 * The one JSON error shape for the whole API (Phase B).
 *
 * Every error body is `{ error: { code, message, trace_id, details? } }`, where
 * `trace_id` matches the request's log line and the `x-request-id` response
 * header. Routes that do not run inside `withUser` (webhooks, crons, legacy
 * handlers) still get a trace id: `getRequestId()` when a context exists, a
 * fresh UUID otherwise, so a client can always quote something actionable.
 */

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    trace_id: string;
    details?: unknown;
  };
};

export function currentTraceId(): string {
  return getRequestId() ?? randomUUID();
}

export function errorEnvelope(
  code: string,
  message: string,
  options: { traceId?: string; details?: unknown } = {},
): ApiErrorBody {
  return {
    error: {
      code,
      message,
      trace_id: options.traceId ?? currentTraceId(),
      ...(options.details !== undefined ? { details: options.details } : {}),
    },
  };
}

/** Build a standardized JSON error response (and echo the trace id header). */
export function jsonError(
  code: string,
  message: string,
  status: number,
  options: { details?: unknown; headers?: Record<string, string> } = {},
): NextResponse {
  const traceId = currentTraceId();
  return NextResponse.json(errorEnvelope(code, message, { traceId, ...options }), {
    status,
    headers: { ...(options.headers ?? {}), "x-request-id": traceId },
  });
}
