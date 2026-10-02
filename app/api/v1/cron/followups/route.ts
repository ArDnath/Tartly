import { NextResponse, type NextRequest } from "next/server";

import { jsonError } from "@/lib/api/error-envelope";
import { isCronAuthorized } from "@/lib/email-operator/cron-auth";
import { enqueueDueFollowups } from "@/lib/followup/service";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Enqueues due follow-up enrollments. Invoked by `/cron/daily` on Hobby and
 * scheduled every 5 minutes on Pro (`vercel.json`), config-only to upgrade.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return jsonError("unauthorized", "Invalid cron secret.", 401);
  }

  const enqueued = await enqueueDueFollowups();
  return NextResponse.json({ data: { enqueued } });
}
