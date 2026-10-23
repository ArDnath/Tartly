import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/http";
import { freeMailViewLimit } from "@/lib/env";
import { getEntitlement } from "@/lib/billing/entitlements";
import { withMailUser } from "@/lib/mail/route";
import { listUnifiedMessages } from "@/lib/mail/unified";

export const GET = withMailUser(async (userId, request: NextRequest) => {
  const params = request.nextUrl.searchParams;
  const limitParam = Number(params.get("limit"));
  const [entitlement, result] = await Promise.all([
    getEntitlement(userId),
    listUnifiedMessages(userId, {
      ...(params.get("box") ? { box: params.get("box")! } : {}),
      ...(params.get("search") ? { search: params.get("search")! } : {}),
      ...(Number.isFinite(limitParam) && limitParam > 0
        ? { limit: limitParam }
        : {}),
      ...(params.get("pageToken") ? { pageToken: params.get("pageToken")! } : {}),
      ...(params.get("account") ? { account: params.get("account")! } : {}),
    }),
  ]);

  // Free tier never sees more than the allowance at once, and has no next page:
  // the cap is a property of the account, not of this page request.
  if (!entitlement.isSubscriber) {
    const limit = freeMailViewLimit();
    return ok({
      messages: result.messages.slice(0, limit),
      labels: result.labels,
    });
  }

  return ok(result);
});
