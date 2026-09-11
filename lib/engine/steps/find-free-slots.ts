import "server-only";

import { z } from "zod";

import { DEFAULT_CALENDAR_SETTINGS, getCalendarSettings } from "@/lib/calendar/settings";
import { queryFreeBusy } from "@/lib/calendar/freebusy";
import { computeFreeSlots } from "@/lib/calendar/slots";
import { addUtcDays } from "@/lib/calendar/tz";
import { defineStep } from "@/lib/engine/step";

/**
 * Computes bookable slots from working hours minus real busy time. Best-effort:
 * if Google Calendar is unreachable the step still returns working-hours slots
 * (busy = none) rather than failing the run.
 */
export const findFreeSlotsStep = defineStep({
  type: "find-free-slots",
  policy: "best_effort",
  configSchema: z.object({
    count: z.number().int().min(1).max(10).default(3),
    horizonDays: z.number().int().min(1).max(30).default(7),
  }),
  async run(ctx) {
    const row = await getCalendarSettings(ctx.userId);
    const values = row ?? DEFAULT_CALENDAR_SETTINGS;
    const now = new Date();

    let busy: Awaited<ReturnType<typeof queryFreeBusy>> = [];
    try {
      busy = await queryFreeBusy({
        userId: ctx.userId,
        timeMin: now,
        timeMax: addUtcDays(now, ctx.input.horizonDays),
      });
    } catch (error) {
      ctx.log("find-free-slots:freebusy-unavailable", {
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const slots = computeFreeSlots({
      now,
      settings: {
        timeZone: values.timezone,
        workDays: values.workDays,
        workStartHour: values.workStartHour,
        workEndHour: values.workEndHour,
        bufferMins: values.bufferMins,
        durationMins: values.defaultDurationMins,
      },
      busy,
      count: ctx.input.count,
      horizonDays: ctx.input.horizonDays,
    });

    ctx.log("find-free-slots", { slots: slots.length, busy: busy.length });
    return {
      slots: slots.map((slot) => ({
        startUtc: slot.startUtc.toISOString(),
        endUtc: slot.endUtc.toISOString(),
      })),
    };
  },
});
