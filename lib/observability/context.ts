import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { randomUUID } from "node:crypto";

/**
 * Request-scoped context.
 *
 * Every API request runs inside an {@link AsyncLocalStorage} frame so the
 * logger, error handlers and services can attach the same `trace_id` (and
 * `user_id`) to every line without threading them through every call signature.
 *
 * The store is per-async-execution, never a module-level mutable variable, so
 * concurrent requests can never observe each other's identity.
 */
export type RequestContext = {
  /** Correlates every log line and error for one request. */
  requestId: string;
  method: string;
  path: string;
  /** `Date.now()` when the handler was entered, for latency logging. */
  startedAt: number;
  userId?: string;
  /** W3C trace id parsed from an inbound `traceparent`, when present. */
  traceId?: string;
  /** W3C parent span id parsed from an inbound `traceparent`. */
  parentId?: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` with `context` available via {@link getRequestContext}. */
export function runWithRequestContext<T>(
  context: RequestContext,
  fn: () => T,
): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Annotates the current request with the authenticated user id. */
export function setRequestUserId(userId: string): void {
  const context = storage.getStore();
  if (context) context.userId = userId;
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** Accepts an inbound `x-request-id` (trusted proxy) or mints a fresh one. */
export function resolveRequestId(inbound: string | null): string {
  const trimmed = inbound?.trim();
  if (trimmed && trimmed.length <= 128) return trimmed;
  return randomUUID();
}
