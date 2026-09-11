import { NextResponse } from "next/server";
import { z } from "zod";

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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const input = parsed.data;
  if (input.workEndHour <= input.workStartHour) {
    return NextResponse.json(
      { error: "Work end hour must be after the start hour" },
      { status: 400 },
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
