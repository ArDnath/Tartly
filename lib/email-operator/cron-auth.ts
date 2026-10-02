import "server-only";

import { env } from "@/lib/env";
import { constantTimeEqual } from "@/lib/security/constant-time";

/**
 * Vercel cron auth. Vercel sends `Authorization: Bearer $CRON_SECRET`
 * automatically when `CRON_SECRET` is configured. Fails closed when the secret
 * is unset so an unauthenticated caller can never trigger maintenance. The
 * comparison is constant-time to avoid leaking the secret byte by byte.
 */
export function isCronAuthorized(request: Request): boolean {
  if (!env.CRON_SECRET) return false;

  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;

  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 && constantTimeEqual(token, env.CRON_SECRET);
}
