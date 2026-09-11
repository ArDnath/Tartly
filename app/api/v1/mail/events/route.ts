import { withUser } from "@/lib/api/http";
import { encodeSse, type AgentRealtimeEvent } from "@/lib/agent/realtime";
import { listThreadActivitySince } from "@/lib/email-operator/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 3_000;
const HEARTBEAT_MS = 20_000;

/**
 * GET /api/v1/mail/events — new-mail notifications for the signed-in user.
 *
 * The mail client reads live Gmail; this stream tells it when the background
 * mirror has seen new mail so it can refresh without a manual reload. It is a
 * best-effort signal, not a data source: a dropped stream (or an unsynced
 * mailbox) simply means the client falls back to its normal load path.
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
            const activity = await listThreadActivitySince({ userId, since });
            for (const thread of activity) {
              send({
                type: "mail.updated",
                at: new Date().toISOString(),
                thread: {
                  id: thread.id,
                  gmailThreadId: thread.gmailThreadId,
                  subject: thread.subject,
                  lastMessageAt: thread.lastMessageAt?.toISOString() ?? null,
                  isUnread: thread.isUnread,
                },
              });
            }
            const last = activity[activity.length - 1];
            if (last?.lastMessageAt) since = last.lastMessageAt;
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
      // Release timers if the consumer cancels without a request abort.
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
