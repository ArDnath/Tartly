import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

/**
 * `/api/health/metrics` is hidden unless `METRICS_TOKEN` is configured, and
 * bearer-protected when it is. The token must be set before `lib/env.ts` is
 * first evaluated, so the route is imported dynamically.
 */
process.env.METRICS_TOKEN = "metrics-token-for-tests-1234";

const { GET } = await import("@/app/api/health/metrics/route");

function request(authorization?: string): NextRequest {
  return new NextRequest("http://localhost/api/health/metrics", {
    headers: authorization ? { authorization } : {},
  });
}

describe("GET /api/health/metrics", () => {
  it("rejects a missing or wrong bearer token", async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("Bearer nope"))).status).toBe(401);
  });

  it("returns Prometheus text with the token", async () => {
    const response = await GET(request("Bearer metrics-token-for-tests-1234"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    const body = await response.text();
    expect(body).toContain("process_uptime_seconds");
  });
});
