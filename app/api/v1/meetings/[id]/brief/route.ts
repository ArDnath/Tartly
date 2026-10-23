import { apiError, ok, withUser } from "@/lib/api/http";
import {
  generateMeetingBrief,
  getCachedMeetingBrief,
  loadMeetingBriefContext,
} from "@/lib/ai/features/meeting-brief";
import { isMeetingBriefsEnabled } from "@/lib/env";

/**
 * Meeting brief (Phase 4, C13).
 *
 * `GET` serves a cached brief only — it never spends tokens on a render.
 * `POST` is the explicit "Prepare brief" action and may generate + cache one.
 */

export const GET = withUser<{ params: Promise<{ id: string }> }>(
  async (userId, _request, context) => {
    const { id } = await context.params;
    const meeting = await loadMeetingBriefContext({ userId, meetingId: id });
    if (!meeting) return apiError("not_found", "Meeting not found", 404);

    const day = new Date().toISOString().slice(0, 10);
    const brief = await getCachedMeetingBrief({ userId, context: meeting, day });
    return ok({ brief, enabled: isMeetingBriefsEnabled() });
  },
);

export const POST = withUser<{ params: Promise<{ id: string }> }>(
  { requiresSubscription: true },
  async (userId, _request, context) => {
    const { id } = await context.params;
    if (!isMeetingBriefsEnabled()) {
      return apiError("disabled", "Meeting briefs are disabled.", 403);
    }
    const brief = await generateMeetingBrief({ userId, meetingId: id });
    if (!brief) return apiError("not_found", "Meeting not found", 404);
    return ok({ brief });
  },
);
