import { z } from "zod";

import { apiError } from "@/lib/api/http";
import {
  COMPOSE_ASSIST_ACTIONS,
  composeAssistStream,
} from "@/lib/ai/features/compose-assist";
import { isComposeAssistEnabled } from "@/lib/env";
import { withMailUser } from "@/lib/mail/route";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  action: z.enum(COMPOSE_ASSIST_ACTIONS),
  body: z.string().max(20_000),
  selection: z.string().max(8_000).optional(),
  subject: z.string().max(500).optional(),
  to: z.array(z.string().max(320)).max(20).optional(),
  targetLanguage: z.string().max(40).optional(),
  instruction: z.string().max(2_000).optional(),
});

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
