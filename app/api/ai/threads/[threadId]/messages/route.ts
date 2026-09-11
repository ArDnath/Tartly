import type { ModelMessage } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  appendMessage,
  ensureChatThreadTitle,
  findThreadForUser,
  loadThreadMessages,
} from "@/lib/ai/chat-service";
import { buildFallbackChatResponse } from "@/lib/ai/fallback-response";
import { GENERAL_CHAT_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { createAssistantReplyStream } from "@/lib/ai/stream-reply";
import { getSession } from "@/lib/session";

export const maxDuration = 60;

type RouteContext = { params: Promise<{ threadId: string }> };

const sendSchema = z.object({
  message: z.string().min(1).max(8_000),
});

/** Visible (non-hidden) conversation history for a thread. */
export async function GET(_request: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { threadId } = await params;
  const thread = await findThreadForUser(session.user.id, threadId);

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const messages = (await loadThreadMessages(threadId)).filter(
    (message) => !message.hidden,
  );

  return NextResponse.json({ thread, messages });
}

/**
 * Appends the user's message and streams the assistant reply as SSE.
 * Stopping is done by aborting the request on the client; the server then
 * persists the partial reply.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { threadId } = await params;

  const thread = await findThreadForUser(session.user.id, threadId);
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const parsed = sendSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const userText = parsed.data.message.trim();

  await appendMessage({ threadId, role: "user", text: userText });
  await ensureChatThreadTitle(session.user.id, threadId, userText);

  const history = await loadThreadMessages(threadId);
  const modelMessages: ModelMessage[] = history.map((entry) => ({
    role: entry.role === "system" ? "user" : entry.role,
    content: entry.text,
  }));

  const stream = createAssistantReplyStream({
    threadId,
    systemPrompt: GENERAL_CHAT_SYSTEM_PROMPT,
    modelMessages,
    buildFallbackText: () =>
      buildFallbackChatResponse({
        userName: session.user.name ?? null,
        userMessage: userText,
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
