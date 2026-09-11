/**
 * Small, dependency-free parser for the times people type at the calendar
 * assistant ("tomorrow at 3pm", "next monday", "in 2 hours"). Client-safe.
 */

export type ParsedSlot = {
  start: Date;
  end: Date;
  /** Human label, e.g. "Tomorrow at 3:00 PM". */
  label: string;
};

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const DEFAULT_HOUR = 9;
export const DEFAULT_MEETING_MINS = 30;

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

export function extractEmails(input: string): string[] {
  return Array.from(new Set(input.match(EMAIL_PATTERN) ?? []));
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function formatLabel(start: Date): string {
  return start.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function parseClock(text: string): { hours: number; minutes: number } | null {
  const match =
    text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/) ??
    text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3];

  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;

  return { hours, minutes };
}

export function parseWhen(
  input: string,
  now: Date = new Date(),
  durationMins: number = DEFAULT_MEETING_MINS,
): ParsedSlot | null {
  const text = input.toLowerCase();
  const clock = parseClock(text);

  // Relative — "in 2 hours", "in 30 minutes".
  const relative = text.match(
    /\bin\s+(\d+)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/,
  );
  if (relative) {
    const amount = Number(relative[1]);
    const start = new Date(now);
    start.setSeconds(0, 0);
    if (relative[2].startsWith("m")) {
      start.setMinutes(start.getMinutes() + amount);
    } else {
      start.setHours(start.getHours() + amount);
    }
    return { start, end: addMinutes(start, durationMins), label: formatLabel(start) };
  }

  let dayOffset: number | null = null;
  if (/\btoday\b/.test(text)) {
    dayOffset = 0;
  } else if (/\btomorrow\b/.test(text)) {
    dayOffset = 1;
  } else if (/\bnext week\b/.test(text)) {
    dayOffset = 7;
  } else {
    const index = WEEKDAYS.findIndex((day) =>
      new RegExp(`\\b${day}\\b`).test(text),
    );
    if (index >= 0) {
      const diff = (index - now.getDay() + 7) % 7;
      dayOffset = diff === 0 ? 7 : diff;
    }
  }

  if (dayOffset === null && !clock) return null;

  const start = new Date(now);
  start.setSeconds(0, 0);
  if (dayOffset !== null) start.setDate(start.getDate() + dayOffset);

  if (clock) {
    start.setHours(clock.hours, clock.minutes);
    // A bare time already past rolls forward to tomorrow.
    if (dayOffset === null && start.getTime() <= now.getTime()) {
      start.setDate(start.getDate() + 1);
    }
  } else {
    start.setHours(DEFAULT_HOUR, 0, 0, 0);
  }

  return { start, end: addMinutes(start, durationMins), label: formatLabel(start) };
}
