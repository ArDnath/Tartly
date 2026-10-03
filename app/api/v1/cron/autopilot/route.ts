import { NextResponse, type NextRequest } from "next/server";

import { jsonError } from "@/lib/api/error-envelope";
import { isCronAuthorized } from "@/lib/email-operator/cron-auth";
import { runAutopilotReview } from "@/lib/settings/autopilot-review";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Autopilot review finalizer. On Hobby this is called from the daily cron; on
 * Pro it can be scheduled independently. Idempotent.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return jsonError("unauthorized", "Invalid cron secret.", 401);
  }
  const summary = await runAutopilotReview();
  return NextResponse.json({ data: summary });
}
