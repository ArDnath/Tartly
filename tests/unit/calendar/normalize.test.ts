import { describe, expect, it } from "vitest";

import { normalizeCalendarEvent } from "@/lib/calendar/normalize";

describe("calendar/normalize", () => {
  it("flattens a timed event with attendees and a Meet link", () => {
    const event = normalizeCalendarEvent({
      id: "evt_1",
      summary: "Standup",
      description: "Daily sync",
      location: "Zoom",
      status: "confirmed",
      start: { dateTime: "2026-01-06T15:00:00Z", timeZone: "UTC" },
      end: { dateTime: "2026-01-06T15:30:00Z", timeZone: "UTC" },
      organizer: { email: "boss@acme.com" },
      attendees: [
        { email: "boss@acme.com", responseStatus: "accepted", organizer: true },
        { email: "me@acme.com", responseStatus: "needsAction", self: true },
      ],
      conferenceData: {
        entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc" }],
      },
    });

    expect(event.start).toBe("2026-01-06T15:00:00Z");
    expect(event.allDay).toBe(false);
    expect(event.organizer).toBe("boss@acme.com");
    expect(event.meetLink).toBe("https://meet.google.com/abc");
    expect(event.attendees).toHaveLength(2);
    expect(event.attendees.find((a) => a.self)?.responseStatus).toBe("needsAction");
  });

  it("marks an all-day event and prefers a legacy hangout link", () => {
    const event = normalizeCalendarEvent({
      id: "evt_2",
      start: { date: "2026-01-06" },
      end: { date: "2026-01-07" },
      hangoutLink: "https://meet.google.com/legacy",
    });
    expect(event.allDay).toBe(true);
    expect(event.start).toBe("2026-01-06");
    expect(event.meetLink).toBe("https://meet.google.com/legacy");
    expect(event.attendees).toEqual([]);
  });

  it("handles a minimally-populated event without throwing", () => {
    const event = normalizeCalendarEvent({});
    expect(event.id).toBe("");
    expect(event.summary).toBeNull();
    expect(event.allDay).toBe(false);
  });
});
