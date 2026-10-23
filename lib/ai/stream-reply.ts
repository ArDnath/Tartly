import "server-only";

import { streamText, type ModelMessage } from "ai";

import { appendMessage } from "@/lib/ai/chat-service";
import { getChatModel } from "@/lib/ai/provider";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function tokenizeForStreaming(text: string): string[] {
  return text.split(/(\s+)/).filter((token) => token.length > 0);
}

type CreateAssistantReplyStreamOptions = {
  threadId: string;
  systemPrompt: string;
  modelMessages: ModelMessage[];
  /** Used when no model provider is configured. */
  buildFallbackText: () => string;
  /** Called with the model's token usage once the stream settles. */
  onUsage?: (usage: unknown) => void;
};

/**
 * Builds the SSE response body for one assistant turn.
 *
 * Emits `event: delta` frames as text arrives, then `event: done` with the
 * persisted message id, or `event: error` on failure. The assistant message is
 * persisted before `done` so a refresh restores the full reply.
 *
 * Stopping: when the client aborts the fetch, the response stream's `cancel`
 * runs, which aborts the model stream and persists whatever was streamed so
 * far — so "Stop" never loses the partial answer.
 */
export function createAssistantReplyStream({
  threadId,
  systemPrompt,
  modelMessages,
  buildFallbackText,
  onUsage,
}: CreateAssistantReplyStreamOptions): ReadableStream<Uint8Array> {
  const model = getChatModel();
  const encoder = new TextEncoder();
  const modelAbortController = new AbortController();

  let fullText = "";
  let isCancelled = false;
  let hasPersisted = false;

  const persistAssistantMessage = async () => {
    if (hasPersisted) return;
    hasPersisted = true;
    if (!fullText.trim()) return;
    try {
      await appendMessage({ threadId, role: "assistant", text: fullText });
    } catch (error) {
      console.error("[ai/stream] failed to persist partial reply", error);
    }
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let isClosed = false;

      const send = (event: string, data: unknown) => {
        if (isClosed || isCancelled) return;
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        } catch {
          isClosed = true;
        }
      };

      try {
        if (model) {
          const result = streamText({
            model,
            system: systemPrompt,
            messages: modelMessages,
            abortSignal: modelAbortController.signal,
          });

          for await (const delta of result.textStream) {
            fullText += delta;
            send("delta", { delta });
          }
          // Meter the call once the stream has produced its tokens.
          try {
            onUsage?.(await result.usage);
          } catch {
            // Usage is best-effort; never fail the reply over metering.
          }
        } else {
          for (const token of tokenizeForStreaming(buildFallbackText())) {
            if (isCancelled) break;
            fullText += token;
            send("delta", { delta: token });
            await sleep(14);
          }
        }

        if (!isCancelled) {
          const saved = await appendMessage({
            threadId,
            role: "assistant",
            text: fullText,
          });
          hasPersisted = true;
          send("done", {
            messageId: saved.id,
            createdAt: saved.createdAt,
          });
        } else {
          await persistAssistantMessage();
        }
      } catch (error) {
        if (isCancelled) {
          // Client stopped the turn: keep the partial answer.
          await persistAssistantMessage();
        } else {
          console.error("[ai/stream] failed to stream assistant reply", error);
          send("error", { message: "The assistant failed to respond." });
        }
      } finally {
        isClosed = true;
        try {
          controller.close();
        } catch {
          // already closed by cancellation
        }
      }
    },

    async cancel() {
      isCancelled = true;
      modelAbortController.abort();
      await persistAssistantMessage();
    },
  });
}
