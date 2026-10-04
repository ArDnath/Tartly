import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import {
  DEFAULT_CALENDAR_SETTINGS,
  type CalendarSettingsValues,
} from "@/lib/calendar/defaults";
import { queryFreeBusy } from "@/lib/calendar/freebusy";
import { getCalendarSettings } from "@/lib/calendar/settings";
import { computeFreeSlots } from "@/lib/calendar/slots";
import { addUtcDays, formatSlotLabel } from "@/lib/calendar/tz";

import { recipientSchema, requireReadPermission } from "./shared";

/**
 * `check_google_calendar_availability` — READ.
 *
 * Finds bookable slots inside the user's working hours by intersecting Google
 * Calendar free/busy with the saved work profile. Pure slot computation lives
 * in `lib/calendar/slots.ts`; this tool only shapes the result for the model.
 * It never books anything — booking is an `update_calendar` side effect.
 */

const DEFAULT_HORIZON_DAYS = 7;
const DEFAULT_SLOT_COUNT = 3;

const inputSchema = z.object({
  durationMins: z
    .number()
    .int()
    .min(5)
    .max(480)
    .optional()
    .describe("Meeting length in minutes. Defaults to the saved preference."),
  count: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("How many slots to return. Defaults to 3."),
  withinDays: z
    .number()
    .int()
    .min(1)
    .max(30)
    .optional()
    .describe("How many days ahead to search. Defaults to 7."),
  timeZone: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe("IANA time zone for labels. Defaults to the saved preference."),
  attendees: z
    .array(recipientSchema)
    .max(20)
    .optional()
    .describe("Optional guest addresses whose calendars must also be free."),
});

export type CheckCalendarAvailabilityInput = z.infer<typeof inputSchema>;

type GetSettings = (userId: string) => Promise<CalendarSettingsValues | null>;
type FreeBusy = typeof queryFreeBusy;

function buildCheckCalendarAvailabilityTool(
  deps: { getSettings: GetSettings; freeBusy: FreeBusy },
): AnyToolDefinition {
  return defineTool({
    name: "check_google_calendar_availability",
    description:
      "Find open time slots on the user's calendar (and optional guests') within working hours over the next few days. Returns suggested start/end instants and human labels. Read-only: use update_calendar to actually create the event.",
    risk: "READ",
    inputSchema,
    authorize(ctx) {
      requireReadPermission(ctx);
    },
    async execute(ctx, input) {
      const settings =
        (await deps.getSettings(ctx.userId)) ?? DEFAULT_CALENDAR_SETTINGS;
      const timeZone = input.timeZone ?? settings.timezone;
      const durationMins = input.durationMins ?? settings.defaultDurationMins;
      const withinDays = input.withinDays ?? DEFAULT_HORIZON_DAYS;
      const count = input.count ?? DEFAULT_SLOT_COUNT;

      const timeMin = ctx.now;
      const timeMax = addUtcDays(timeMin, withinDays);

      const busy = await deps.freeBusy({
        userId: ctx.userId,
        timeMin,
        timeMax,
        calendarIds: ["primary", ...(input.attendees ?? [])],
      });

      const slots = computeFreeSlots({
        now: timeMin,
        settings: {
          timeZone,
          workDays: settings.workDays,
          workStartHour: settings.workStartHour,
          workEndHour: settings.workEndHour,
          bufferMins: settings.bufferMins,
          durationMins,
        },
        busy,
        count,
        horizonDays: withinDays,
      });

      return {
        timeZone,
        durationMins,
        bufferMins: settings.bufferMins,
        searched: { from: timeMin.toISOString(), to: timeMax.toISOString() },
        count: slots.length,
        slots: slots.map((slot) => ({
          startUtc: slot.startUtc.toISOString(),
          endUtc: slot.endUtc.toISOString(),
          label: formatSlotLabel(slot.startUtc, timeZone),
        })),
        notice: slots.length
          ? "These are working-hour suggestions with buffers. Confirm the exact slot with the user before creating an event."
          : "No open slots were found in the requested window. Try a longer window or a different duration.",
      };
    },
  });
}

/** `check_google_calendar_availability` — READ. Injectable for tests. */
export function createCheckCalendarAvailabilityTool(
  deps: { getSettings?: GetSettings; freeBusy?: FreeBusy } = {},
): AnyToolDefinition {
  return buildCheckCalendarAvailabilityTool({
    getSettings: deps.getSettings ?? getCalendarSettings,
    freeBusy: deps.freeBusy ?? queryFreeBusy,
  });
}

export const checkCalendarAvailabilityTool = buildCheckCalendarAvailabilityTool({
  getSettings: getCalendarSettings,
  freeBusy: queryFreeBusy,
});
