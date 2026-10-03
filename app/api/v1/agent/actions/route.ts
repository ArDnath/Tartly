import {
  apiError,
  apiErrorFrom,
  okPage,
  withUser,
} from "@/lib/api/http";
import { parsePageLimit } from "@/lib/api/pagination";
import {
  actionService,
  isPendingActionStatus,
  MAX_ACTION_LIST,
  toActionDto,
} from "@/lib/services/action-service";

/**
 * GET /api/v1/agent/actions?status=PENDING&cursor=...&limit=...
 *
 * The caller's pending-action inbox. Owner-scoped: `userId` comes from the
 * session, never the query. The client uses this to reconcile confirmation
 * cards after a reload. Cursor-paginated newest-first (Phase C5).
 */
export const GET = withUser(async (userId, request) => {
  const params = new URL(request.url).searchParams;
  const statusParam = params.get("status");
  const status =
    statusParam && isPendingActionStatus(statusParam) ? statusParam : undefined;
  if (statusParam && !status) {
    return apiError("validation", "Unknown action status.", 400);
  }

  try {
    const { actions, pagination } = await actionService.listActionsPage({
      userId,
      ...(status ? { status } : {}),
      cursor: params.get("cursor"),
      limit: parsePageLimit(params.get("limit"), {
        fallback: MAX_ACTION_LIST,
        max: MAX_ACTION_LIST,
      }),
    });
    return okPage({ actions: actions.map(toActionDto) }, pagination);
  } catch (error) {
    return apiErrorFrom(error);
  }
});
