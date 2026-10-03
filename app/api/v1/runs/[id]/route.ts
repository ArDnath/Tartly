import { ok, apiError, withUser } from "@/lib/api/http";
import { flowRunRepository } from "@/lib/repositories/flow-runs";

export const GET = withUser<{ params: Promise<{ id: string }> }>(
  async (userId, _request, context) => {
    const { id } = await context.params;
    const run = await flowRunRepository.findByIdForUser(userId, id);

    if (!run) return apiError("not_found", "Run not found", 404);

    return ok({
      id: run.id,
      status: run.status,
      triggerKind: run.triggerKind,
      state: run.state,
      trace: run.trace,
      error: run.error,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    });
  },
);
