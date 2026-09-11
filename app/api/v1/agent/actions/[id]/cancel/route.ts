import { createLoggingEventSink } from "@/lib/agent/events";
import { apiErrorFrom, ok, withUser } from "@/lib/api/http";
import { actionService, toActionDto } from "@/lib/services/action-service";

/**
 * POST /api/v1/agent/actions/[id]/cancel
 *
 * Withdraw a pending action before it runs. Idempotent: cancelling an action
 * that is already cancelled succeeds. Once executed, cancellation is refused.
 */
export const POST = withUser<{ params: Promise<{ id: string }> }>(
  async (userId, _request, context) => {
    const { id } = await context.params;
    try {
      const action = await actionService.cancelAction({ userId, actionId: id });
      createLoggingEventSink("agent/actions")({
        type: "ACTION_CANCELLED",
        actionId: action.id,
        toolName: action.toolName,
      });
      return ok({ action: toActionDto(action) });
    } catch (error) {
      return apiErrorFrom(error);
    }
  },
);
