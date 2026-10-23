import { ok, withUser } from "@/lib/api/http";
import { getCatchUp } from "@/lib/briefing/catchup";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/briefing — the catch-up payload behind the reload popup.
 *
 * Composition only: it never posts a message into a conversation. The popup
 * gate fetches this once per local day; the agent space then opens the plan the
 * payload carries.
 */
export const GET = withUser({ requiresSubscription: true }, async (userId) => {
  const catchUp = await getCatchUp(userId);
  return ok({ catchUp });
});
