import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { calendarSettings } from "@/lib/db/schema";
import {
  DEFAULT_CALENDAR_SETTINGS,
  type CalendarSettingsValues,
} from "@/lib/calendar/defaults";

export type CalendarSettingsInput = CalendarSettingsValues;

export type CalendarSettingsRow = typeof calendarSettings.$inferSelect;

export { DEFAULT_CALENDAR_SETTINGS };

export async function getCalendarSettings(
  userId: string,
): Promise<CalendarSettingsRow | null> {
  const rows = await db
    .select()
    .from(calendarSettings)
    .where(eq(calendarSettings.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

/** Upserts the working-hours profile for a user. */
export async function upsertCalendarSettings(
  userId: string,
  input: CalendarSettingsInput,
): Promise<CalendarSettingsRow> {
  const inserted = await db
    .insert(calendarSettings)
    .values({ userId, ...input })
    .onConflictDoUpdate({
      target: calendarSettings.userId,
      set: { ...input, updatedAt: new Date() },
    })
    .returning();

  return inserted[0];
}
