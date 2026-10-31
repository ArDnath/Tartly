import "server-only";

import { connectedMailProviders } from "@/lib/mail/accounts";
import { isOutlookId } from "@/lib/mail/unified";

/**
 * Which connected mailbox a pending action will touch.
 *
 * Message-scoped tools carry an id: an `outlook:`-prefixed id is decisive on
 * its own. Otherwise the first live provider is used (Gmail first), which keeps
 * new-message sends on the same default as the composer.
 */
export async function resolveActionProvider(
  userId: string,
  args: Record<string, unknown>,
): Promise<"gmail" | "outlook"> {
  if (args.account === "outlook" || args.account === "gmail") {
    return args.account;
  }
  const messageId =
    typeof args.messageId === "string" ? args.messageId : undefined;
  const threadId = typeof args.threadId === "string" ? args.threadId : undefined;
  const target = messageId ?? threadId;
  if (target && isOutlookId(target)) return "outlook";

  const providers = await connectedMailProviders(userId);
  return providers.includes("google") ? "gmail" : "outlook";
}
