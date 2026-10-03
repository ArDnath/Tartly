import type { NextRequest } from "next/server";

import { ok, withUser } from "@/lib/api/http";
import { autopilotPauseBody } from "@/lib/api/contracts/settings";
import { pauseAutopilot } from "@/lib/settings/autopilot";

export const dynamic = "force-dynamic";

/**
 * Kill switch. Idempotent: pausing an already-paused policy is a no-op. Never
 * can this route *enable* sending.
 */
export const POST = withUser(async (userId, request: NextRequest) => {
  const parsed = autopilotPauseBody.safeParse(
    await request.json().catch(() => ({})),
  );
  const alsoSetCopilot = parsed.success
    ? parsed.data.alsoSetCopilot === true
    : false;

  const policy = await pauseAutopilot(userId, { alsoSetCopilot });
  return ok({ policy, paused: true });
});
