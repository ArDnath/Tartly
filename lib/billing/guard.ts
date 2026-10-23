import "server-only";

import { checkAiAccess } from "@/lib/billing/entitlements";
import { paymentRequired } from "@/lib/billing/http";
import { isBudgetDisabled } from "@/lib/ai/budget";

/**
 * Raw-handler guard for AI routes that bypass `withUser` (SSE/streaming
 * transports). Returns a `402` response when the user has no AI entitlement
 * **or** has run out of credits, or `null` to continue. `withUser` callers
 * should instead set `requiresSubscription: true`.
 */
export async function requireAiAccess(
  userId: string,
): Promise<Response | null> {
  const access = await checkAiAccess(userId);
  if (!access.allowed) return paymentRequired(access.entitlement, "ai");
  // A subscriber with an empty wallet must top up before another model call.
  if (!isBudgetDisabled() && access.entitlement.credits.balance <= 0) {
    return paymentRequired(access.entitlement, "credits");
  }
  return null;
}
