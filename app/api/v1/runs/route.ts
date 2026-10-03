import type { NextRequest } from "next/server";

import { okPage, withUser } from "@/lib/api/http";
import {
  buildPage,
  decodeCursor,
  parsePageLimit,
  type CursorValues,
} from "@/lib/api/pagination";
import { flowRunRepository } from "@/lib/repositories/flow-runs";

/**
 * GET /api/v1/runs?cursor=...&limit=...
 *
 * The signed-in user's flow runs, newest first, cursor-paginated (Phase C5).
 * The `/runs` page reads the same repository directly for its server render;
 * this endpoint is the pageable contract for the client.
 */

const RUNS_CURSOR_SCOPE = "runs";

function decodeRunsCursor(
  cursor: string | null | undefined,
): { startedAt: Date; id: string } | undefined {
  const values = decodeCursor(cursor, RUNS_CURSOR_SCOPE, ["c", "id"]);
  if (!values) return undefined;
  const { c, id } = values;
  if (typeof id !== "string" || id.length === 0) return undefined;
  if (typeof c !== "string") return undefined;
  const startedAt = new Date(c);
  if (Number.isNaN(startedAt.getTime())) return undefined;
  return { startedAt, id };
}

export const GET = withUser(async (userId, request: NextRequest) => {
  const params = request.nextUrl.searchParams;
  const limit = parsePageLimit(params.get("limit"));
  const after = decodeRunsCursor(params.get("cursor"));

  const rows = await flowRunRepository.listForUser({
    userId,
    ...(after ? { after } : {}),
    limit: limit + 1,
  });
  const { page, pagination } = buildPage({
    rows,
    limit,
    scope: RUNS_CURSOR_SCOPE,
    cursorOf: (run): CursorValues => ({
      c: run.startedAt.toISOString(),
      id: run.id,
    }),
  });

  return okPage(
    {
      runs: page.map((run) => ({
        id: run.id,
        status: run.status,
        triggerKind: run.triggerKind,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
      })),
    },
    pagination,
  );
});
