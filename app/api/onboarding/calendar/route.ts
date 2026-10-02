import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError } from "@/lib/api/error-envelope";
import {
  DEFAULT_CALENDAR_SETTINGS,
  upsertCalendarSettings,
} from "@/lib/calendar/settings";
import { patchOnboardingState } from "@/lib/onboarding/server";
import { getSession } from "@/lib/session";

const bodySchema = z.object({
  timezone: z.string().min(1).max(100),
  workDays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  workStartHour: z.number().int().min(0).max(23),
  workEndHour: z.number().int().min(1).max(24),
  bufferMins: z.number().int().min(0).max(180),
  defaultDurationMins: z.number().int().min(5).max(480),
});

/**
 * Saves the calendar/working-hours profile collected on the CALENDAR_SETUP
 * onboarding step. Advancing the state machine stays the client's job (via
 * `/api/onboarding/advance`) so the optimistic UI stays consistent.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user) {
    return jsonError("unauthorized", "Unauthorized", 401);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return jsonError("validation", "Invalid request", 400, {
      details: parsed.error.flatten(),
    });
  }

  const input = parsed.data;
  if (input.workEndHour <= input.workStartHour) {
    return jsonError(
      "validation",
      "Work end hour must be after the start hour",
      400,
    );
  }

  const userId = session.user.id;

  await upsertCalendarSettings(userId, {
    ...DEFAULT_CALENDAR_SETTINGS,
    ...input,
  });

  const state = await patchOnboardingState(userId, {
    calendarTimezone: input.timezone,
    connectedCalendarProvider: "google",
  });

  return NextResponse.json({ state });
}
