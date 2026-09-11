import { apiErrorFrom, ok, withUser } from "@/lib/api/http";
import { actionService, toActionDto } from "@/lib/services/action-service";

/**
 * GET /api/v1/agent/actions/[id]
 *
 * The current state of one confirmation card, so a reloaded transcript can
 * render the action as pending, succeeded, cancelled or expired instead of
 * always looking actionable.
 */
export const GET = withUser<{ params: Promise<{ id: string }> }>(
  async (userId, _request, context) => {
    const { id } = await context.params;
    try {
      const action = await actionService.getAction({ userId, actionId: id });
      return ok({ action: toActionDto(action) });
    } catch (error) {
      return apiErrorFrom(error);
    }
  },
);
