import { apiError, ok, withUser } from "@/lib/api/http";
import { isThreadSummaryEnabled } from "@/lib/env";
import {
  getCachedThreadSummary,
  loadThreadForSummary,
  shouldSummarize,
  summarizeThread,
} from "@/lib/ai/features/summarize-thread";

/**
 * Thread summary (Phase 2, C8).
 *
 * `GET` returns a cached summary only — it never spends tokens on a render.
 * `POST` is the explicit "Summarize" action and may generate + cache one.
 */

export const GET = withUser<{ params: Promise<{ threadId: string }> }>(
  async (userId, _request, context) => {
    const { threadId } = await context.params;
    const thread = await loadThreadForSummary({ userId, threadId });
    if (!thread) return apiError("not_found", "Thread not found", 404);

    const summary = await getCachedThreadSummary({ userId, thread });
    return ok({
      summary,
      canSummarize: shouldSummarize(thread.messages.length),
      enabled: isThreadSummaryEnabled(),
    });
  },
);

export const POST = withUser<{ params: Promise<{ threadId: string }> }>(
  { requiresSubscription: true },
  async (userId, _request, context) => {
    const { threadId } = await context.params;
    if (!isThreadSummaryEnabled()) {
      return apiError("disabled", "Thread summaries are disabled.", 403);
    }
    const summary = await summarizeThread({ userId, threadId });
    if (!summary) return apiError("not_found", "Thread not found", 404);
    return ok({ summary });
  },
);
