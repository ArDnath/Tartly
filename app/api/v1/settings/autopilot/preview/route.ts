import type { NextRequest } from "next/server";

import { ok, withUser } from "@/lib/api/http";
import { autopilotPreviewBody } from "@/lib/api/contracts/settings";
import { previewAutopilot } from "@/lib/settings/autopilot-preview";

export const dynamic = "force-dynamic";

/**
 * Dry run: evaluate the gate over recent threads. No writes, no sends, no model
 * calls, and no URL input (T-10).
 */
export const POST = withUser(async (userId, request: NextRequest) => {
  const parsed = autopilotPreviewBody.safeParse(
    await request.json().catch(() => ({})),
  );
  const limit = parsed.success ? (parsed.data.limit ?? 10) : 10;

  const preview = await previewAutopilot(userId, limit);
  return ok(preview);
});
