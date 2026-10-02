import "server-only";

import {
  createUIMessageStream,
  stepCountIs,
  streamText,
  toUIMessageStream,
  tool as createAiTool,
  type ModelMessage,
  type LanguageModel,
  type ToolSet,
  type UIMessage,
  type UIMessageChunk,
  type UIMessageStreamOnEndCallback,
} from "ai";
import type { ZodType } from "zod";

import type { AgentContext } from "@/lib/agent/context";
import type { ConfirmationHandler } from "@/lib/agent/confirmation";
import {
  compactMessages,
  shouldCompact,
  trimToolResults,
} from "@/lib/agent/compaction";
import {
  ACTIVATE_TOOLS_TOOL_NAME,
  planActiveToolNames,
  toolNamesInGroup,
  type ToolGroup,
} from "@/lib/agent/tool-groups";
import { createActivateToolsDefinition } from "@/lib/agent/activate-tools";
import { AppError, ToolExecutionError, toSafeError } from "@/lib/agent/errors";
import type { AppErrorCode } from "@/lib/agent/errors";
import {
  noopAgentEvents,
  type AgentEventSink,
} from "@/lib/agent/events";
import { decideToolPermission } from "@/lib/agent/permissions";
import {
  resolveToolTimeout,
  type AnyToolDefinition,
  type ToolRegistry,
} from "@/lib/agent/registry";
import { isProgressiveToolsEnabled } from "@/lib/env";

/**
 * The bounded agent loop.
 *
 * `streamText` runs the model/tool cycle for us; the guarantees live in the
 * wiring around it:
 *   - the loop keeps running until the model is actually done, bounded by a
 *     generous per-turn step budget (not the old 8-step ceiling);
 *   - every tool call passes through the deterministic permission engine;
 *   - every tool input is re-validated with its own Zod schema at the boundary;
 *   - every tool call has a wall-clock timeout;
 *   - transient READ failures are retried instead of burning the turn;
 *   - cancellation propagates from the request AbortSignal.
 *
 * We deliberately do NOT send `tool_choice`: the configured gateway rejects it
 * with a 400, and `auto` is the default behaviour we want anyway.
 */

/**
 * Default steps allowed in a single `streamText` segment. A segment is a
 * checkpoint: when it ends while the model still wants to call tools, the
 * runtime automatically starts another segment with the accumulated context and
 * merges it into the same assistant turn (see `streamAgentTurn`).
 */
export const MAX_AGENT_STEPS_PER_SEGMENT = 16;

/** Backwards-compatible alias: the default per-segment step budget. */
export const MAX_AGENT_STEPS = MAX_AGENT_STEPS_PER_SEGMENT;

/** How many continuation segments a single user turn may span. */
export const MAX_AGENT_SEGMENTS = 6;

/**
 * Absolute ceiling for one user turn. The loop stops here even if the model
 * still wants to continue, and the run is reported as `limit_reached`.
 */
export const MAX_AGENT_TOTAL_STEPS =
  MAX_AGENT_STEPS_PER_SEGMENT * MAX_AGENT_SEGMENTS;

/** Attempts (including the first) for a READ tool before reporting failure. */
export const READ_RETRY_ATTEMPTS = 2;

/** Linear backoff between READ attempts, in milliseconds. */
export const READ_RETRY_BACKOFF_MS = 400;

export interface AgentBudget {
  /** Model steps allowed before checkpointing into a new segment. */
  stepsPerSegment: number;
  /** Maximum continuation segments in one turn. */
  maxSegments: number;
  /** Absolute step ceiling across all segments of a turn. */
  maxTotalSteps: number;
  /** Prompt+completion token ceiling for a turn (0 = uncapped). */
  maxTokensPerRun: number;
}

export const DEFAULT_AGENT_MAX_TOKENS_PER_RUN = 200_000;

function clampInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/**
 * Resolve the per-turn budget from the environment so cost/latency can be
 * tuned without a code change. Budgets are intentionally generous by default:
 * a broad task (summarise a week of mail) legitimately needs many steps.
 */
export function resolveAgentBudget(
  env: NodeJS.ProcessEnv = process.env,
): AgentBudget {
  const stepsPerSegment = clampInt(
    env.AGENT_MAX_STEPS_PER_SEGMENT,
    MAX_AGENT_STEPS_PER_SEGMENT,
    1,
    200,
  );
  const maxSegments = clampInt(
    env.AGENT_MAX_SEGMENTS,
    MAX_AGENT_SEGMENTS,
    1,
    50,
  );
  const maxTotalSteps = clampInt(
    env.AGENT_MAX_TOTAL_STEPS,
    stepsPerSegment * maxSegments,
    1,
    1_000,
  );
  const maxTokensPerRun = clampInt(
    env.AGENT_MAX_TOKENS_PER_RUN,
    DEFAULT_AGENT_MAX_TOKENS_PER_RUN,
    0,
    10_000_000,
  );
  return { stepsPerSegment, maxSegments, maxTotalSteps, maxTokensPerRun };
}

/** True once a turn has spent its token budget. `0` means uncapped. */
export function isTokenBudgetExhausted({
  totalTokens,
  maxTokensPerRun,
}: {
  totalTokens: number;
  maxTokensPerRun: number;
}): boolean {
  return maxTokensPerRun > 0 && totalTokens >= maxTokensPerRun;
}

export interface AgentRunSummary {
  steps: number;
  finishReason?: string;
  promptTokens: number;
  outputTokens: number;
}

export interface RunAgentOptions {
  ctx: AgentContext;
  model: LanguageModel;
  system: string;
  messages: ModelMessage[];
  registry: ToolRegistry;
  events?: AgentEventSink;
  abortSignal?: AbortSignal;
  /**
   * Persists an external side effect as a pending action and returns the value
   * streamed back as the tool result. When absent, side effects are refused —
   * the safe default.
   */
  onConfirmationRequired?: ConfirmationHandler;
  /**
   * Executes an external side effect on the user's behalf when Autopilot has
   * granted it (permission engine returns `allow`). The handler must still
   * route through the server-owned action record so audit + idempotency hold;
   * it returns the real tool result. When absent, an autonomous side effect is
   * refused rather than executed.
   */
  onAutonomousAction?: ConfirmationHandler;
  /** Per-segment step budget. Defaults to `MAX_AGENT_STEPS_PER_SEGMENT`. */
  maxSteps?: number;
  /** Offset added to emitted step numbers when running as a continuation. */
  stepOffset?: number;
  /** Persists a compaction summary so a reload can rehydrate the bound. */
  onCompact?: (result: {
    summary: string;
    compactedCount: number;
  }) => void | Promise<void>;
  onFinish?: (summary: AgentRunSummary) => void | Promise<void>;
  onAbort?: () => void | Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
  /**
   * Progressive tool disclosure (§5.3). When true, only core tools are active
   * until the model calls `activate_tools`. Defaults to the env gate.
   */
  progressiveTools?: boolean;
  /**
   * Per-turn activation state, shared across continuation segments so a group
   * unlocked in one segment stays unlocked in the next. Created when omitted.
   */
  activatedGroups?: Set<ToolGroup>;
}

/** Instantiate the AI SDK tool set, wrapping each definition with policy. */
export function buildToolSet({
  ctx,
  registry,
  events,
  getStep,
  onConfirmationRequired,
  onAutonomousAction,
}: {
  ctx: AgentContext;
  registry: ToolRegistry;
  events: AgentEventSink;
  getStep: () => number;
  onConfirmationRequired?: ConfirmationHandler;
  onAutonomousAction?: ConfirmationHandler;
}): ToolSet {
  const tools: ToolSet = {};

  for (const definition of registry.list()) {
    tools[definition.name] = createAiTool({
      description: definition.description,
      inputSchema: definition.inputSchema as ZodType,
      execute: async (input: unknown, { toolCallId, abortSignal }) => {
        return executeToolDefinition({
          definition,
          ctx,
          rawInput: input,
          toolCallId,
          events,
          step: getStep(),
          abortSignal,
          ...(onConfirmationRequired ? { onConfirmationRequired } : {}),
          ...(onAutonomousAction ? { onAutonomousAction } : {}),
        });
      },
    });
  }

  return tools;
}

async function executeToolDefinition({
  definition,
  ctx,
  rawInput,
  toolCallId,
  events,
  step,
  abortSignal,
  onConfirmationRequired,
  onAutonomousAction,
}: {
  definition: AnyToolDefinition;
  ctx: AgentContext;
  rawInput: unknown;
  toolCallId: string;
  events: AgentEventSink;
  step: number;
  abortSignal?: AbortSignal;
  onConfirmationRequired?: ConfirmationHandler;
  onAutonomousAction?: ConfirmationHandler;
}): Promise<unknown> {
  const decision = decideToolPermission(ctx, definition);
  const requiresConfirmation = decision.kind === "require_confirmation";

  if (decision.kind === "deny") {
    events({ type: "TOOL_DENIED", step, toolName: definition.name, toolCallId, reason: decision.reason });
    throw new ToolExecutionError(definition.name, decision.reason);
  }

  // Input is validated *before* anything is persisted or executed: the model
  // must not be able to create a pending action from malformed arguments.
  const parsed = definition.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const detail = issue ? `${issue.path.join(".") || "input"}: ${issue.message}` : "invalid input";
    throw new ToolExecutionError(definition.name, `Invalid arguments (${detail}).`);
  }

  // Autopilot granted this external side effect. It still runs through the
  // server-owned action path (audit + idempotency) via the autonomous handler;
  // executing the tool directly would fail its "no confirmation, no send"
  // invariant, which is exactly what we want.
  const autonomous =
    decision.kind === "allow" && definition.risk === "EXTERNAL_SIDE_EFFECT";

  if (autonomous && !onAutonomousAction) {
    events({
      type: "TOOL_DENIED",
      step,
      toolName: definition.name,
      toolCallId,
      reason: "Autonomous side effects are unavailable.",
    });
    throw new ToolExecutionError(
      definition.name,
      "This action needs confirmation, which is unavailable right now.",
    );
  }

  if (requiresConfirmation) {
    if (!onConfirmationRequired) {
      // No confirmation channel is wired: refuse rather than execute.
      events({ type: "TOOL_DENIED", step, toolName: definition.name, toolCallId, reason: decision.reason });
      throw new ToolExecutionError(definition.name, decision.reason);
    }

    const output = await onConfirmationRequired({
      ctx,
      toolName: definition.name,
      risk: definition.risk,
      input: parsed.data as Record<string, unknown>,
      toolCallId,
      step,
    });

    const actionId =
      output && typeof output === "object" && "pendingActionId" in output
        ? String((output as { pendingActionId: unknown }).pendingActionId)
        : "unknown";
    events({
      type: "CONFIRMATION_REQUIRED",
      step,
      toolName: definition.name,
      toolCallId,
      actionId,
    });
    return output;
  }

  // Autopilot side effects go through the autonomous handler (which owns the
  // action record and re-runs `authorize`); everything else runs the tool
  // directly after its own authorize gate.
  let invoke: () => Promise<unknown>;
  if (autonomous) {
    invoke = () =>
      onAutonomousAction!({
        ctx,
        toolName: definition.name,
        risk: definition.risk,
        input: parsed.data as Record<string, unknown>,
        toolCallId,
        step,
      });
  } else {
    await definition.authorize?.(ctx, parsed.data);
    invoke = () => definition.execute(ctx, parsed.data);
  }

  events({ type: "TOOL_STARTED", step, toolName: definition.name, risk: definition.risk, toolCallId });
  const startedAt = Date.now();

  // READs are side-effect free, so a transient provider hiccup is retried
  // inside the turn rather than costing the model a step and derailing the
  // task. Writes and external side effects are never retried here: their
  // idempotency is owned by the service layer.
  const maxAttempts = definition.risk === "READ" ? READ_RETRY_ATTEMPTS : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const output = await withTimeout(
        invoke(),
        resolveToolTimeout(definition.timeoutMs),
        abortSignal,
      );
      events({
        type: "TOOL_SUCCEEDED",
        step,
        toolName: definition.name,
        toolCallId,
        ms: Date.now() - startedAt,
      });
      return output;
    } catch (error) {
      lastError = error;
      const retryable =
        attempt < maxAttempts &&
        isRetryableReadError(error) &&
        !abortSignal?.aborted;
      if (!retryable) break;

      events({
        type: "TOOL_RETRY",
        step,
        toolName: definition.name,
        toolCallId,
        attempt,
      });
      await delay(READ_RETRY_BACKOFF_MS * attempt, abortSignal);
    }
  }

  const error = lastError;
  const safe = toSafeError(error);
  events({
    type: "TOOL_FAILED",
    step,
    toolName: definition.name,
    toolCallId,
    ms: Date.now() - startedAt,
    code: safe.code,
  });
  // AppError messages are already safe for the model; anything else is
  // collapsed so we never leak provider/DB detail into the transcript.
  if (error instanceof AppError) throw error;
  console.error(`[agent] tool ${definition.name} failed`, error);
  throw new ToolExecutionError(definition.name, "The tool failed to complete.");
}

/** A tool wait that respects cancellation: abort resolves it early. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

const NON_RETRYABLE_READ_CODES: ReadonlySet<AppErrorCode> = new Set([
  "unauthorized",
  "forbidden",
  "validation",
  "not_found",
  "conflict",
]);

function isRetryableReadError(error: unknown): boolean {
  if (error instanceof AppError) return !NON_RETRYABLE_READ_CODES.has(error.code);
  return true;
}

export function runAgent(options: RunAgentOptions) {
  const { ctx, model, system, messages, registry, abortSignal } = options;
  const events = options.events ?? noopAgentEvents;
  let currentStep = options.stepOffset ?? 0;

  // §5.3 — progressive tool disclosure. Off by default (env gate); when on, the
  // model sees only core tools plus the `activate_tools` control tool until it
  // unlocks a group.
  const progressiveTools =
    options.progressiveTools ?? isProgressiveToolsEnabled();
  const activatedGroups = options.activatedGroups ?? new Set<ToolGroup>();
  const registryToolNames = registry.list().map((definition) => definition.name);
  const selectableToolNames = progressiveTools
    ? [...registryToolNames, ACTIVATE_TOOLS_TOOL_NAME]
    : registryToolNames;

  const tools = buildToolSet({
    ctx,
    registry,
    events,
    getStep: () => currentStep,
    ...(options.onConfirmationRequired
      ? { onConfirmationRequired: options.onConfirmationRequired }
      : {}),
    ...(options.onAutonomousAction
      ? { onAutonomousAction: options.onAutonomousAction }
      : {}),
  });

  if (progressiveTools) {
    const definition = createActivateToolsDefinition({
      activate: (groups) => {
        const unlocked: ToolGroup[] = [];
        for (const group of groups) {
          if (group !== "core" && !activatedGroups.has(group)) {
            activatedGroups.add(group);
            unlocked.push(group);
          }
        }
        return {
          activated: unlocked,
          nowAvailable: unlocked.flatMap((group) =>
            toolNamesInGroup(group, selectableToolNames),
          ),
        };
      },
    });
    tools[ACTIVATE_TOOLS_TOOL_NAME] = createAiTool({
      description: definition.description,
      inputSchema: definition.inputSchema as ZodType,
      execute: async (input: unknown, { toolCallId, abortSignal: callSignal }) =>
        executeToolDefinition({
          definition,
          ctx,
          rawInput: input,
          toolCallId,
          events,
          step: currentStep,
          ...(callSignal ? { abortSignal: callSignal } : {}),
        }),
    });
  }

  return streamText({
    model,
    system,
    messages,
    tools,
    stopWhen: stepCountIs(options.maxSteps ?? MAX_AGENT_STEPS_PER_SEGMENT),
    // Bound the context on every step: trim stale tool results, and (rarely)
    // compact the history once it crosses the token threshold. Also recompute
    // the active tool set so a group unlocked on the previous step is visible.
    prepareStep: async ({ messages: stepMessages }) => {
      let nextMessages = stepMessages;
      if (shouldCompact(stepMessages)) {
        const compacted = await compactMessages({
          messages: stepMessages,
          userId: ctx.userId,
        });
        if (compacted.compactedCount > 0) {
          await options.onCompact?.({
            summary: compacted.summary,
            compactedCount: compacted.compactedCount,
          });
          nextMessages = trimToolResults(compacted.compactedMessages);
        } else {
          nextMessages = trimToolResults(stepMessages);
        }
      } else {
        nextMessages = trimToolResults(stepMessages);
      }

      const activeTools = planActiveToolNames({
        allToolNames: selectableToolNames,
        activatedGroups: [...activatedGroups],
        progressive: progressiveTools,
      });
      return activeTools
        ? { messages: nextMessages, activeTools }
        : { messages: nextMessages };
    },
    ...(abortSignal ? { abortSignal } : {}),
    onStepStart: () => {
      currentStep += 1;
      events({ type: "MODEL_STEP_STARTED", step: currentStep });
    },
    onStepFinish: (step) => {
      events({
        type: "MODEL_STEP_FINISHED",
        step: currentStep,
        ms: 0,
        finishReason: step.finishReason,
      });
    },
    onFinish: (event) => {
      const steps = event.steps ?? [];
      const promptTokens = steps.reduce(
        (total, step) => total + (step.usage?.inputTokens ?? 0),
        0,
      );
      const outputTokens = steps.reduce(
        (total, step) => total + (step.usage?.outputTokens ?? 0),
        0,
      );
      return options.onFinish?.({
        steps: steps.length,
        finishReason: event.finishReason,
        promptTokens,
        outputTokens,
      });
    },
    onAbort: () => options.onAbort?.(),
    onError: (event) => options.onError?.(event.error),
  });
}

/**
 * Run one user turn as a *continuous* assistant turn.
 *
 * The model/tool cycle already runs natively inside `streamText` until either
 * it naturally finishes or the per-segment step budget is reached. When the
 * budget is reached while the model still wants to call tools, this wraps that
 * cycle in an outer loop: it feeds the accumulated messages into another
 * `streamText` segment and merges its UI stream into the same assistant
 * message. The user sees one uninterrupted turn; the model keeps working until
 * the task is actually done or the turn budget is exhausted.
 *
 * Bounds (all from `resolveAgentBudget`): steps per segment, segment count and
 * a total step ceiling. They are deliberately generous; a broad task legitimately
 * needs many steps.
 */
export type AgentTurnStatus =
  | "completed"
  | "limit_reached"
  | "aborted"
  | "failed";

export interface AgentTurnSummary {
  status: AgentTurnStatus;
  /** Total model steps across all segments. */
  steps: number;
  /** How many continuation segments ran. */
  segments: number;
  finishReason?: string;
  promptTokens: number;
  outputTokens: number;
  /** Client-safe error code when `status` is `failed`. */
  errorCode?: string;
}

export interface StreamAgentTurnOptions {
  ctx: AgentContext;
  model: LanguageModel;
  system: string;
  messages: ModelMessage[];
  registry: ToolRegistry;
  events?: AgentEventSink;
  abortSignal?: AbortSignal;
  onConfirmationRequired?: ConfirmationHandler;
  onAutonomousAction?: ConfirmationHandler;
  /**
   * Existing UI messages for the conversation. Only supplied by callers that
   * want the AI SDK's "continuation" mode (e.g. regenerate), where the last
   * assistant message's id is intentionally reused. Append-only callers must
   * omit it so each response gets a fresh id.
   */
  originalMessages?: UIMessage[];
  /** Client-safe error text for the UI stream. */
  onStreamError?: (error: unknown) => string;
  /** Persists a compaction summary (best-effort). */
  onCompact?: (result: {
    summary: string;
    compactedCount: number;
  }) => void | Promise<void>;
  /** Called exactly once when the whole turn settles. */
  onFinish?: (summary: AgentTurnSummary) => void | Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
  /** Persistence hook: receives the fully merged assistant message. */
  onEnd?: UIMessageStreamOnEndCallback<UIMessage>;
  budget?: AgentBudget;
  /** Progressive tool disclosure (§5.3). Defaults to the env gate. */
  progressiveTools?: boolean;
}

export function streamAgentTurn(
  options: StreamAgentTurnOptions,
): ReadableStream<UIMessageChunk> {
  const budget = options.budget ?? resolveAgentBudget();
  const events = options.events ?? noopAgentEvents;
  const conversation: ModelMessage[] = [...options.messages];
  const progressiveTools =
    options.progressiveTools ?? isProgressiveToolsEnabled();
  const activatedGroups = new Set<ToolGroup>();
  let currentStep = 0;
  let segments = 0;
  let promptTokens = 0;
  let outputTokens = 0;

  return createUIMessageStream({
    ...(options.originalMessages
      ? { originalMessages: options.originalMessages }
      : {}),
    ...(options.onEnd ? { onEnd: options.onEnd } : {}),
    onError:
      options.onStreamError ?? (() => "The assistant failed to respond."),
    execute: async ({ writer }) => {
      let status: AgentTurnStatus = "completed";
      let finishReason: string | undefined;
      let errorCode: string | undefined;

      try {
        for (let segment = 0; segment < budget.maxSegments; segment += 1) {
          if (options.abortSignal?.aborted) {
            status = "aborted";
            break;
          }

          segments = segment + 1;

          const result = runAgent({
            ctx: options.ctx,
            model: options.model,
            system: options.system,
            messages: conversation,
            registry: options.registry,
            events,
            maxSteps: budget.stepsPerSegment,
            stepOffset: currentStep,
            progressiveTools,
            activatedGroups,
            ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
            ...(options.onCompact ? { onCompact: options.onCompact } : {}),
            ...(options.onConfirmationRequired
              ? { onConfirmationRequired: options.onConfirmationRequired }
              : {}),
            ...(options.onAutonomousAction
              ? { onAutonomousAction: options.onAutonomousAction }
              : {}),
            onError: (error) => options.onError?.(error),
          });

          writer.merge(
            toUIMessageStream({
              stream: result.stream,
              sendStart: segment === 0,
              sendFinish: false,
              ...(options.onStreamError
                ? { onError: options.onStreamError }
                : {}),
              onEnd: ({ outcome }) => writer.setOutcome(outcome),
            }),
          );

          // Wait for this segment to settle before deciding whether to run
          // another one; this is what makes the continuation sequential.
          const steps = await result.steps;
          currentStep += steps.length;
          for (const step of steps) {
            promptTokens += step.usage?.inputTokens ?? 0;
            outputTokens += step.usage?.outputTokens ?? 0;
          }

          finishReason = await result.finishReason;
          const responseMessages = await result.responseMessages;
          conversation.push(...responseMessages);

          // The token budget is a hard ceiling independent of the step count:
          // a few huge tool results must not blow past a single turn's cost.
          if (
            isTokenBudgetExhausted({
              totalTokens: promptTokens + outputTokens,
              maxTokensPerRun: budget.maxTokensPerRun,
            })
          ) {
            status = "limit_reached";
            break;
          }

          // The model stopped by choice (not the step budget): the task is done.
          if (finishReason !== "tool-calls") break;

          // It still wanted to act. Stop only if the turn budget is spent.
          if (currentStep >= budget.maxTotalSteps) {
            status = "limit_reached";
            break;
          }
          if (segments >= budget.maxSegments) {
            status = "limit_reached";
            break;
          }
        }

        if (status === "limit_reached") {
          // The safety cap, not the model, ended the turn. Say so instead of
          // stopping silently so the user knows a single follow-up continues it.
          const id = "agent-limit-notice";
          writer.write({ type: "text-start", id });
          writer.write({
            type: "text-delta",
            id,
            delta:
              "\n\nI reached the step limit for this turn. Say “continue” and I'll pick up where I left off.",
          });
          writer.write({ type: "text-end", id });
        }
      } catch (error) {
        if (options.abortSignal?.aborted) {
          // The client cancelled. The stream is already closing; just record
          // the status and do not surface an error part.
          status = "aborted";
          return;
        }
        status = "failed";
        errorCode = toSafeError(error).code;
        await options.onError?.(error);
        // Let the composer surface a client-safe error part.
        throw error;
      } finally {
        await options.onFinish?.({
          status,
          steps: currentStep,
          segments,
          finishReason,
          promptTokens,
          outputTokens,
          ...(errorCode ? { errorCode } : {}),
        });
      }
    },
  });
}

/**
 * Reject if the tool outlives its budget or the request is cancelled.
 *
 * Note: this bounds *our* wait. Threading the signal into the provider fetch is
 * a follow-up (Gmail's transport has its own timeout); the tool result is
 * discarded either way, so a slow provider can never stall the agent loop.
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ToolExecutionError("tool", "The operation was cancelled."));
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      reject(new ToolExecutionError("tool", "The operation timed out."));
    }, timeoutMs);

    const onAbort = () => {
      cleanup();
      reject(new ToolExecutionError("tool", "The operation was cancelled."));
    };

    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }

    signal?.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}
