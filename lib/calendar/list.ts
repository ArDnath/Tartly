import "server-only";

import {
  calendarJson,
  defaultCalendarTransport,
  type CalendarTransport,
} from "@/lib/calendar/client";
import {
  normalizeCalendarEvent,
  type CalendarEvent,
  type GoogleEvent,
} from "@/lib/calendar/normalize";

export type { CalendarEvent, CalendarEventAttendee } from "@/lib/calendar/normalize";
export { normalizeCalendarEvent } from "@/lib/calendar/normalize";

/**
 * Read-side Google Calendar access.
 *
 * `events.list` is the source of truth for "what is on my calendar", including
 * events this app did not create. Normalization lives in `normalize.ts`; this
 * module owns only the request. Event text is third-party content and must be
 * treated as untrusted.
 */

type ListEventsResponse = {
  items?: GoogleEvent[];
  nextPageToken?: string;
};

/**
 * Lists events on the user's primary calendar in `[timeMin, timeMax)`, soonest
 * first. `query` maps to Google's `q` free-text search. Bounded to 250 events.
 */
export async function listCalendarEvents({
  userId,
  timeMin,
  timeMax,
  query,
  maxResults = 20,
  transport = defaultCalendarTransport,
}: {
  userId: string;
  timeMin: Date;
  timeMax: Date;
  query?: string;
  maxResults?: number;
  transport?: CalendarTransport;
}): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(Math.max(1, Math.min(maxResults, 250))),
  });
  if (query) params.set("q", query);

  const response = await calendarJson<ListEventsResponse>(
    userId,
    `/calendars/primary/events?${params.toString()}`,
    undefined,
    transport,
  );

  return (response.items ?? []).map(normalizeCalendarEvent);
}
