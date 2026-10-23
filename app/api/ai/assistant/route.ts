import { jsonError } from "@/lib/api/error-envelope";
import { aiAssistantBody as bodySchema } from "@/lib/api/contracts/legacy";
import { enforceUserRateLimit } from "@/lib/api/http";
import { requireAiAccess } from "@/lib/billing/guard";
import { createAssistantStream } from "@/lib/ai/assistant";
import { extractUsage } from "@/lib/ai/generate";
import { recordAiUsage } from "@/lib/ai/usage";
import { agentRateLimitPerMin } from "@/lib/env";
import { getSession } from "@/lib/session";

export const maxDuration = 60;

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

  const limited = await enforceUserRateLimit(session.user.id, {
    limit: agentRateLimitPerMin(),
    scope: "ai",
  });
  if (limited) return limited;

  const paywall = await requireAiAccess(session.user.id);
  if (paywall) return paywall;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return jsonError("validation", "Invalid request", 400);
  }

  const stream = createAssistantStream({
    ...parsed.data,
    onUsage: (usage) => {
      void recordAiUsage({
        userId: session.user.id,
        feature: "ai-assistant",
        provider: "opencode",
        model: process.env.AI_MODEL_ID ?? "unknown",
        role: "fast",
        ...extractUsage(usage),
        ok: true,
      });
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
