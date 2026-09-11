import { NextResponse } from "next/server";

import { getOrCreateOnboardingState } from "@/lib/onboarding/server";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snapshot = await getOrCreateOnboardingState(session.user.id);

  return NextResponse.json({ state: snapshot });
}
