import { apiError, ok, withUser } from "@/lib/api/http";
import { generateDigest, getLatestDigest } from "@/lib/ai/features/digest";
import { isDigestEnabled } from "@/lib/env";

/**
 * Inbox digest (Phase 4, C14).
 *
 * `GET` returns the latest stored digest (never generates on render). `POST`
 * is the explicit "Generate digest" action.
 */

export const GET = withUser(async (userId) => {
  const digest = await getLatestDigest(userId);
  return ok({ digest, enabled: isDigestEnabled() });
});

export const POST = withUser({ requiresSubscription: true }, async (userId, request) => {
  if (!isDigestEnabled()) {
    return apiError("disabled", "Digests are disabled.", 403);
  }
  const body = (await request.json().catch(() => ({}))) as { kind?: unknown };
  const kind = body.kind === "weekly" ? "weekly" : "daily";
  const digest = await generateDigest({ userId, kind });
  if (!digest) return apiError("unavailable", "Digest could not be generated", 503);
  return ok({ digest });
});
