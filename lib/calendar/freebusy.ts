import "server-only";

import {
  calendarJson,
  defaultCalendarTransport,
  type CalendarTransport,
} from "@/lib/calendar/client";
import type { BusyInterval } from "@/lib/calendar/slots";

type FreeBusyResponse = {
  calendars?: Record<
    string,
    { busy?: Array<{ start?: string; end?: string }> }
  >;
};

/**
 * `freebusy.query` for the user's calendars. Returns padded-free busy
 * intervals; callers intersect them with working hours.
 */
export async function queryFreeBusy({
  userId,
  timeMin,
  timeMax,
  calendarIds = ["primary"],
  transport = defaultCalendarTransport,
}: {
  userId: string;
  timeMin: Date;
  timeMax: Date;
  calendarIds?: string[];
  transport?: CalendarTransport;
}): Promise<BusyInterval[]> {
  const response = await calendarJson<FreeBusyResponse>(
    userId,
    "/freeBusy",
    {
      method: "POST",
      body: JSON.stringify({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: calendarIds.map((id) => ({ id })),
      }),
    },
    transport,
  );

  const intervals: BusyInterval[] = [];
  for (const calendar of Object.values(response.calendars ?? {})) {
    for (const slot of calendar.busy ?? []) {
      if (!slot.start || !slot.end) continue;
      intervals.push({ start: new Date(slot.start), end: new Date(slot.end) });
    }
  }
  return intervals;
}
