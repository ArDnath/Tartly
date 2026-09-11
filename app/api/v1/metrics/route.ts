import { ok, withUser } from "@/lib/api/http";
import { getMetrics } from "@/lib/metrics/service";

export const GET = withUser(async (userId, request) => {
  const sinceDays = Number(request.nextUrl.searchParams.get("sinceDays") ?? 7);
  const metrics = await getMetrics({
    userId,
    sinceDays: Number.isFinite(sinceDays) && sinceDays > 0 ? sinceDays : 7,
  });
  return ok(metrics);
});
