import { NextResponse } from "next/server";

import { jsonError } from "@/lib/api/error-envelope";
import { onboardingCalendarBody as bodySchema } from "@/lib/api/contracts/legacy";
import { enforceUserRateLimit } from "@/lib/api/http";
import {
  DEFAULT_CALENDAR_SETTINGS,
  upsertCalendarSettings,
} from "@/lib/calendar/settings";
import { patchOnboardingState } from "@/lib/onboarding/server";
import { getSession } from "@/lib/session";

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

  const limited = await enforceUserRateLimit(session.user.id, {
    scope: "legacy",
  });
  if (limited) return limited;

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
