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
