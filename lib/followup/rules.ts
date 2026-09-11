import {
  addUtcDays,
  getIsoWeekday,
  getZonedParts,
  zonedTimeToUtc,
  type ZonedParts,
} from "@/lib/calendar/tz";

/**
 * Pure follow-up rules: unreachable-address exclusion and quiet-hours /
 * weekend deferral. No DB, no network.
 */

const UNREACHABLE_LOCAL_PARTS = [
  "mailer-daemon",
  "postmaster",
  "no-reply",
  "noreply",
  "donotreply",
  "do-not-reply",
  "bounce",
  "notifications",
];

/** Addresses the operator must never follow up (bounces, robots, opt-out). */
export function isUnreachableAddress(email: string | null | undefined): boolean {
  if (!email) return true;
  const normalized = email.toLowerCase().trim();
  if (!normalized.includes("@")) return true;

  const localPart = normalized.split("@")[0] ?? "";
  return UNREACHABLE_LOCAL_PARTS.some(
    (pattern) => localPart === pattern || localPart.startsWith(`${pattern}+`),
  );
}

export type DeliverableWindow = {
  timeZone: string;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  workDays: number[];
  workStartHour: number;
  quietEndHour: number;
};

/**
 * Moves `date` forward to the next deliverable moment: inside working hours and
 * on an allowed weekday. Follow-ups are never sent at night or on weekends.
 */
export function nextDeliverableTime(
  date: Date,
  window: DeliverableWindow,
): Date {
  let cursor = new Date(date);

  for (let attempts = 0; attempts < 14; attempts += 1) {
    const parts = getZonedParts(cursor, window.timeZone);
    const weekday = getIsoWeekday(cursor, window.timeZone);
    const hour = parts.hour;

    if (!window.workDays.includes(weekday)) {
      cursor = startOfNextLocalDay(parts, window.timeZone);
      continue;
    }

    if (hour < window.workStartHour) {
      return zonedTimeToUtc(
        { ...parts, hour: window.workStartHour, minute: 0 },
        window.timeZone,
      );
    }

    if (hour >= window.quietEndHour) {
      cursor = startOfNextLocalDay(parts, window.timeZone);
      continue;
    }

    return cursor;
  }

  return cursor;
}

function startOfNextLocalDay(parts: ZonedParts, timeZone: string): Date {
  const nextDayUtc = addUtcDays(
    zonedTimeToUtc({ ...parts, hour: 12, minute: 0 }, timeZone),
    1,
  );
  const nextParts = getZonedParts(nextDayUtc, timeZone);
  return zonedTimeToUtc(
    { ...nextParts, hour: 0, minute: 0 },
    timeZone,
  );
}
