import type { ModelMessage } from "ai";

import { jsonError } from "@/lib/api/error-envelope";
import { aiChatBody as bodySchema } from "@/lib/api/contracts/legacy";
import { enforceUserRateLimit } from "@/lib/api/http";
import { appendMessage, loadThreadMessages } from "@/lib/ai/chat-service";
import { buildFallbackSetupResponse } from "@/lib/ai/fallback-response";
import { WORKSPACE_SETUP_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { createAssistantReplyStream } from "@/lib/ai/stream-reply";
import { agentRateLimitPerMin } from "@/lib/env";
import { userOwnsThread } from "@/lib/onboarding/server";
import { getSession } from "@/lib/session";

export const maxDuration = 60;

/**
 * SSE chat endpoint.
 *
 * Streams `event: delta` frames as the model produces text, then a final
 * `event: done` frame carrying the persisted assistant message id. Errors are
 * surfaced as `event: error` so the client can render them inline.
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

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return jsonError("validation", "Invalid request", 400);
  }

  const { threadId, message } = parsed.data;

  if (!(await userOwnsThread(session.user.id, threadId))) {
    return jsonError("not_found", "Thread not found", 404);
  }

  if (message?.trim()) {
    await appendMessage({ threadId, role: "user", text: message.trim() });
  }

  const history = await loadThreadMessages(threadId);

  // A trailing assistant message means there is nothing to answer.
  const lastMessage = history[history.length - 1];
  if (!lastMessage || lastMessage.role === "assistant") {
    return jsonError("conflict", "Nothing to respond to", 409);
  }

  const modelMessages: ModelMessage[] = history.map((entry) => ({
    role: entry.role === "system" ? "user" : entry.role,
    content: entry.text,
  }));

  const stream = createAssistantReplyStream({
    threadId,
    systemPrompt: WORKSPACE_SETUP_SYSTEM_PROMPT,
    modelMessages,
    buildFallbackText: () =>
      buildFallbackSetupResponse({
        userName: session.user.name ?? null,
        workspaceName: "Tartly",
      }),
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
