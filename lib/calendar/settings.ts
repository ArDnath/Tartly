import "server-only";

import {
  DEFAULT_CALENDAR_SETTINGS,
  type CalendarSettingsValues,
} from "@/lib/calendar/defaults";
import {
  calendarPersistenceRepository,
  type CalendarSettings,
} from "@/lib/repositories/calendar-persistence";

export type CalendarSettingsInput = CalendarSettingsValues;

export type CalendarSettingsRow = CalendarSettings;

export { DEFAULT_CALENDAR_SETTINGS };

export async function getCalendarSettings(
  userId: string,
): Promise<CalendarSettingsRow | null> {
  const row = await calendarPersistenceRepository.findSettingsByUser(userId);
  return row ?? null;
}

/** Upserts the working-hours profile for a user. */
export async function upsertCalendarSettings(
  userId: string,
  input: CalendarSettingsInput,
): Promise<CalendarSettingsRow> {
  return calendarPersistenceRepository.upsertSettings({ userId, values: input });
}
