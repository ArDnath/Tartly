import { NextResponse } from "next/server";

import { jsonError } from "@/lib/api/error-envelope";
import { enforceUserRateLimit } from "@/lib/api/http";
import { getOrCreateOnboardingState } from "@/lib/onboarding/server";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session?.user) {
    return jsonError("unauthorized", "Unauthorized", 401);
  }

  const limited = await enforceUserRateLimit(session.user.id, {
    scope: "legacy",
  });
  if (limited) return limited;

  const snapshot = await getOrCreateOnboardingState(session.user.id);

  return NextResponse.json({ state: snapshot });
}
