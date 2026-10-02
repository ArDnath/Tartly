import { withUser } from "@/lib/api/http";
import { mailEventPoller } from "@/lib/realtime/hubs";
import { parseSinceParam, sseResponse } from "@/lib/realtime/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/mail/events — new-mail notifications for the signed-in user.
 *
 * The mail client reads live Gmail; this stream tells it when the background
 * mirror has seen new mail so it can refresh without a manual reload. It is a
 * best-effort signal, not a data source: a dropped stream (or an unsynced
 * mailbox) simply means the client falls back to its normal load path.
 *
 * Scaling: subscribers share one batched poller per instance, so N open tabs do
 * not produce N DB queries per interval; each connection is capped and the
 * browser reconnects.
 */
export const GET = withUser(async (userId, request) => {
  const since = parseSinceParam(request);

  return sseResponse({
    request,
    subscribe: (emit) =>
      mailEventPoller.subscribe({
        userId,
        since,
        deliver: (activity) => {
          for (const thread of activity) {
            emit({
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
        },
        heartbeat: () => emit({ type: "ping", at: new Date().toISOString() }),
      }),
  });
});
