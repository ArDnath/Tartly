import { createHash } from "node:crypto";

/**
 * Server-derived idempotency keys.
 *
 * The client never supplies a key. If it did, a caller could force-collapse two
 * distinct sends into one, or replay someone else's send. Deriving the key from
 * values the server controls (`userId`, the action id, the provider and the
 * frozen argument hash) makes the eventual send at-most-once per confirmed
 * action while staying opaque to the caller.
 *
 * Pure module (no `server-only`) so it is unit-testable directly.
 */
export function deriveActionIdempotencyKey(input: {
  userId: string;
  actionId: string;
  provider: string;
  argumentsHash: string;
}): string {
  return createHash("sha256")
    .update(
      [input.userId, input.actionId, input.provider, input.argumentsHash].join(
        "|",
      ),
    )
    .digest("hex");
}
