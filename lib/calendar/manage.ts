import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
  type CreatedEvent,
} from "@/lib/calendar/events";
import {
  DEFAULT_CALENDAR_SETTINGS,
  getCalendarSettings,
} from "@/lib/calendar/settings";
import { db } from "@/lib/db";
import { meetings } from "@/lib/db/schema";

export type MeetingRow = typeof meetings.$inferSelect;

/** Serializable meeting shape used by the API and the assistant rail. */
export type MeetingDto = {
  id: string;
  threadId: string | null;
  subject: string | null;
  startAt: string | null;
  endAt: string | null;
  meetLink: string | null;
  status: string;
};

export function toMeetingDto(meeting: MeetingRow): MeetingDto {
  return {
    id: meeting.id,
    threadId: meeting.threadId,
    subject: meeting.subject,
    startAt: meeting.startAt ? meeting.startAt.toISOString() : null,
    endAt: meeting.endAt ? meeting.endAt.toISOString() : null,
    meetLink: meeting.meetLink,
    status: meeting.status,
  };
}

type CreateEvent = (args: {
  userId: string;
  summary: string;
  startUtc: Date;
  endUtc: Date;
  timeZone: string;
  attendees?: string[];
  requestId?: string;
}) => Promise<CreatedEvent>;

type UpdateEvent = (args: {
  userId: string;
  eventId: string;
  startUtc: Date;
  endUtc: Date;
  timeZone: string;
  summary?: string;
}) => Promise<void>;

type DeleteEvent = (args: {
  userId: string;
  eventId: string;
}) => Promise<void>;

export async function findMeetingForUser(
  userId: string,
  meetingId: string,
): Promise<MeetingRow | null> {
  const rows = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Cancels a meeting: removes the Google Calendar event (best effort — an event
 * that no longer exists is already cancelled) and flips the row to
 * `cancelled`, which keeps it in the agenda for history.
 */
export async function cancelMeeting({
  userId,
  meetingId,
  deleteEvent = deleteCalendarEvent,
}: {
  userId: string;
  meetingId: string;
  deleteEvent?: DeleteEvent;
}): Promise<MeetingRow | null> {
  const meeting = await findMeetingForUser(userId, meetingId);
  if (!meeting) return null;

  if (meeting.calendarEventId) {
    try {
      await deleteEvent({ userId, eventId: meeting.calendarEventId });
    } catch (error) {
      console.warn("[calendar] failed to delete Google event", error);
    }
  }

  const updated = await db
    .update(meetings)
    .set({ status: "cancelled" })
    .where(and(eq(meetings.id, meetingId), eq(meetings.userId, userId)))
    .returning();

  return updated[0] ?? null;
}

/** Moves a meeting (and its Google event) to a new time. */
export async function rescheduleMeeting({
  userId,
  meetingId,
  startUtc,
  endUtc,
  updateEvent = updateCalendarEvent,
}: {
  userId: string;
  meetingId: string;
  startUtc: Date;
  endUtc: Date;
  updateEvent?: UpdateEvent;
}): Promise<MeetingRow | null> {
  const meeting = await findMeetingForUser(userId, meetingId);
  if (!meeting) return null;

  const settings =
    (await getCalendarSettings(userId)) ?? DEFAULT_CALENDAR_SETTINGS;

  if (meeting.calendarEventId) {
    await updateEvent({
      userId,
      eventId: meeting.calendarEventId,
      startUtc,
      endUtc,
      timeZone: settings.timezone,
      summary: meeting.subject ?? undefined,
    });
  }

  const updated = await db
    .update(meetings)
    .set({ startAt: startUtc, endAt: endUtc, status: "confirmed" })
    .where(and(eq(meetings.id, meetingId), eq(meetings.userId, userId)))
    .returning();

  return updated[0] ?? null;
}

/**
 * Creates a standalone meeting — one that didn't come from an email thread.
 * `threadId`/`proposalId` stay null; the unique index only constrains pairs of
 * non-null values, so several ad-hoc meetings can coexist.
 */
export async function createAdHocMeeting({
  userId,
  subject,
  startUtc,
  endUtc,
  attendees,
  createEvent = createCalendarEvent,
}: {
  userId: string;
  subject: string;
  startUtc: Date;
  endUtc: Date;
  attendees?: string[];
  createEvent?: CreateEvent;
}): Promise<MeetingRow> {
  const settings =
    (await getCalendarSettings(userId)) ?? DEFAULT_CALENDAR_SETTINGS;

  const event = await createEvent({
    userId,
    summary: subject,
    startUtc,
    endUtc,
    timeZone: settings.timezone,
    attendees,
    requestId: nanoid(),
  });

  const inserted = await db
    .insert(meetings)
    .values({
      id: nanoid(),
      userId,
      threadId: null,
      calendarEventId: event.id || null,
      proposalId: null,
      subject,
      startAt: startUtc,
      endAt: endUtc,
      meetLink: event.meetLink,
      status: "confirmed",
    })
    .returning();

  return inserted[0];
}
