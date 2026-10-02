import "server-only";

import { logger } from "./logger";

type RequestInfo = {
  path: string;
  method: string;
  headers?: unknown;
};

type ContextInfo = {
  routerKind: string;
  routePath: string;
  routeType: string;
};

function digestOf(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "digest" in error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string") return digest;
  }
  return undefined;
}

/**
 * Node-runtime handler for Next's `onRequestError` hook. Keeps the root
 * `instrumentation.ts` free of `node:async_hooks`/`server-only` imports so the
 * edge bundle never pulls them in.
 */
export async function logRequestError(
  error: unknown,
  request: RequestInfo,
  context: ContextInfo,
): Promise<void> {
  const normalized = error instanceof Error ? error : new Error(String(error));
  logger.error("request.unhandled_error", {
    error_name: normalized.name,
    error_message: normalized.message,
    digest: digestOf(error),
    method: request.method,
    path: request.path,
    router_kind: context.routerKind,
    route_path: context.routePath,
    route_type: context.routeType,
  });
}
