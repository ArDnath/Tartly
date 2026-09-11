import { z } from "zod";

import { apiError, ok, withUser } from "@/lib/api/http";
import { listMeetings } from "@/lib/calendar/booking";
import { createAdHocMeeting, toMeetingDto } from "@/lib/calendar/manage";

export const GET = withUser(async (userId) => {
  const meetings = await listMeetings(userId);
  return ok({ meetings: meetings.map(toMeetingDto) });
});

const createSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  attendees: z.array(z.string().email()).max(20).optional(),
});

/** Creates a standalone meeting (not tied to an email thread). */
export const POST = withUser(async (userId, request) => {
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError("bad_request", "Invalid request", 400);
  }

  const startUtc = new Date(parsed.data.startAt);
  const endUtc = new Date(parsed.data.endAt);
  if (!(startUtc < endUtc)) {
    return apiError("bad_request", "End must be after start", 400);
  }

  const meeting = await createAdHocMeeting({
    userId,
    subject: parsed.data.subject,
    startUtc,
    endUtc,
    attendees: parsed.data.attendees,
  });

  return ok({ meeting: toMeetingDto(meeting) });
});
