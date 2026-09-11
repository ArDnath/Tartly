import type { NextRequest } from "next/server";

import { ok, withUser } from "@/lib/api/http";
import { listInbox, type InboxView } from "@/lib/inbox/service";

const VIEWS: InboxView[] = ["needs_you", "waiting", "handled"];

export const GET = withUser(async (userId, request: NextRequest) => {
  const params = request.nextUrl.searchParams;
  const viewParam = params.get("view") as InboxView | null;
  const view = viewParam && VIEWS.includes(viewParam) ? viewParam : "needs_you";
  const since = params.get("since");

  const items = await listInbox({ userId, view, since });
  return ok({ view, items });
});
