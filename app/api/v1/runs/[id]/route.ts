import { and, eq } from "drizzle-orm";

import { ok, apiError, withUser } from "@/lib/api/http";
import { db } from "@/lib/db";
import { flowRuns } from "@/lib/db/schema";

export const GET = withUser<{ params: Promise<{ id: string }> }>(
  async (userId, _request, context) => {
    const { id } = await context.params;
    const rows = await db
      .select()
      .from(flowRuns)
      .where(and(eq(flowRuns.id, id), eq(flowRuns.userId, userId)))
      .limit(1);

    if (!rows[0]) return apiError("not_found", "Run not found", 404);

    return ok({
      id: rows[0].id,
      status: rows[0].status,
      triggerKind: rows[0].triggerKind,
      state: rows[0].state,
      trace: rows[0].trace,
      error: rows[0].error,
      startedAt: rows[0].startedAt.toISOString(),
      finishedAt: rows[0].finishedAt ? rows[0].finishedAt.toISOString() : null,
    });
  },
);
