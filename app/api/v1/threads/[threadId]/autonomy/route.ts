import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { threads } from "@/lib/db/schema";
import { apiError, ok, withUser } from "@/lib/api/http";
import {
  getThreadAutonomy,
  resolveAutonomy,
  setThreadAutonomy,
} from "@/lib/settings/autonomy";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  autonomy: z.enum(["copilot", "autopilot"]).nullable(),
});

type Ctx = { params: Promise<{ threadId: string }> };

async function ownedThread(userId: string, threadId: string) {
  const rows = await db
    .select({ id: threads.id, mailboxId: threads.mailboxId })
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

/** GET the raw override plus the effective mode and where it comes from. */
export const GET = withUser<Ctx>(async (userId, _request, context) => {
  const { threadId } = await context.params;
  const owned = await ownedThread(userId, threadId);
  if (!owned) return apiError("not_found", "Thread not found", 404);

  const [override, resolved] = await Promise.all([
    getThreadAutonomy(userId, threadId),
    resolveAutonomy({ userId, threadId, mailboxId: owned.mailboxId }),
  ]);

  return ok({
    autonomy: override,
    effective: resolved.autonomy,
    source: resolved.source,
  });
});

/** PATCH the per-thread override (`null` clears it back to inherit). */
export const PATCH = withUser<Ctx>(async (userId, request, context) => {
  const { threadId } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

  const updated = await setThreadAutonomy(userId, threadId, parsed.data.autonomy);
  if (!updated) return apiError("not_found", "Thread not found", 404);

  const resolved = await resolveAutonomy({ userId, threadId });
  return ok({
    autonomy: parsed.data.autonomy,
    effective: resolved.autonomy,
    source: resolved.source,
  });
});
