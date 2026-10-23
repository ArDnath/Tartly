import { apiError, ok, withUser } from "@/lib/api/http";
import { mailUnsubscribeBody as bodySchema } from "@/lib/api/contracts/mail";
import { extractEmail } from "@/lib/services/draft-service";
import { performUnsubscribe } from "@/lib/ai/features/unsubscribe";

/**
 * Bulk unsubscribe (Phase 2, C7).
 *
 * The user's click is the consent for this action. One-click senders are
 * unsubscribed with a direct POST (no mail leaves the mailbox); others return
 * the mailto/link for the user to finish. The attempt is always logged.
 */

export const POST = withUser({ requiresSubscription: true }, async (userId, request) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

  const email = extractEmail(parsed.data.senderEmail);
  if (!email) return apiError("bad_request", "Invalid sender address", 400);

  const result = await performUnsubscribe({
    userId,
    senderEmail: email,
    ...(parsed.data.threadId ? { threadId: parsed.data.threadId } : {}),
    ...(parsed.data.archiveThread !== undefined
      ? { archiveThread: parsed.data.archiveThread }
      : {}),
  });

  return ok(result);
});
