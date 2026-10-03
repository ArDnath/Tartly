import { apiError, created, ok, withUser } from "@/lib/api/http";
import { meetingCreateBody as createSchema } from "@/lib/api/contracts/meetings";
import {
  DEFAULT_MEETINGS_LIMIT,
  listMeetings,
  MAX_MEETINGS_LIMIT,
} from "@/lib/calendar/booking";
import { createAdHocMeeting, toMeetingDto } from "@/lib/calendar/manage";

export const GET = withUser(async (userId, request) => {
  const raw = Number(request.nextUrl.searchParams.get("limit"));
  const limit =
    Number.isFinite(raw) && raw > 0
      ? Math.min(Math.floor(raw), MAX_MEETINGS_LIMIT)
      : DEFAULT_MEETINGS_LIMIT;
  const meetings = await listMeetings(userId, limit);
  return ok({ meetings: meetings.map(toMeetingDto) });
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
    // Syntactically valid, but violates the domain rule: 422 (SKILL §2.3).
    return apiError("validation", "End must be after start.", 422);
  }

  const meeting = await createAdHocMeeting({
    userId,
    subject: parsed.data.subject,
    startUtc,
    endUtc,
    attendees: parsed.data.attendees,
  });

  return created(
    { meeting: toMeetingDto(meeting) },
    { location: `/api/v1/meetings/${meeting.id}` },
  );
});
