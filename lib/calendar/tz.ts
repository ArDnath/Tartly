/**
 * Timezone math with no external dependency.
 *
 * Everything is stored as a UTC instant; local wall-clock times only exist
 * while computing a slot. These helpers are pure and unit-tested (including a
 * DST boundary) in `scripts/email-operator/phase4-meetings.ts`.
 */

export type ZonedParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
};

function partsToRecord(parts: Intl.DateTimeFormatPart[]): ZonedParts {
  const record: Record<string, number> = {};
  for (const part of parts) {
    if (part.type === "literal") continue;
    record[part.type] = Number(part.value);
  }
  return {
    year: record.year,
    month: record.month,
    day: record.day,
    hour: record.hour === 24 ? 0 : record.hour,
    minute: record.minute,
  };
}

/** The wall-clock parts of `date` in `timeZone`. */
export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return partsToRecord(formatter.formatToParts(date));
}

/** Offset of `timeZone` from UTC, in milliseconds, at `date`. */
export function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
  return asUtc - Math.floor(date.getTime() / 60_000) * 60_000;
}

/**
 * Converts a wall-clock time in `timeZone` to the corresponding UTC instant.
 * Runs the offset correction twice so DST transitions resolve correctly.
 */
export function zonedTimeToUtc(parts: ZonedParts, timeZone: string): Date {
  const guess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );

  const firstOffset = getTimeZoneOffsetMs(new Date(guess), timeZone);
  const first = guess - firstOffset;
  const secondOffset = getTimeZoneOffsetMs(new Date(first), timeZone);
  return new Date(guess - secondOffset);
}

/** ISO weekday in `timeZone`: 1 = Monday … 7 = Sunday. */
export function getIsoWeekday(date: Date, timeZone: string): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(date);
  const map: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return map[weekday] ?? 1;
}

/** Formats an instant in a given zone, e.g. "Tue, Jan 6 · 15:00". */
export function formatSlotLabel(
  date: Date,
  timeZone: string,
  locale = "en-US",
): string {
  const day = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${day} · ${time} (${timeZone})`;
}

/** Adds whole days to a UTC instant (safe across DST because it is instant-based). */
export function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Adds whole minutes to a UTC instant. */
export function addUtcMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}
