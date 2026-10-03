import "server-only";

import { nanoid } from "nanoid";

import { NotFoundError } from "@/lib/agent/errors";
import type { AgentEventSink } from "@/lib/agent/events";
import type { AgentTraceEntry, ChatMessagePart } from "@/lib/db/schema";
import { agentChatRepository } from "@/lib/repositories/agent-chat";
import { agentRunsRepository } from "@/lib/repositories/agent-runs";

/**
 * Agent persistence: run records, the ordered trace, and message parts.
 *
 * Message parts are stored in the shape the UI rehydrates, so a reload restores
 * tool cards exactly as they streamed. This module never reads a conversation
 * without an owner check.
 */

export async function createAgentRun(input: {
  userId: string;
  conversationId: string;
  requestId: string;
  model: string | null;
}): Promise<string> {
  const id = nanoid();
  await agentRunsRepository.insertRun({
    id,
    userId: input.userId,
    conversationId: input.conversationId,
    requestId: input.requestId,
    model: input.model,
    status: "running",
  });
  return id;
}

export async function finishAgentRun(input: {
  runId: string;
  status: "completed" | "failed" | "aborted" | "limit_reached";
  stepCount: number;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs: number;
  error?: string | null;
  trace: AgentTraceEntry[];
}): Promise<void> {
  await agentRunsRepository.updateRunById({
    runId: input.runId,
    values: {
      status: input.status,
      stepCount: input.stepCount,
      promptTokens: input.promptTokens ?? 0,
      completionTokens: input.completionTokens ?? 0,
      latencyMs: input.latencyMs,
      error: input.error ? input.error.slice(0, 500) : null,
      trace: input.trace,
      finishedAt: new Date(),
    },
  });
}

export type StoredMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  parts: ChatMessagePart[];
  hidden: boolean;
  createdAt: string;
};

/** Append a message and bump the conversation's activity timestamps. */
export async function appendMessageParts(input: {
  conversationId: string;
  role: StoredMessage["role"];
  parts: ChatMessagePart[];
  hidden?: boolean;
  /**
   * Reuse the id the UI stream already sent the client. Keeping the stored and
   * streamed ids identical means a reload restores the same message identity
   * and a later turn can never collide with the persisted row.
   */
  id?: string;
}): Promise<StoredMessage> {
  const row = await agentChatRepository.insertMessage({
    id: input.id ?? nanoid(),
    threadId: input.conversationId,
    role: input.role,
    parts: input.parts,
    hidden: input.hidden ?? false,
  });

  await agentChatRepository.touchThread(input.conversationId, new Date());

  return {
    id: row.id,
    role: row.role as StoredMessage["role"],
    parts: row.parts,
    hidden: row.hidden,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Ordered history for a conversation the user owns. */
export async function loadConversationMessages(
  userId: string,
  conversationId: string,
  options: { includeHidden?: boolean; limit?: number } = {},
): Promise<StoredMessage[]> {
  const owned = await agentRunsRepository.findThreadIdForUser(
    userId,
    conversationId,
  );

  if (!owned) throw new NotFoundError("Conversation not found.");

  // A `limit` returns the most recent N (oldest-first) for bounded model
  // context; without it the full transcript is returned for the UI.
  const rows =
    options.limit && options.limit > 0
      ? (
          await agentRunsRepository.listRecentMessagesByThread(
            conversationId,
            options.limit,
          )
        ).reverse()
      : await agentChatRepository.listMessages(conversationId);

  return rows
    .filter((row) => options.includeHidden || !row.hidden)
    .map((row) => ({
      id: row.id,
      role: row.role as StoredMessage["role"],
      parts: row.parts,
      hidden: row.hidden,
      createdAt: row.createdAt.toISOString(),
    }));
}

/**
 * Accumulates the run trace while emitting observability events. Returns both
 * the sink to hand to the loop and the collected entries to persist.
 */
export function createRunTracer(): {
  sink: AgentEventSink;
  trace: AgentTraceEntry[];
} {
  const trace: AgentTraceEntry[] = [];

  const sink: AgentEventSink = (event) => {
    switch (event.type) {
      case "MODEL_STEP_STARTED":
        break;
      case "TOOL_SUCCEEDED":
        trace.push({
          step: event.step,
          kind: "tool",
          toolName: event.toolName,
          status: "ok",
          ms: event.ms,
        });
        break;
      case "TOOL_FAILED":
        trace.push({
          step: event.step,
          kind: "tool",
          toolName: event.toolName,
          status: "error",
          ms: event.ms,
          detail: { code: event.code },
        });
        break;
      case "TOOL_DENIED":
        trace.push({
          step: event.step,
          kind: "tool",
          toolName: event.toolName,
          status: "denied",
          ms: 0,
          detail: { reason: event.reason },
        });
        break;
      case "CONFIRMATION_REQUIRED":
        trace.push({
          step: event.step,
          kind: "tool",
          toolName: event.toolName,
          status: "ok",
          ms: 0,
          detail: { actionId: event.actionId, confirmationRequired: true },
        });
        break;
      default:
        break;
    }
  };

  return { sink, trace };
}

/**
 * Persist the latest context-compaction summary onto the conversation. Best
 * effort: a failure to record observability must never break a turn.
 */
export async function saveThreadCompaction(input: {
  conversationId: string;
  summary: string;
}): Promise<void> {
  if (!input.summary.trim()) return;
  try {
    await agentRunsRepository.updateCompactionSummary(
      input.conversationId,
      input.summary.slice(0, 8_000),
    );
  } catch (error) {
    console.warn("[agent] failed to persist compaction summary", error);
  }
}
