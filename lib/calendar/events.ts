import "server-only";

import {
  calendarJson,
  defaultCalendarTransport,
  type CalendarTransport,
} from "@/lib/calendar/client";
import { GmailApiError } from "@/lib/gmail/client";

export type CreatedEvent = {
  id: string;
  htmlLink: string | null;
  meetLink: string | null;
};

type CalendarEventResponse = {
  id?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
};

/**
 * Creates an event on the user's primary calendar with a Google Meet link.
 * `conferenceDataVersion=1` is required for `conferenceData` to take effect.
 */
export async function createCalendarEvent({
  userId,
  summary,
  description,
  startUtc,
  endUtc,
  timeZone,
  attendees,
  requestId,
  transport = defaultCalendarTransport,
}: {
  userId: string;
  summary: string;
  description?: string;
  startUtc: Date;
  endUtc: Date;
  timeZone: string;
  attendees?: string[];
  requestId?: string;
  transport?: CalendarTransport;
}): Promise<CreatedEvent> {
  const response = await calendarJson<CalendarEventResponse>(
    userId,
    "/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",
    {
      method: "POST",
      body: JSON.stringify({
        summary,
        ...(description ? { description } : {}),
        start: { dateTime: startUtc.toISOString(), timeZone },
        end: { dateTime: endUtc.toISOString(), timeZone },
        ...(attendees?.length
          ? { attendees: attendees.map((email) => ({ email })) }
          : {}),
        conferenceData: {
          createRequest: {
            requestId: requestId ?? `${userId}-${startUtc.getTime()}`,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      }),
    },
    transport,
  );

  const videoEntry = response.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === "video",
  );

  return {
    id: response.id ?? "",
    htmlLink: response.htmlLink ?? null,
    meetLink: response.hangoutLink ?? videoEntry?.uri ?? null,
  };
}

/** Moves an existing event to a new time. */
export async function updateCalendarEvent({
  userId,
  eventId,
  startUtc,
  endUtc,
  timeZone,
  summary,
  transport = defaultCalendarTransport,
}: {
  userId: string;
  eventId: string;
  startUtc: Date;
  endUtc: Date;
  timeZone: string;
  summary?: string;
  transport?: CalendarTransport;
}): Promise<void> {
  await calendarJson<CalendarEventResponse>(
    userId,
    `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    {
      method: "PATCH",
      body: JSON.stringify({
        ...(summary ? { summary } : {}),
        start: { dateTime: startUtc.toISOString(), timeZone },
        end: { dateTime: endUtc.toISOString(), timeZone },
      }),
    },
    transport,
  );
}

export type CalendarResponseStatus =
  | "accepted"
  | "declined"
  | "tentative"
  | "needsAction";

type EventAttendeesResponse = {
  attendees?: Array<{
    email?: string;
    responseStatus?: string;
    self?: boolean;
  }>;
};

/**
 * Sets the authenticated user's RSVP on an event.
 *
 * Google has no "respond" endpoint: the response lives on the attendee entry.
 * A PATCH sends only the fields present, but a partial `attendees` array can
 * drop the other guests, so we read the current attendees first and PATCH the
 * full list with only the self entry's status changed. `sendUpdates=none`
 * keeps an RSVP from emailing the whole invite list.
 */
export async function respondToCalendarEvent({
  userId,
  eventId,
  responseStatus,
  transport = defaultCalendarTransport,
}: {
  userId: string;
  eventId: string;
  responseStatus: CalendarResponseStatus;
  transport?: CalendarTransport;
}): Promise<{ responseStatus: CalendarResponseStatus }> {
  const event = await calendarJson<EventAttendeesResponse>(
    userId,
    `/calendars/primary/events/${encodeURIComponent(eventId)}`,
    undefined,
    transport,
  );

  const attendees = event.attendees ?? [];
  const self = attendees.find((attendee) => attendee.self);
  if (!self) {
    throw new GmailApiError(
      400,
      "Calendar event has no self attendee entry to respond to.",
    );
  }

  await calendarJson<CalendarEventResponse>(
    userId,
    `/calendars/primary/events/${encodeURIComponent(
      eventId,
    )}?sendUpdates=none`,
    {
      method: "PATCH",
      body: JSON.stringify({
        attendees: attendees.map((attendee) =>
          attendee.self
            ? { email: attendee.email, responseStatus }
            : { email: attendee.email },
        ),
      }),
    },
    transport,
  );

  return { responseStatus };
}

/**
 * Deletes an event. A 404/410 is treated as already gone — the caller is
 * cancelling a meeting, and an event that no longer exists is cancelled.
 */
export async function deleteCalendarEvent({
  userId,
  eventId,
  transport = defaultCalendarTransport,
}: {
  userId: string;
  eventId: string;
  transport?: CalendarTransport;
}): Promise<void> {
  const response = await transport(
    userId,
    `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    { method: "DELETE" },
  );

  if (!response.ok && response.status !== 404 && response.status !== 410) {
    const body = await response.text().catch(() => "");
    throw new GmailApiError(
      response.status,
      `Calendar API ${response.status}: ${body.slice(0, 300)}`,
    );
  }
}
