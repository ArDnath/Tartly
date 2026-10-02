import type { Instrumentation } from "next";

/**
 * Next.js instrumentation hook.
 *
 * `onRequestError` is the single catch-all for unhandled server errors thrown
 * outside our own route wrappers (server components, proxy, framework internals).
 * We forward them to the structured logger so a production incident is
 * diagnosable from logs alone.
 *
 * The node-only logger is imported dynamically and guarded by runtime, so the
 * edge build never tries to bundle `node:async_hooks`.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logRequestError } = await import(
    "@/lib/observability/instrumentation"
  );
  await logRequestError(error, request, context);
};
