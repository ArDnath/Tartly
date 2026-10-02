import { z } from "zod";

import { jsonError } from "@/lib/api/error-envelope";
import { createAssistantStream } from "@/lib/ai/assistant";
import { getSession } from "@/lib/session";

export const maxDuration = 60;

const bodySchema = z.object({
  scope: z.enum(["mail", "calendar"]),
  question: z.string().min(1).max(4_000),
  context: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Route-scoped assistant endpoint for the Mail and Calendar rails. Streams a
 * short, context-aware reply as SSE; the rail executes concrete actions
 * client-side and only calls this for open-ended questions.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user) {
    return jsonError("unauthorized", "Unauthorized", 401);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return jsonError("validation", "Invalid request", 400);
  }

  const stream = createAssistantStream(parsed.data);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
