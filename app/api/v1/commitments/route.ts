import { ok, withUser } from "@/lib/api/http";
import { listOpenCommitments } from "@/lib/commitments/service";

export const dynamic = "force-dynamic";

/** GET /api/v1/commitments — the user's open promises, both directions. */
export const GET = withUser(async (userId) => {
  const rows = await listOpenCommitments({ userId, limit: 100 });
  return ok({
    commitments: rows.map((row) => ({
      id: row.id,
      threadId: row.threadId,
      direction: row.direction,
      description: row.description,
      dueAt: row.dueAt ? row.dueAt.toISOString() : null,
      overdue: row.dueAt ? row.dueAt.getTime() < Date.now() : false,
      nudges: row.nudgeCount,
    })),
  });
});
