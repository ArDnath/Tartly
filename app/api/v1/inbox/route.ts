import type { NextRequest } from "next/server";

import { okPage, withUser } from "@/lib/api/http";
import { parsePageLimit } from "@/lib/api/pagination";
import { getEntitlement } from "@/lib/billing/entitlements";
import { freeMailViewLimit } from "@/lib/env";
import { listInboxPage, normalizeView } from "@/lib/inbox/service";

export const dynamic = "force-dynamic";

export const GET = withUser(async (userId, request: NextRequest) => {
  const params = request.nextUrl.searchParams;
  // Accepts both the six buckets and the legacy `needs_you` / `handled` aliases.
  const view = normalizeView(params.get("view")) ?? "needs_reply";
  const since = params.get("since");
  const cursor = params.get("cursor");

  // The triage surface is still the mailbox: a free account sees at most the
  // same five rows it can see in the mail client, with no next page.
  const entitlement = await getEntitlement(userId);
  const requested = parsePageLimit(params.get("limit"));
  const limit = entitlement.isSubscriber
    ? requested
    : Math.min(requested, freeMailViewLimit());

  const { items, pagination } = await listInboxPage({
    userId,
    view,
    since,
    cursor,
    limit,
  });

  if (!entitlement.isSubscriber) {
    return okPage(
      { view, items },
      { ...pagination, has_more: false, next_cursor: null },
    );
  }
  return okPage({ view, items }, pagination);
});
