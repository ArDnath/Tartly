import { encodeSse, type AgentRealtimeEvent } from "@/lib/agent/realtime";

/**
 * Shared SSE plumbing for the realtime routes (Phase B).
 *
 * Responsibilities kept in one place: the response headers, the initial
 * `hello`, abort/cancel cleanup, and a hard **max lifetime**. The lifetime
 * matters for scaling: a serverless stream is otherwise immortal, pinning an
 * instance (and its shared poller) indefinitely. We close after `MAX_STREAM_MS`
 * and emit `reconnect`; the browser's `EventSource` transparently reconnects.
 */

/** Cap a single stream at 5 minutes; the client reconnects automatically. */
export const MAX_STREAM_MS = 5 * 60 * 1000;

/** Cursor default: now, unless the client supplies a positive epoch-ms `since`. */
export function parseSinceParam(request: Request): Date {
  const raw = Number(new URL(request.url).searchParams.get("since"));
  return Number.isFinite(raw) && raw > 0 ? new Date(raw) : new Date();
}

export function sseResponse(options: {
  request: Request;
  /** Register a subscriber; return an unsubscribe function. */
  subscribe: (emit: (event: AgentRealtimeEvent) => void) => () => void;
}): Response {
  const encoder = new TextEncoder();
  let closeStream = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let lifetime: ReturnType<typeof setTimeout> | null = null;
      let unsubscribe = () => {};

      const send = (event: AgentRealtimeEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeSse(event)));
        } catch {
          closed = true;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        if (lifetime) clearTimeout(lifetime);
        unsubscribe();
        options.request.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      closeStream = close;

      send({ type: "hello", at: new Date().toISOString() });
      unsubscribe = options.subscribe(send);
      lifetime = setTimeout(() => {
        send({
          type: "reconnect",
          at: new Date().toISOString(),
          reason: "max_lifetime",
        });
        close();
      }, MAX_STREAM_MS);
      options.request.signal.addEventListener("abort", close);
    },
    cancel() {
      closeStream();
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
}
