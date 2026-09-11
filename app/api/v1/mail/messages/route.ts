import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/http";
import { withMailUser } from "@/lib/mail/route";
import { listMessages } from "@/lib/mail/service";

export const GET = withMailUser(async (userId, request: NextRequest) => {
  const params = request.nextUrl.searchParams;
  const limitParam = Number(params.get("limit"));
  const result = await listMessages(userId, {
    ...(params.get("box") ? { box: params.get("box")! } : {}),
    ...(params.get("search") ? { search: params.get("search")! } : {}),
    ...(Number.isFinite(limitParam) && limitParam > 0
      ? { limit: limitParam }
      : {}),
    ...(params.get("pageToken") ? { pageToken: params.get("pageToken")! } : {}),
  });
  return ok(result);
});
