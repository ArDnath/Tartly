import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness probe: the process is up and able to serve. Deliberately touches no
 * backing service — a Redis blip must not cause an orchestrator to kill a
 * healthy server. Readiness is `/api/health/ready`.
 */
export async function GET() {
  return NextResponse.json(
    { status: "ok", checks: {} },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
