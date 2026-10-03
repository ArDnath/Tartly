import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { renderPrometheus } from "@/lib/observability/metrics";
import { constantTimeEqual } from "@/lib/security/constant-time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Prometheus scrape endpoint (Phase D5).
 *
 * Exposes the in-process RED/USE registry. Protected by a bearer token and
 * hidden entirely when `METRICS_TOKEN` is unset, so the route never leaks route
 * inventory on a deployment that did not opt in.
 */
function isAuthorized(request: NextRequest): boolean {
  const expected = env.METRICS_TOKEN;
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const presented = header.slice("Bearer ".length).trim();
  return presented.length > 0 && constantTimeEqual(presented, expected);
}

export async function GET(request: NextRequest) {
  if (!env.METRICS_TOKEN) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (!isAuthorized(request)) {
    return new NextResponse("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  return new NextResponse(renderPrometheus(), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
