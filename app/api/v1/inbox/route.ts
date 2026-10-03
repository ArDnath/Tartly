import type { NextRequest } from "next/server";

import { okPage, withUser } from "@/lib/api/http";
import { parsePageLimit } from "@/lib/api/pagination";
import { listInboxPage, normalizeView } from "@/lib/inbox/service";

export const dynamic = "force-dynamic";

export const GET = withUser(async (userId, request: NextRequest) => {
  const params = request.nextUrl.searchParams;
  // Accepts both the six buckets and the legacy `needs_you` / `handled` aliases.
  const view = normalizeView(params.get("view")) ?? "needs_reply";
  const since = params.get("since");
  const cursor = params.get("cursor");

  const { items, pagination } = await listInboxPage({
    userId,
    view,
    since,
    cursor,
    limit: parsePageLimit(params.get("limit")),
  });
  return okPage({ view, items }, pagination);
});
