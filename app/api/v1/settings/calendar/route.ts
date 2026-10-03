import { ok, apiError, withUser } from "@/lib/api/http";
import { calendarPatchBody as patchSchema } from "@/lib/api/contracts/settings";
import {
  DEFAULT_CALENDAR_SETTINGS,
  getCalendarSettings,
  upsertCalendarSettings,
} from "@/lib/calendar/settings";

export const GET = withUser(async (userId) => {
  const settings = await getCalendarSettings(userId);
  return ok(settings ?? { userId, ...DEFAULT_CALENDAR_SETTINGS });
});

export const PATCH = withUser(async (userId, request) => {
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError("bad_request", "Invalid calendar settings", 400);
  }

  const existing = (await getCalendarSettings(userId)) ?? {
    ...DEFAULT_CALENDAR_SETTINGS,
  };

  const next = {
    timezone: parsed.data.timezone ?? existing.timezone,
    workDays: parsed.data.workDays ?? existing.workDays,
    workStartHour: parsed.data.workStartHour ?? existing.workStartHour,
    workEndHour: parsed.data.workEndHour ?? existing.workEndHour,
    bufferMins: parsed.data.bufferMins ?? existing.bufferMins,
    defaultDurationMins:
      parsed.data.defaultDurationMins ?? existing.defaultDurationMins,
  };

  if (next.workEndHour <= next.workStartHour) {
    return apiError("bad_request", "Work end hour must follow the start hour", 400);
  }

  const saved = await upsertCalendarSettings(userId, next);
  return ok(saved);
});
