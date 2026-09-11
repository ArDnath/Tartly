import {
  addUtcDays,
  addUtcMinutes,
  getIsoWeekday,
  getZonedParts,
  zonedTimeToUtc,
} from "@/lib/calendar/tz";

/**
 * Pure slot computation. No network, no DB — the calendar free/busy result is
 * passed in, so the whole thing is unit-testable (tz + DST + buffer cases).
 */

export type BusyInterval = { start: Date; end: Date };

export type Slot = { startUtc: Date; endUtc: Date };

export type SlotSettings = {
  timeZone: string;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  workDays: number[];
  workStartHour: number;
  workEndHour: number;
  bufferMins: number;
  durationMins: number;
};

/** True when [start,end) overlaps any busy interval padded by `bufferMins`. */
export function overlapsBusy(
  start: Date,
  end: Date,
  busy: BusyInterval[],
  bufferMins: number,
): boolean {
  const bufferMs = bufferMins * 60_000;
  return busy.some((interval) => {
    const busyStart = interval.start.getTime() - bufferMs;
    const busyEnd = interval.end.getTime() + bufferMs;
    return start.getTime() < busyEnd && end.getTime() > busyStart;
  });
}

/**
 * Finds up to `count` bookable slots inside working hours, avoiding busy
 * intervals and leaving `bufferMins` around them. Slots are returned as UTC
 * instants; rendering in a timezone happens later.
 */
export function computeFreeSlots({
  now,
  settings,
  busy,
  count = 3,
  horizonDays = 7,
}: {
  now: Date;
  settings: SlotSettings;
  busy: BusyInterval[];
  count?: number;
  horizonDays?: number;
}): Slot[] {
  const slots: Slot[] = [];
  if (settings.workDays.length === 0) return slots;

  const stepMinutes = settings.durationMins + settings.bufferMins;

  for (let offset = 0; offset <= horizonDays && slots.length < count; offset += 1) {
    const localParts = getZonedParts(addUtcDays(now, offset), settings.timeZone);
    if (!settings.workDays.includes(getIsoWeekday(addUtcDays(now, offset), settings.timeZone))) {
      continue;
    }

    for (
      let minutes = settings.workStartHour * 60;
      minutes + settings.durationMins <= settings.workEndHour * 60;
      minutes += stepMinutes
    ) {
      const start = zonedTimeToUtc(
        {
          year: localParts.year,
          month: localParts.month,
          day: localParts.day,
          hour: Math.floor(minutes / 60),
          minute: minutes % 60,
        },
        settings.timeZone,
      );
      const end = addUtcMinutes(start, settings.durationMins);

      if (start.getTime() <= now.getTime()) continue;
      if (overlapsBusy(start, end, busy, settings.bufferMins)) continue;

      slots.push({ startUtc: start, endUtc: end });
      if (slots.length >= count) break;
    }
  }

  return slots;
}

/** Deterministic proposal id so a re-run updates the same meeting. */
export function buildProposalId(threadId: string, slots: Slot[]): string {
  const material = `${threadId}:${slots
    .map((slot) => slot.startUtc.toISOString())
    .join(",")}`;
  // Small, dependency-free hash (FNV-1a) — stable across processes.
  let hash = 0x811c9dc5;
  for (let index = 0; index < material.length; index += 1) {
    hash ^= material.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `prop_${(hash >>> 0).toString(16)}`;
}
