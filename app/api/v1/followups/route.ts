import type { NextRequest } from "next/server";

import { okPage, withUser } from "@/lib/api/http";
import { parsePageLimit } from "@/lib/api/pagination";
import { listFollowupsPage } from "@/lib/followup/service";

export const GET = withUser(async (userId, request: NextRequest) => {
  const params = request.nextUrl.searchParams;
  const { followups, pagination } = await listFollowupsPage({
    userId,
    cursor: params.get("cursor"),
    limit: parsePageLimit(params.get("limit")),
  });
  return okPage({ followups }, pagination);
});
