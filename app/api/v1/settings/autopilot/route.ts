import type { NextRequest } from "next/server";

import { apiError, ok, withUser } from "@/lib/api/http";
import { autopilotPolicyPatchBody } from "@/lib/api/contracts/settings";
import { isAutopilotEnabled } from "@/lib/env";
import {
  AUTOPILOT_CATEGORIES,
  AUTOPILOT_REASON_LABELS,
  getAutopilotPolicy,
  setAutopilotPolicy,
} from "@/lib/settings/autopilot";

export const dynamic = "force-dynamic";

export const GET = withUser(async (userId) => {
  const policy = await getAutopilotPolicy(userId);
  return ok({
    policy,
    globalEnabled: isAutopilotEnabled(),
    categories: AUTOPILOT_CATEGORIES,
    reasonLabels: AUTOPILOT_REASON_LABELS,
  });
});

export const PATCH = withUser(async (userId, request: NextRequest) => {
  const parsed = autopilotPolicyPatchBody.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return apiError("bad_request", "Invalid autopilot policy.", 400);
  }

  try {
    const policy = await setAutopilotPolicy(userId, parsed.data);
    return ok({ policy });
  } catch {
    // No connected mailbox: nothing to persist against.
    return apiError(
      "conflict",
      "Connect a Gmail mailbox before configuring autopilot.",
      409,
    );
  }
});
