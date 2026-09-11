import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { buildAgentContext } from "@/lib/agent/context";
import {
  confirmationRequiredResult,
  createRegistryActionExecutor,
  type ConfirmationHandler,
} from "@/lib/agent/confirmation";
import { toSafeError } from "@/lib/agent/errors";
import { createLoggingEventSink, type AgentEvent } from "@/lib/agent/events";
import { streamAgentTurn, type AgentTurnSummary } from "@/lib/agent/loop";
import { storedMessageToUIMessage } from "@/lib/agent/messages";
import {
  appendMessageParts,
  createAgentRun,
  createRunTracer,
  finishAgentRun,
  loadConversationMessages,
} from "@/lib/agent/persistence";
import { buildAgentSystemPrompt } from "@/lib/agent/prompts";
import { createDefaultToolRegistry } from "@/lib/agent/tools";
import { getModelProvider } from "@/lib/ai/model-provider";
import { isBudgetDisabled, tryConsumeAiBudget } from "@/lib/ai/budget";
import { ensureChatThreadTitle, findThreadForUser } from "@/lib/ai/chat-service";
import { apiError, withUser } from "@/lib/api/http";
import { actionService } from "@/lib/services/action-service";
import type { ChatMessagePart } from "@/lib/db/schema";

// A broad task legitimately runs for minutes; this keeps the platform from
// cutting a continuous turn short mid-work. The loop's own step budget is the
// real ceiling — see `resolveAgentBudget`.
export const maxDuration = 300;

/**
 * Cap the history fed to the model. The full transcript is still shown in the
 * UI; this only bounds prompt size so a long-running thread cannot inflate
 * token cost and latency without limit.
 */
const MODEL_HISTORY_LIMIT = 200;

const OFFLINE_NOTICE =
  "I can't reach the AI model right now, so I can't run tools. An administrator needs to configure the model provider.";

const bodySchema = z
  .object({
    conversationId: z.string().min(1).max(64),
    /**
     * The new user turn. Optional when this is a resumed turn after the user
     * confirmed or cancelled a pending action.
     */
    text: z.string().max(8_000).optional(),
    /** Set by the confirmation card to continue the loop after a decision. */
    resumeActionId: z.string().min(1).max(64).optional(),
    currentThreadId: z.string().max(256).optional(),
    currentEmailId: z.string().max(256).optional(),
  })
  .refine((value) => Boolean(value.resumeActionId || value.text?.trim()), {
    message: "A message or a resumeActionId is required.",
    path: ["text"],
  });

const TERMINAL_ACTION_STATUSES = new Set([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
]);

/**
 * Turn a finished pending action into a hidden continuation note for the model.
 *
 * The user's decision is real input the agent needs in order to keep working in
 * the same turn, but it is not something the user *typed*: the note is stored
 * hidden so it feeds model context without appearing as a chat bubble.
 */
async function buildResumeNote(input: {
  userId: string;
  conversationId: string;
  actionId: string;
}): Promise<{ ok: true; text: string } | { ok: false; code: string; message: string; status: number }> {
  let action;
  try {
    action = await actionService.getAction({
      userId: input.userId,
      actionId: input.actionId,
    });
  } catch (error) {
    const safe = toSafeError(error);
    return { ok: false, code: safe.code, message: safe.message, status: safe.httpStatus };
  }

  if (action.conversationId !== input.conversationId) {
    return {
      ok: false,
      code: "not_found",
      message: "That action does not belong to this conversation.",
      status: 404,
    };
  }
  if (!TERMINAL_ACTION_STATUSES.has(action.status)) {
    return {
      ok: false,
      code: "conflict",
      message: "That action has not finished yet.",
      status: 409,
    };
  }

  const outcome =
    action.status === "SUCCEEDED" ? "succeeded" : action.status.toLowerCase();
  const detail = summarizeActionResult(action.result);
  return {
    ok: true,
    text:
      `[system] The user reviewed the pending ${action.toolName} action. ` +
      `It ${outcome}.${detail ? ` Result: ${detail}.` : ""} ` +
      "Continue the original task if anything remains; if it is complete, reply briefly.",
  };
}

/** Bounded, client-safe rendering of a tool result for the continuation note. */
function summarizeActionResult(result: unknown): string {
  if (result == null) return "";
  try {
    const text = typeof result === "string" ? result : JSON.stringify(result);
    return text.length > 600 ? `${text.slice(0, 597)}...` : text;
  } catch {
    return "";
  }
}

/**
 * POST /api/v1/agent/chat — the agent runtime entry point.
 *
 * Canonical flow: authenticate → validate → resolve conversation ownership →
 * load server-side history → build AgentContext → run the bounded loop →
 * stream the AI SDK UI message stream → persist the assistant message.
 *
 * The client never supplies its identity or its history.
 */
export const POST = withUser(async (userId, request) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError("validation", "Invalid request.", 400);
  }
  const { conversationId, text, resumeActionId, currentThreadId, currentEmailId } =
    parsed.data;

  const thread = await findThreadForUser(userId, conversationId);
  if (!thread) {
    return apiError("not_found", "Conversation not found.", 404);
  }

  if (!isBudgetDisabled() && !(await tryConsumeAiBudget({ userId }))) {
    return apiError("rate_limited", "Daily AI limit reached. Try again tomorrow.", 429);
  }

  if (resumeActionId) {
    // The confirmation card decided on a pending action: feed the outcome back
    // so the agent continues the original task in one uninterrupted turn.
    const note = await buildResumeNote({
      userId,
      conversationId,
      actionId: resumeActionId,
    });
    if (!note.ok) {
      return apiError(note.code, note.message, note.status);
    }
    await appendMessageParts({
      conversationId,
      role: "user",
      parts: [{ type: "text", text: note.text }],
      hidden: true,
    });
  } else if (text && text.trim()) {
    await ensureChatThreadTitle(userId, conversationId, text);
    await appendMessageParts({
      conversationId,
      role: "user",
      parts: [{ type: "text", text }],
    });
  }

  const model = getModelProvider().getLanguageModel("standard");
  if (!model) {
    // Stream and persist under one generated id so the offline notice the user
    // sees rehydrates with the same identity after a reload (and two offline
    // turns can never collide on a fixed id).
    const offlineId = randomUUID();
    await appendMessageParts({
      id: offlineId,
      conversationId,
      role: "assistant",
      parts: [{ type: "text", text: OFFLINE_NOTICE }],
    });
    return textOnlyResponse(OFFLINE_NOTICE, offlineId);
  }

  const requestId = randomUUID();
  const startedAt = Date.now();

  const ctx = await buildAgentContext({
    userId,
    conversationId,
    requestId,
    currentThreadId,
    currentEmailId,
  });

  // Model context includes hidden continuity notes (e.g. a confirmed action).
  const stored = await loadConversationMessages(userId, conversationId, {
    includeHidden: true,
    limit: MODEL_HISTORY_LIMIT,
  });
  const modelMessages = await convertToModelMessages(
    stored.map(storedMessageToUIMessage),
  );
  // NOTE: we deliberately do NOT pass `originalMessages` to the UI stream. The
  // AI SDK's "continuation" mode reuses the last assistant message's id when
  // the final original message is an assistant turn. This is an append-only
  // chat, so every response must get a fresh id; reusing one makes the client
  // render two children with the same React key (and would collide on the
  // persisted primary key). `onEnd` still receives (and persists) the fresh id.

  const registry = createDefaultToolRegistry();
  const { sink: tracerSink, trace } = createRunTracer();
  const loggingSink = createLoggingEventSink("agent");
  const emit = (event: AgentEvent) => {
    tracerSink(event);
    loggingSink(event);
  };

  const runId = await createAgentRun({
    userId,
    conversationId,
    requestId,
    model: process.env.AI_MODEL_ID ?? null,
  });

  /**
   * External side effects are never executed from the model's decision. This
   * persists a pending action and returns the card payload the user must act
   * on. `ctx.conversationId` owns the row; `userId` comes from the session.
   */
  const onConfirmationRequired: ConfirmationHandler = async (request) => {
    const action = await actionService.createPendingAction({
      userId,
      conversationId,
      toolName: request.toolName,
      args: request.input,
      provider: "gmail",
    });
    return confirmationRequiredResult({
      pendingActionId: action.id,
      toolName: request.toolName,
      expiresAt: action.expiresAt,
    });
  };

  /**
   * Autopilot execution. The permission engine already decided this side
   * effect is allowed, but it still does NOT call the tool directly: it
   * persists the action and executes it through the same server-verified
   * transition the manual confirm route uses. That keeps the audit record,
   * the server-derived idempotency key and the "no confirmation, no send"
   * invariant intact — Autopilot changes *who* approves, not *whether* the
   * action is recorded.
   */
  const onAutonomousAction: ConfirmationHandler = async (request) => {
    const action = await actionService.createPendingAction({
      userId,
      conversationId,
      toolName: request.toolName,
      args: request.input,
      provider: "gmail",
    });
    emit({
      type: "ACTION_CONFIRMED",
      actionId: action.id,
      toolName: action.toolName,
      userId,
    });
    const executor = createRegistryActionExecutor({
      registry,
      ctx: request.ctx,
    });
    const startedAt = Date.now();
    try {
      const result = await actionService.confirmAction({
        userId,
        actionId: action.id,
        executor,
      });
      emit({
        type: "ACTION_SUCCEEDED",
        actionId: action.id,
        toolName: action.toolName,
        ms: Date.now() - startedAt,
      });
      return result.result;
    } catch (error) {
      emit({
        type: "ACTION_FAILED",
        actionId: action.id,
        toolName: action.toolName,
        code: toSafeError(error).code,
      });
      throw error;
    }
  };

  let finalized = false;
  const finalize = async (
    status: "completed" | "failed" | "aborted" | "limit_reached",
    summary: {
      stepCount: number;
      promptTokens?: number;
      completionTokens?: number;
      error?: string | null;
    },
  ) => {
    if (finalized) return;
    finalized = true;
    await finishAgentRun({
      runId,
      status,
      stepCount: summary.stepCount,
      promptTokens: summary.promptTokens,
      completionTokens: summary.completionTokens,
      latencyMs: Date.now() - startedAt,
      error: summary.error ?? null,
      trace,
    });
  };

  const onTurnFinish = (summary: AgentTurnSummary) =>
    finalize(summary.status, {
      stepCount: summary.steps,
      promptTokens: summary.promptTokens,
      completionTokens: summary.outputTokens,
      error: summary.errorCode ?? null,
    });

  // `onFinish` above records the terminal status (including `failed`), so this
  // only logs for operators.
  const onRunError = (error: unknown) => {
    console.error("[agent/chat] run failed", toSafeError(error).code);
  };

  // One continuous assistant turn: `streamAgentTurn` runs the model/tool loop
  // to completion, checkpointing into fresh segments and merging them into a
  // single UI message stream. The client (and the persisted transcript) see one
  // turn, so the user never has to say "continue".
  const stream = streamAgentTurn({
    ctx,
    model,
    system: buildAgentSystemPrompt({
      now: ctx.now,
      timezone: ctx.timezone,
      autonomy: ctx.permissions.autonomy,
    }),
    messages: modelMessages,
    registry,
    events: emit,
    abortSignal: request.signal,
    onConfirmationRequired,
    onAutonomousAction,
    onFinish: onTurnFinish,
    onError: onRunError,
    onStreamError: (error) => {
      console.error("[agent/chat] stream error", toSafeError(error).code);
      return "The assistant failed to respond.";
    },
    onEnd: async ({ responseMessage }) => {
      // Persist exactly what the user saw, including tool call/result parts and
      // the streamed id, so a reload reconstructs the run with matching keys.
      await appendMessageParts({
        id: responseMessage.id,
        conversationId,
        role: "assistant",
        parts: responseMessage.parts as ChatMessagePart[],
      });
    },
  });

  const response = createUIMessageStreamResponse({ stream });
  response.headers.set("X-Agent-Run-Id", runId);
  return response;
});

/** A minimal UI-message stream carrying one text part (offline / no model). */
function textOnlyResponse(text: string, id: string): Response {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      // Declare the assistant message id so the client adopts the same one we
      // persisted. Without a `start` chunk the client falls back to its own
      // generated id and the notice would remount under a new key on reload.
      writer.write({ type: "start", messageId: id });
      const textId = `${id}:text`;
      writer.write({ type: "text-start", id: textId });
      writer.write({ type: "text-delta", id: textId, delta: text });
      writer.write({ type: "text-end", id: textId });
    },
  });
  return createUIMessageStreamResponse({ stream });
}
