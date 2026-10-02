import { withUser } from "@/lib/api/http";
import { toActionDto } from "@/lib/services/action-service";
import { agentEventPoller } from "@/lib/realtime/hubs";
import { parseSinceParam, sseResponse } from "@/lib/realtime/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/agent/events — the realtime stream for the signed-in user.
 *
 * When a pending action changes (`PENDING → SUCCEEDED`/`FAILED`/`CANCELLED`/
 * `EXPIRED`) the client is told, so a confirmation card reflects the outcome
 * without a manual refresh. It does *not* stream mail or sync state, and it
 * never makes chat wait for anything: losing the stream degrades to the
 * existing on-mount reconciliation.
 *
 * Scaling: subscribers share one batched poller per instance
 * (`lib/realtime/poller.ts`), so N open tabs do not produce N DB queries per
 * interval. Each connection is capped at `MAX_STREAM_MS` and the browser
 * reconnects. The stream is owner-scoped — `userId` comes from the session,
 * never the query.
 */
export const GET = withUser(async (userId, request) => {
  const since = parseSinceParam(request);

  return sseResponse({
    request,
    subscribe: (emit) =>
      agentEventPoller.subscribe({
        userId,
        since,
        deliver: (actions) => {
          for (const action of actions) {
            emit({
              type: "action.updated",
              at: new Date().toISOString(),
              action: toActionDto(action),
            });
          }
        },
        heartbeat: () => emit({ type: "ping", at: new Date().toISOString() }),
      }),
  });
});
