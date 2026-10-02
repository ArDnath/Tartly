import type { NextRequest } from "next/server";

import { ok, withUser } from "@/lib/api/http";
import { listInbox, normalizeView } from "@/lib/inbox/service";

export const dynamic = "force-dynamic";

export const GET = withUser(async (userId, request: NextRequest) => {
  const params = request.nextUrl.searchParams;
  // Accepts both the six buckets and the legacy `needs_you` / `handled` aliases.
  const view = normalizeView(params.get("view")) ?? "needs_reply";
  const since = params.get("since");

  const items = await listInbox({ userId, view, since });
  return ok({ view, items });
});
