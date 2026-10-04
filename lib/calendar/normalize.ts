/**
 * Pure Google Calendar event normalization. Kept free of `server-only` and any
 * transport so it can be unit-tested (and reused by client-safe code) without
 * pulling in the network or the database.
 *
 * Event text is third-party content: callers must treat `summary`,
 * `description`, and `location` as untrusted.
 */

export type CalendarEventAttendee = {
  email: string;
  name: string | null;
  responseStatus: string | null;
  /** True for the authenticated user's own attendee entry. */
  self: boolean;
  organizer: boolean;
};

export type CalendarEvent = {
  id: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  status: string | null;
  /** ISO timestamp, or `YYYY-MM-DD` for an all-day event. */
  start: string | null;
  end: string | null;
  allDay: boolean;
  organizer: string | null;
  attendees: CalendarEventAttendee[];
  htmlLink: string | null;
  meetLink: string | null;
  recurringEventId: string | null;
};

export type GoogleDate = { dateTime?: string; date?: string; timeZone?: string };

export type GoogleEventAttendee = {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  self?: boolean;
  organizer?: boolean;
};

export type GoogleEvent = {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  start?: GoogleDate;
  end?: GoogleDate;
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: GoogleEventAttendee[];
  htmlLink?: string;
  hangoutLink?: string;
  recurringEventId?: string;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
};

/** Google's Meet link is either the legacy `hangoutLink` or a conference entry. */
export function meetLinkFor(event: GoogleEvent): string | null {
  if (event.hangoutLink) return event.hangoutLink;
  const video = event.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === "video",
  );
  return video?.uri ?? null;
}

/** Flatten Google's date union + attendee list into the app's stable shape. */
export function normalizeCalendarEvent(event: GoogleEvent): CalendarEvent {
  const allDay = Boolean(event.start?.date) && !event.start?.dateTime;
  return {
    id: event.id ?? "",
    summary: event.summary ?? null,
    description: event.description ?? null,
    location: event.location ?? null,
    status: event.status ?? null,
    start: event.start?.dateTime ?? event.start?.date ?? null,
    end: event.end?.dateTime ?? event.end?.date ?? null,
    allDay,
    organizer: event.organizer?.email ?? null,
    attendees: (event.attendees ?? []).map((attendee) => ({
      email: attendee.email ?? "",
      name: attendee.displayName ?? null,
      responseStatus: attendee.responseStatus ?? null,
      self: Boolean(attendee.self),
      organizer: Boolean(attendee.organizer),
    })),
    htmlLink: event.htmlLink ?? null,
    meetLink: meetLinkFor(event),
    recurringEventId: event.recurringEventId ?? null,
  };
}
