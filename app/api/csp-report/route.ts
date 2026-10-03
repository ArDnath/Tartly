import { NextResponse } from "next/server";

import { logger } from "@/lib/observability/logger";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseCspReports } from "@/lib/security/csp-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CSP violation collector (Phase C6).
 *
 * The proxy ships the policy as `Content-Security-Policy-Report-Only` with
 * `report-uri /api/csp-report`, so every blocked resource is reported here while
 * enforcement is off. This endpoint is intentionally public and unauthenticated:
 * browsers send the report with no credentials and no CORS preflight. It is
 * hardened the way any anonymous sink must be —
 *  - a small body cap before parsing (reports are a few hundred bytes),
 *  - a per-IP rate limit (fail-open, like every other limiter),
 *  - normalization to paths/origins/enums before logging, so a crafted report
 *    cannot inject secrets or arbitrary text into the logs.
 */

const MAX_BODY_BYTES = 16 * 1024;
const REPORTS_PER_MIN = 120;

function clientSubject(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "unknown";
}

export async function POST(request: Request) {
  const limit = await checkRateLimit({
    subject: clientSubject(request),
    limit: REPORTS_PER_MIN,
    scope: "csp-report",
  });
  if (!limit.allowed) {
    return new NextResponse(null, {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfterSeconds) },
    });
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  let payload: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 413 });
    }
    payload = JSON.parse(text);
  } catch {
    // A malformed report is not actionable; accept and drop it.
    return new NextResponse(null, { status: 204 });
  }

  for (const violation of parseCspReports(payload)) {
    logger.warn("csp.violation", violation);
  }

  return new NextResponse(null, { status: 204 });
}
