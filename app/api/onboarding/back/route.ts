import { NextResponse } from "next/server";

import { jsonError } from "@/lib/api/error-envelope";
import { enforceUserRateLimit } from "@/lib/api/http";
import { goBackOnboarding } from "@/lib/onboarding/server";
import { getSession } from "@/lib/session";

export async function POST() {
  const session = await getSession();
  if (!session?.user) {
    return jsonError("unauthorized", "Unauthorized", 401);
  }

  const limited = await enforceUserRateLimit(session.user.id, {
    scope: "legacy",
  });
  if (limited) return limited;

  const state = await goBackOnboarding(session.user.id);

  return NextResponse.json({ state });
}
