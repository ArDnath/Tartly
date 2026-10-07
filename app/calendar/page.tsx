import { PageHeader } from "@/components/app/shell/page-header";
import { MeetingAgenda } from "@/components/app/calendar/meeting-agenda";
import { splitAgenda, type AgendaMeeting } from "@/lib/calendar/agenda";
import { listMeetings } from "@/lib/calendar/booking";
import { DEFAULT_CALENDAR_SETTINGS } from "@/lib/calendar/defaults";
import { getCalendarSettings } from "@/lib/calendar/settings";
import { requireSession } from "@/lib/session";

/**
 * Every meeting the operator has booked, as an agenda split into upcoming and
 * past. Times render in the user's configured calendar timezone.
 */
export default async function CalendarPage() {
  const session = await requireSession();

  const [rows, settings] = await Promise.all([
    listMeetings(session.user.id),
    getCalendarSettings(session.user.id),
  ]);

  const timeZone = settings?.timezone ?? DEFAULT_CALENDAR_SETTINGS.timezone;

  const meetings: AgendaMeeting[] = rows.map((row) => ({
    id: row.id,
    threadId: row.threadId,
    subject: row.subject,
    startAt: row.startAt ? row.startAt.toISOString() : null,
    endAt: row.endAt ? row.endAt.toISOString() : null,
    meetLink: row.meetLink,
    status: row.status,
  }));

  const { upcoming, past, unscheduled, cancelled } = splitAgenda(meetings);
  const activeCount = meetings.length - cancelled.length;

  const subtitle =
    activeCount === 0
      ? "Meetings your assistant books will appear here."
      : `${upcoming.length} upcoming · ${activeCount} booked`;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Calendar" subtitle={subtitle} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <MeetingAgenda
          upcoming={upcoming}
          past={past}
          unscheduled={unscheduled}
          cancelled={cancelled}
          timeZone={timeZone}
        />
      </div>
    </div>
  );
}
