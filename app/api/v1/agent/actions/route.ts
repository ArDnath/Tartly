import {
  apiError,
  apiErrorFrom,
  ok,
  withUser,
} from "@/lib/api/http";
import {
  actionService,
  isPendingActionStatus,
  MAX_ACTION_LIST,
  toActionDto,
} from "@/lib/services/action-service";

/**
 * GET /api/v1/agent/actions?status=PENDING
 *
 * The caller's pending-action inbox. Owner-scoped: `userId` comes from the
 * session, never the query. The client uses this to reconcile confirmation
 * cards after a reload.
 */
export const GET = withUser(async (userId, request) => {
  const statusParam = new URL(request.url).searchParams.get("status");
  const status =
    statusParam && isPendingActionStatus(statusParam) ? statusParam : undefined;
  if (statusParam && !status) {
    return apiError("validation", "Unknown action status.", 400);
  }

  try {
    const actions = await actionService.listActions({
      userId,
      ...(status ? { status } : {}),
      limit: MAX_ACTION_LIST,
    });
    return ok({ actions: actions.map(toActionDto) });
  } catch (error) {
    return apiErrorFrom(error);
  }
});
