import { NextResponse, type NextRequest } from "next/server";

import { jsonError } from "@/lib/api/error-envelope";
import { isCronAuthorized } from "@/lib/email-operator/cron-auth";
import { runDailyMaintenance } from "@/lib/email-operator/cron";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Hobby cron entry (`0 3 * * *`). One schedule fans out every safety-net task
 * so the app stays within Hobby's cron limits. Pro adds `/cron/drain` and
 * `/cron/followups`; this route remains the daily net.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return jsonError("unauthorized", "Invalid cron secret.", 401);
  }

  const summary = await runDailyMaintenance();
  return NextResponse.json({ data: summary });
}
