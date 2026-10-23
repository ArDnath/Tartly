import "server-only";

import { generateObject as aiGenerateObject, generateText as aiGenerateText, streamText as aiStreamText } from "ai";
import type { LanguageModel } from "ai";
import type { ZodType } from "zod";

import {
  candidateKey,
  runWithModelFallback,
  type ModelCandidate,
} from "@/lib/ai/model-chain";
import { circuitBreaker } from "@/lib/ai/circuit-breaker";
import { hasCredits } from "@/lib/billing/credits";
import {
  DEFAULT_GLOBAL_AI_DAILY_BUDGET,
  isBudgetDisabled,
  isGlobalAiBudgetExhausted,
  tryConsumeAiBudget,
} from "@/lib/ai/budget";
import { applyPromptHardeningToSystem, type PromptHardening } from "@/lib/ai/prompts";
import { getModelProvider, type ModelRole } from "@/lib/ai/model-provider";
import { recordAiUsage } from "@/lib/ai/usage";

/**
 * Unified AI generation (Phase 0).
 *
 * One entry point for every model call, so the whole platform gets the same
 * guarantees:
 *   - **Role routing** — callers name a role (`fast`/`standard`/`reasoning`),
 *     never a model. The active provider resolves the role to an ordered chain.
 *   - **Fallback chain** — a retryable failure (429/5xx/timeout/invalid model)
 *     advances to the next candidate; if all fail we return `null` so the
 *     feature serves its deterministic result.
 *   - **Circuit breaker** — an open provider is skipped entirely.
 *   - **Budget** — per-user daily budget (skipping is a client-visible signal)
 *     plus an optional platform-wide ceiling; user-initiated calls survive the
 *     global cap.
 *   - **Usage ledger** — every attempt records tokens/cost/latency (A4).
 *   - **Timeouts** — every call is bounded; a slow provider can never stall the
 *     pipeline.
 *   - **Prompt hardening** — system instructions get the matching security
 *     footer for their trust level.
 *
 * Call sites MUST supply a deterministic fallback; `null` is never an error the
 * user sees as a 500.
 */

export const DEFAULT_AI_TIMEOUT_MS = 20_000;

export type GenerateOptions = {
  role: ModelRole;
  /** Ledger label, e.g. "triage", "draft-reply". */
  feature: string;
  /** Owner for the budget + ledger. Omitted for system jobs. */
  userId?: string;
  system: string;
  prompt: string;
  /** Hard cap on generated tokens. Always set one. */
  maxOutputTokens?: number;
  hardening?: PromptHardening;
  /** Per-call wall-clock budget. */
  timeoutMs?: number;
  /**
   * User-initiated calls (chat, explicit "draft this") are still allowed once
   * the *global* daily budget is spent; background classification is not.
   */
  userInitiated?: boolean;
  /** Hint for gateways with explicit prompt caching. No-op when unsupported. */
  cacheKey?: string;
};

export async function generateObject<T>({
  schema,
  ...options
}: GenerateOptions & { schema: ZodType<T> }): Promise<T | null> {
  const result = await runGeneration(options, async (model, system) => {
    const { object, usage } = await aiGenerateObject({
      model,
      schema,
      system,
      prompt: options.prompt,
      ...(options.maxOutputTokens
        ? { maxOutputTokens: options.maxOutputTokens }
        : {}),
      abortSignal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS),
    });
    return { value: object as T, usage };
  });
  return result?.value ?? null;
}

export async function generateText(
  options: GenerateOptions,
): Promise<string | null> {
  const result = await runGeneration(options, async (model, system) => {
    const response = await aiGenerateText({
      model,
      system,
      prompt: options.prompt,
      ...(options.maxOutputTokens
        ? { maxOutputTokens: options.maxOutputTokens }
        : {}),
      abortSignal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS),
    });
    return { value: response.text, usage: response.usage };
  });
  return result?.value ?? null;
}

/**
 * Streaming text generation, sharing every guarantee of `generateText`:
 * role routing, budget, circuit breaker, timeout, usage ledger and the
 * deterministic fallback contract (a `null` return means "serve your own").
 *
 * The chain is attempted eagerly: each candidate is started and must yield a
 * first token before it is accepted, so a dead primary still falls through to
 * the next candidate *before* any bytes reach the client. A failure mid-stream
 * cannot be retried (bytes are already sent), which is why the call site still
 * needs a deterministic fallback.
 */
export async function streamGenerate(
  options: GenerateOptions,
): Promise<ReadableStream<string> | null> {
  const provider = getModelProvider();
  if (!provider.isConfigured()) return null;
  if (!(await withinBudget(options))) return null;

  const system = applyPromptHardeningToSystem({
    instructions: options.system,
    ...(options.hardening ? { hardening: options.hardening } : {}),
  });

  const available: Array<{ candidate: ModelCandidate; model: LanguageModel }> = [];
  for (const candidate of provider.getModelChain(options.role)) {
    if (await circuitBreaker.isOpen(candidate.providerId)) continue;
    const model = provider.getLanguageModelForCandidate(candidate);
    if (model) available.push({ candidate, model });
  }
  if (available.length === 0) return null;

  for (const { candidate, model } of available) {
    const startedAt = Date.now();
    try {
      const result = aiStreamText({
        model,
        system,
        prompt: options.prompt,
        ...(options.maxOutputTokens
          ? { maxOutputTokens: options.maxOutputTokens }
          : {}),
        abortSignal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS),
      });

      const iterator = result.textStream[Symbol.asyncIterator]();
      // Confirm the candidate before returning a stream; a synchronous/immediate
      // failure still advances the chain.
      const first = await iterator.next();

      return new ReadableStream<string>({
        async start(controller) {
          try {
            if (!first.done) controller.enqueue(first.value);
            for (;;) {
              const next = await iterator.next();
              if (next.done) break;
              controller.enqueue(next.value);
            }
            controller.close();
            const usage = await Promise.resolve(result.usage).catch(() => undefined);
            await recordAiUsage({
              ...(options.userId ? { userId: options.userId } : {}),
              feature: options.feature,
              provider: candidate.providerId,
              model: candidate.modelId,
              role: options.role,
              ...extractUsage(usage),
              latencyMs: Date.now() - startedAt,
              ok: true,
            });
            await circuitBreaker.recordSuccess(candidate.providerId);
          } catch (error) {
            controller.error(error);
            await recordAiUsage({
              ...(options.userId ? { userId: options.userId } : {}),
              feature: options.feature,
              provider: candidate.providerId,
              model: candidate.modelId,
              role: options.role,
              latencyMs: Date.now() - startedAt,
              ok: false,
              errorCode: classifyErrorCode(error),
            });
            if (isRetryableModelError(error)) {
              await circuitBreaker.recordFailure(candidate.providerId);
            }
          }
        },
      });
    } catch (error) {
      await recordAiUsage({
        ...(options.userId ? { userId: options.userId } : {}),
        feature: options.feature,
        provider: candidate.providerId,
        model: candidate.modelId,
        role: options.role,
        latencyMs: Date.now() - startedAt,
        ok: false,
        errorCode: classifyErrorCode(error),
      });
      if (isRetryableModelError(error)) {
        await circuitBreaker.recordFailure(candidate.providerId);
      }
      if (!isRetryableModelError(error)) return null;
    }
  }

  return null;
}

/** Raw token counts the AI SDK reports for one call. */
export type GenerationUsage = {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  totalTokens: number;
};

export function extractUsage(usage: unknown): GenerationUsage {
  const source = (usage ?? {}) as {
    inputTokens?: unknown;
    outputTokens?: unknown;
    totalTokens?: unknown;
    inputTokenDetails?: { cacheReadTokens?: unknown };
  };
  const num = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;

  const promptTokens = num(source.inputTokens);
  const completionTokens = num(source.outputTokens);
  const cachedTokens = num(source.inputTokenDetails?.cacheReadTokens);
  const totalTokens = num(source.totalTokens) || promptTokens + completionTokens;
  return { promptTokens, completionTokens, cachedTokens, totalTokens };
}

type AttemptRunner<T> = (
  model: LanguageModel,
  system: string,
  candidate: ModelCandidate,
) => Promise<{ value: T; usage?: unknown }>;

async function runGeneration<T>(
  options: GenerateOptions,
  run: AttemptRunner<T>,
): Promise<{ value: T; candidate: ModelCandidate } | null> {
  const provider = getModelProvider();
  if (!provider.isConfigured()) return null;

  if (!(await withinBudget(options))) return null;

  const system = applyPromptHardeningToSystem({
    instructions: options.system,
    ...(options.hardening ? { hardening: options.hardening } : {}),
  });

  // Resolve the chain to concrete models up front so an unconfigured candidate
  // is skipped rather than counted as a provider failure.
  const available: Array<{ candidate: ModelCandidate; model: LanguageModel }> = [];
  for (const candidate of provider.getModelChain(options.role)) {
    if (await circuitBreaker.isOpen(candidate.providerId)) continue;
    const model = provider.getLanguageModelForCandidate(candidate);
    if (model) available.push({ candidate, model });
  }
  if (available.length === 0) return null;

  const byKey = new Map(
    available.map(({ candidate, model }) => [candidateKey(candidate), model]),
  );
  const candidates = available.map(({ candidate }) => candidate);

  return runWithModelFallback<T>({
    candidates,
    attempt: async (candidate, index) => {
      const model = byKey.get(candidateKey(candidate))!;
      const startedAt = Date.now();
      try {
        const { value, usage } = await run(model, system, candidate);
        await recordAiUsage({
          ...(options.userId ? { userId: options.userId } : {}),
          feature: options.feature,
          provider: candidate.providerId,
          model: candidate.modelId,
          role: options.role,
          ...extractUsage(usage),
          latencyMs: Date.now() - startedAt,
          ok: true,
        });
        await circuitBreaker.recordSuccess(candidate.providerId);
        if (index > 0) {
          console.info(
            `[ai/generate] ${options.feature} recovered on fallback ${candidateKey(candidate)} (depth ${index})`,
          );
        }
        return value;
      } catch (error) {
        await recordAiUsage({
          ...(options.userId ? { userId: options.userId } : {}),
          feature: options.feature,
          provider: candidate.providerId,
          model: candidate.modelId,
          role: options.role,
          latencyMs: Date.now() - startedAt,
          ok: false,
          errorCode: classifyErrorCode(error),
        });
        // Only provider/transient failures should ever trip the breaker; a
        // malformed model response is not an outage.
        if (isRetryableModelError(error)) {
          await circuitBreaker.recordFailure(candidate.providerId);
        }
        throw error;
      }
    },
    isRetryable: isRetryableModelError,
    onFailure: ({ candidate, error }, hasNext) => {
      if (hasNext) {
        console.warn(
          `[ai/generate] ${options.feature} failed on ${candidateKey(candidate)}, falling back`,
          classifyErrorCode(error),
        );
      }
    },
  });
}

async function withinBudget(options: GenerateOptions): Promise<boolean> {
  if (isBudgetDisabled()) return true;

  // Credit gate: a subscriber with a zero balance must top up before another
  // model call. Checked before anything else so an exhausted wallet never
  // burns a model request (and the deterministic fallback still answers).
  if (options.userId && !(await hasCredits(options.userId))) {
    console.warn(`[ai/generate] credits exhausted for ${options.userId}`);
    return false;
  }

  if (options.userId && !(await tryConsumeAiBudget({ userId: options.userId }))) {
    console.warn(`[ai/generate] user budget exhausted for ${options.userId}`);
    return false;
  }

  if (
    !options.userInitiated &&
    (await isGlobalAiBudgetExhausted({
      limit: DEFAULT_GLOBAL_AI_DAILY_BUDGET,
    }))
  ) {
    console.warn("[ai/generate] global budget exhausted; using heuristics");
    return false;
  }

  return true;
}

/** Retryable → advance to the next candidate. Everything else stops the chain. */
export function isRetryableModelError(error: unknown): boolean {
  const code = classifyErrorCode(error);
  return code !== "validation" && code !== "unauthorized";
}

/** A short, ledger-safe error code. Never carries provider payloads. */
export function classifyErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown";
  const candidate = error as {
    name?: unknown;
    statusCode?: unknown;
    code?: unknown;
  };

  const name = typeof candidate.name === "string" ? candidate.name : "";
  if (name === "NoObjectGeneratedError" || name === "TypeValidationError") {
    return "validation";
  }
  if (name === "AbortError" || name === "TimeoutError") return "timeout";

  const status = Number(candidate.statusCode);
  if (Number.isFinite(status)) {
    if (status === 401 || status === 403) return "unauthorized";
    if (status === 400 || status === 422) return "validation";
    if (status === 429) return "rate_limit";
    if (status >= 500) return "server_error";
  }

  const code = typeof candidate.code === "string" ? candidate.code : "";
  if (code === "ETIMEDOUT" || code === "ECONNRESET") return "timeout";
  return "unknown";
}
