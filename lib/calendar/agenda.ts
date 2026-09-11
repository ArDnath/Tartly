/**
 * Agenda shaping for the calendar screen. Pure and client-safe, so both the
 * page (which splits by "now") and the presentational list can share it.
 */

export type AgendaMeeting = {
  id: string;
  threadId: string | null;
  subject: string | null;
  startAt: string | null;
  endAt: string | null;
  meetLink: string | null;
  status: string;
};

export type MeetingAgendaGroups = {
  /** Scheduled, starting now or later, soonest first. */
  upcoming: AgendaMeeting[];
  /** Scheduled, already started, most recent first. */
  past: AgendaMeeting[];
  /** No start time yet (e.g. a proposal that was never confirmed). */
  unscheduled: AgendaMeeting[];
  /** Cancelled meetings, kept for history. */
  cancelled: AgendaMeeting[];
};

export function splitAgenda(
  meetings: AgendaMeeting[],
  now: Date = new Date(),
): MeetingAgendaGroups {
  const threshold = now.getTime();
  const cancelled = meetings.filter((meeting) => meeting.status === "cancelled");
  const active = meetings.filter((meeting) => meeting.status !== "cancelled");

  const scheduled = active.filter(
    (meeting): meeting is AgendaMeeting & { startAt: string } =>
      Boolean(meeting.startAt),
  );

  const upcoming = scheduled
    .filter((meeting) => new Date(meeting.startAt).getTime() >= threshold)
    .sort(
      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    );

  const past = scheduled
    .filter((meeting) => new Date(meeting.startAt).getTime() < threshold)
    .sort(
      (a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime(),
    );

  const unscheduled = active.filter((meeting) => !meeting.startAt);

  return { upcoming, past, unscheduled, cancelled };
}
