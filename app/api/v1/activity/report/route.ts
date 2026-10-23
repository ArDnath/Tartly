import { apiError, ok, withUser } from "@/lib/api/http";
import { generateReport, getCachedReport } from "@/lib/ai/features/report";
import { isInsightsEnabled } from "@/lib/env";

/**
 * Weekly insights report (Phase 5, C15).
 *
 * `GET` serves the cached report only (never spends on a render). `POST` is the
 * explicit "Generate report" action.
 */

export const GET = withUser(async (userId) => {
  const report = await getCachedReport({ userId });
  return ok({ report, enabled: isInsightsEnabled() });
});

export const POST = withUser({ requiresSubscription: true }, async (userId) => {
  if (!isInsightsEnabled()) {
    return apiError("disabled", "Insights are disabled.", 403);
  }
  const report = await generateReport({ userId, force: true });
  return ok({ report });
});
