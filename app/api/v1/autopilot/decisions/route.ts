import type { NextRequest } from "next/server";

import { okPage, withUser } from "@/lib/api/http";
import { parsePageLimit } from "@/lib/api/pagination";
import { autopilotReasonLabel } from "@/lib/settings/autopilot";
import { listAutopilotDecisions } from "@/lib/settings/autopilot-usage";
import { autopilotRepository } from "@/lib/repositories/autopilot";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 100;

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Content-free audit feed. Rows never include message content; the UI joins to
 * `threads` (subject) by `threadId`, scoped to this user.
 *
 * When `threadId` is supplied, returns just the latest decision for that
 * thread (the "Why?" popover).
 */
export const GET = withUser(async (userId, request: NextRequest) => {
  const params = request.nextUrl.searchParams;

  const threadId = params.get("threadId");
  if (threadId) {
    const latest = await autopilotRepository.findLatestDecisionForThread(
      userId,
      threadId,
    );
    return okPage(
      {
        items: latest
          ? [
              {
                ...latest,
                reasonLabel: autopilotReasonLabel(latest.reason),
              },
            ]
          : [],
      },
      { limit: 1, has_more: false, next_cursor: null },
    );
  }

  const limit = Math.min(parsePageLimit(params.get("limit")), MAX_LIMIT);
  const since = parseDate(params.get("since"));
  const before = parseDate(params.get("cursor"));

  const rows = await listAutopilotDecisions({
    userId,
    since,
    before,
    limit: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore
    ? (page[page.length - 1]?.createdAt.toISOString() ?? null)
    : null;

  return okPage(
    {
      items: page.map((row) => ({
        ...row,
        reasonLabel: autopilotReasonLabel(row.reason),
      })),
    },
    { limit, has_more: hasMore, next_cursor: nextCursor },
  );
});
