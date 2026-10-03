import { NextResponse } from "next/server";

import { jsonError } from "@/lib/api/error-envelope";
import { onboardingAdvanceBody as bodySchema } from "@/lib/api/contracts/legacy";
import { enforceUserRateLimit } from "@/lib/api/http";
import { userRepository } from "@/lib/repositories/users";
import {
  advanceOnboarding,
  getOrCreateOnboardingState,
  type OnboardingStatusPatch,
} from "@/lib/onboarding/server";
import { ONBOARDING_STATUS } from "@/lib/onboarding/types";
import { getSession } from "@/lib/session";

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

  const { action, data } = parsed.data;
  const userId = session.user.id;
  const current = await getOrCreateOnboardingState(userId);

  const statusPatch: OnboardingStatusPatch = {};

  switch (current.status) {
    case ONBOARDING_STATUS.PROFILE_CREATION: {
      const firstName = data.firstName ?? "";
      const lastName = data.lastName ?? "";
      if (action === "complete" && !firstName) {
        return jsonError("validation", "First name is required", 400);
      }

      if (firstName || lastName) {
        await userRepository.updateName({
          userId,
          name: `${firstName} ${lastName}`.trim(),
          now: new Date(),
        });
      }

      statusPatch.jobTitle = data.jobTitle ?? null;
      if (data.image) {
        statusPatch.avatarUrl = data.image;
      }
      break;
    }

    case ONBOARDING_STATUS.SYNC_EMAIL: {
      // Syncing an inbox is required, so this step deliberately has no skip.
      if (action === "skip") {
        return jsonError("validation", "This step can't be skipped", 400);
      }
      break;
    }

    default:
      break;
  }

  // Every onboarding step stays in the in-app history. The back button must
  // undo onboarding state, never browser history or the Google OAuth flow.
  const stepHistoryEffect = "recordAsReversible" as const;

  const { snapshot, justCompleted } = await advanceOnboarding({
    userId,
    stepHistoryEffect,
    statusPatch: Object.keys(statusPatch).length ? statusPatch : undefined,
  });

  return NextResponse.json({ state: snapshot, justCompleted });
}
