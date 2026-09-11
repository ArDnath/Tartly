import { NextResponse } from "next/server";

import { goBackOnboarding } from "@/lib/onboarding/server";
import { getSession } from "@/lib/session";

export async function POST() {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const state = await goBackOnboarding(session.user.id);

  return NextResponse.json({ state });
}
