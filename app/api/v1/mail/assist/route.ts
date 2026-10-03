import { apiError } from "@/lib/api/http";
import { mailAssistBody as schema } from "@/lib/api/contracts/mail";
import { composeAssistStream } from "@/lib/ai/features/compose-assist";
import { isComposeAssistEnabled } from "@/lib/env";
import { withMailUser } from "@/lib/mail/route";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Smart compose (Phase 4). Streams a suggestion as `text/plain`; the composer
 * inserts it for review. This route never sends and never writes to Gmail — it
 * only produces text.
 */
export const POST = withMailUser(async (userId, request) => {
  if (!isComposeAssistEnabled()) {
    return apiError("disabled", "Smart compose is disabled.", 403);
  }

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

  const stream = await composeAssistStream({ userId, input: parsed.data });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
});
