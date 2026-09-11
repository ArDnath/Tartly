import { z } from "zod";

import { ok, apiError, withUser } from "@/lib/api/http";
import {
  DEFAULT_CALENDAR_SETTINGS,
  getCalendarSettings,
  upsertCalendarSettings,
} from "@/lib/calendar/settings";

export const GET = withUser(async (userId) => {
  const settings = await getCalendarSettings(userId);
  return ok(settings ?? { userId, ...DEFAULT_CALENDAR_SETTINGS });
});

const patchSchema = z.object({
  timezone: z.string().min(1).max(100).optional(),
  workDays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
  workStartHour: z.number().int().min(0).max(23).optional(),
  workEndHour: z.number().int().min(1).max(24).optional(),
  bufferMins: z.number().int().min(0).max(180).optional(),
  defaultDurationMins: z.number().int().min(5).max(480).optional(),
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
