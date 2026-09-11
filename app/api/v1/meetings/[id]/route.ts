import { z } from "zod";

import { apiError, ok, withUser } from "@/lib/api/http";
import {
  cancelMeeting,
  rescheduleMeeting,
  toMeetingDto,
} from "@/lib/calendar/manage";

type RouteContext = { params: Promise<{ id: string }> };

const rescheduleSchema = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
});

/** Moves a booked meeting to a new time (and updates its Google event). */
export const PATCH = withUser<RouteContext>(async (userId, request, context) => {
  const { id } = await context.params;

  const parsed = rescheduleSchema.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return apiError("bad_request", "Invalid request", 400);
  }

  const startUtc = new Date(parsed.data.startAt);
  const endUtc = new Date(parsed.data.endAt);
  if (!(startUtc < endUtc)) {
    return apiError("bad_request", "End must be after start", 400);
  }

  const meeting = await rescheduleMeeting({
    userId,
    meetingId: id,
    startUtc,
    endUtc,
  });
  if (!meeting) return apiError("not_found", "Meeting not found", 404);

  return ok({ meeting: toMeetingDto(meeting) });
});

/** Cancels a booked meeting (and removes its Google event). */
export const DELETE = withUser<RouteContext>(async (userId, _request, context) => {
  const { id } = await context.params;

  const meeting = await cancelMeeting({ userId, meetingId: id });
  if (!meeting) return apiError("not_found", "Meeting not found", 404);

  return ok({ meeting: toMeetingDto(meeting) });
});
