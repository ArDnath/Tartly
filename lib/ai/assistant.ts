import "server-only";

import { streamText } from "ai";

import { getChatModel } from "@/lib/ai/provider";
import type {
  AssistantContext,
  AssistantScope,
} from "@/lib/assistant/types";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function tokenizeForStreaming(text: string): string[] {
  return text.split(/(\s+)/).filter((token) => token.length > 0);
}

const MAIL_SYSTEM_PROMPT = `You are Redape's Mail assistant, embedded in the Mail screen of a single-tenant productivity workspace.

You help the person understand and triage their Gmail. Actions such as archive, snooze, star, mark read/unread, trash, spam, label, search and open are executed by the app's command layer, not by you — when the user asks for one of those, confirm in one short sentence what will happen.

Use the live mailbox snapshot below to answer questions. Never invent messages, senders or counts that are not in the snapshot.
Be concise. Use Markdown. Prefer short paragraphs and tight bullets. Keep replies under ~120 words.`;

const CALENDAR_SYSTEM_PROMPT = `You are Redape's Calendar assistant, embedded in the Calendar screen of a single-tenant productivity workspace.

You help the person understand the meetings their assistant has booked: what is coming up, when the next one is, and which conversations they came from. Opening a meeting's thread is handled by the app's command layer.

Use the live agenda snapshot below to answer. Never invent meetings that are not in the snapshot.
Be concise. Use Markdown. Prefer short paragraphs and tight bullets. Keep replies under ~120 words.`;

function buildSystemPrompt(scope: AssistantScope): string {
  return scope === "mail" ? MAIL_SYSTEM_PROMPT : CALENDAR_SYSTEM_PROMPT;
}

function buildContextBlock(context: AssistantContext | undefined): string {
  if (!context) return "No live snapshot is available.";
  try {
    return `Live snapshot (JSON):\n${JSON.stringify(context, null, 2)}`;
  } catch {
    return "No live snapshot is available.";
  }
}

function buildFallbackText(
  scope: AssistantScope,
  context: AssistantContext | undefined,
): string {
  if (scope === "calendar") return buildCalendarFallback(context);
  return buildMailFallback(context);
}

function buildMailFallback(context: AssistantContext | undefined): string {
  const counts = (context?.counts ?? {}) as {
    inView?: number;
    unread?: number;
    starred?: number;
  };
  const recent = (context?.recent ?? []) as Array<{
    from?: string;
    subject?: string;
    unread?: boolean;
  }>;

  if (!recent.length) {
    return "Your mailbox looks empty in this view. Try another folder, or ask me to search for something.";
  }

  const lines = [
    `You have **${counts.unread ?? 0} unread** and **${counts.inView ?? recent.length}** conversations in view.`,
    "",
    "Latest:",
    ...recent.slice(0, 5).map(
      (message) =>
        `- ${message.unread ? "**" : ""}${message.from ?? "Unknown"}${message.unread ? "**" : ""} — ${message.subject || "(no subject)"}`,
    ),
    "",
    "Ask me to archive, snooze, star, mark read, label, search, or open a conversation.",
  ];
  return lines.join("\n");
}

function buildCalendarFallback(context: AssistantContext | undefined): string {
  const upcoming = (context?.upcoming ?? []) as Array<{
    subject?: string;
    startAt?: string;
    status?: string;
  }>;

  if (!upcoming.length) {
    return "Nothing is on the books yet. When your assistant confirms a meeting with someone, it will show up here.";
  }

  const lines = [
    `You have **${upcoming.length}** upcoming meeting${upcoming.length === 1 ? "" : "s"}:`,
    "",
    ...upcoming.slice(0, 6).map(
      (meeting) =>
        `- **${meeting.subject || "Meeting"}** — ${meeting.startAt ? new Date(meeting.startAt).toUTCString() : "no time"}${meeting.status ? ` (${meeting.status})` : ""}`,
    ),
    "",
    "Ask me for your next meeting, or to open the thread it came from.",
  ];
  return lines.join("\n");
}

/**
 * Streams a route-scoped assistant reply as SSE (`event: delta` frames, then
 * `event: done`). Nothing is persisted — the rail keeps the conversation in
 * memory. Falls back to a deterministic, context-aware reply when no model
 * provider is configured.
 */
export function createAssistantStream({
  scope,
  question,
  context,
}: {
  scope: AssistantScope;
  question: string;
  context?: AssistantContext;
}): ReadableStream<Uint8Array> {
  const model = getChatModel();
  const encoder = new TextEncoder();
  const abortController = new AbortController();
  let isCancelled = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let isClosed = false;
      const send = (event: string, data: unknown) => {
        if (isClosed || isCancelled) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          isClosed = true;
        }
      };

      try {
        if (model) {
          const result = streamText({
            model,
            system: buildSystemPrompt(scope),
            messages: [
              {
                role: "user",
                content: `${buildContextBlock(context)}\n\nUser: ${question}`,
              },
            ],
            abortSignal: abortController.signal,
          });

          for await (const delta of result.textStream) {
            send("delta", { delta });
          }
        } else {
          for (const token of tokenizeForStreaming(
            buildFallbackText(scope, context),
          )) {
            if (isCancelled) break;
            send("delta", { delta: token });
            await sleep(12);
          }
        }

        send("done", {});
      } catch (error) {
        if (!isCancelled) {
          console.error("[ai/assistant] failed to stream reply", error);
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

    cancel() {
      isCancelled = true;
      abortController.abort();
    },
  });
}
