import { withUser } from "@/lib/api/http";
import { encodeSse, type AgentRealtimeEvent } from "@/lib/agent/realtime";
import { actionService, toActionDto } from "@/lib/services/action-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 3_000;
const HEARTBEAT_MS = 20_000;

/**
 * GET /api/v1/agent/events — the realtime stream for the signed-in user.
 *
 * SSE over a small Postgres poll: when a pending action changes
 * (`PENDING → SUCCEEDED`/`FAILED`/`CANCELLED`/`EXPIRED`) the client is told, so
 * a confirmation card reflects the outcome without a manual refresh. It does
 * *not* stream mail or sync state, and it never makes chat wait for anything:
 * losing the stream degrades to the existing on-mount reconciliation.
 *
 * A cursor (`since`) keeps each poll to rows that actually moved. The stream is
 * owner-scoped — `userId` comes from the session, never the query.
 */
export const GET = withUser(async (userId, request) => {
  const sinceParam = Number(new URL(request.url).searchParams.get("since"));
  let since =
    Number.isFinite(sinceParam) && sinceParam > 0
      ? new Date(sinceParam)
      : new Date();

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (event: AgentRealtimeEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeSse(event)));
        } catch {
          closed = true;
        }
      };

      send({ type: "hello", at: new Date().toISOString() });

      const poll = setInterval(() => {
        void (async () => {
          if (closed) return;
          try {
            const changed = await actionService.listUpdatedSince({
              userId,
              since,
              limit: 50,
            });
            for (const action of changed) {
              send({
                type: "action.updated",
                at: new Date().toISOString(),
                action: toActionDto(action),
              });
            }
            const last = changed[changed.length - 1];
            if (last) since = last.updatedAt;
          } catch {
            // A transient DB error must not tear down the stream.
          }
        })();
      }, POLL_INTERVAL_MS);

      const heartbeat = setInterval(() => {
        send({ type: "ping", at: new Date().toISOString() });
      }, HEARTBEAT_MS);

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(poll);
        clearInterval(heartbeat);
        request.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      request.signal.addEventListener("abort", close);
      // Also release the timers if the consumer cancels the stream without the
      // request signal aborting (otherwise polling continues against a dead
      // connection for the life of the process).
      cleanup = close;
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
