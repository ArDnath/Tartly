import { apiError, ok, withUser } from "@/lib/api/http";
import { threadAutonomyBody as bodySchema } from "@/lib/api/contracts/inbox";
import { threadRepository } from "@/lib/repositories/threads";
import {
  getThreadAutonomy,
  resolveAutonomy,
  setThreadAutonomy,
} from "@/lib/settings/autonomy";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ threadId: string }> };

async function ownedThread(userId: string, threadId: string) {
  const thread = await threadRepository.findByIdForUser(userId, threadId);
  return thread ?? null;
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
