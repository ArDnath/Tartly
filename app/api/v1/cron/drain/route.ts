import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized } from "@/lib/email-operator/cron-auth";
import { drainQueue } from "@/lib/email-operator/drain";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Bounded queue drain. On Hobby this is invoked by `/cron/daily`; on Pro it is
 * also scheduled every minute (`vercel.json`). The route exists either way, so
 * upgrading is a config-only change.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Invalid cron secret." } },
      { status: 401 },
    );
  }

  const result = await drainQueue({ workerId: `cron:${Date.now().toString(36)}` });
  return NextResponse.json({ data: result });
}
