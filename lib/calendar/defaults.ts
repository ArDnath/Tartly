/**
 * Client-safe calendar defaults. Kept separate from `lib/calendar/settings.ts`
 * (which is server-only and touches the database) so client components can
 * import these without pulling `server-only` into the bundle.
 */

export type CalendarSettingsValues = {
  timezone: string;
  /** ISO weekday numbers, 1 = Monday … 7 = Sunday. */
  workDays: number[];
  workStartHour: number;
  workEndHour: number;
  bufferMins: number;
  defaultDurationMins: number;
};

export const DEFAULT_CALENDAR_SETTINGS: CalendarSettingsValues = {
  timezone: "UTC",
  workDays: [1, 2, 3, 4, 5],
  workStartHour: 9,
  workEndHour: 18,
  bufferMins: 15,
  defaultDurationMins: 30,
};
