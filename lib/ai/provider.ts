import "server-only";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

import type { ModelCandidate } from "@/lib/ai/model-chain";

/**
 * Model resolution.
 *
 * Models are served by the OpenCode gateway, which speaks the OpenAI Chat
 * Completions API. If a key is configured we stream from a real model.
 * Otherwise we fall back to a deterministic, locally-generated reply so the
 * whole flow (SSE streaming, persistence, UI) still works out of the box.
 *
 * Two backends work with the same key:
 *  - `https://opencode.ai/zen/v1`     pay-as-you-go / free models (`*-free`)
 *  - `https://opencode.ai/zen/go/v1`  OpenCode Go subscription models
 * Go additionally requires a stable `x-opencode-session` header.
 *
 * A second OpenAI-compatible gateway can be configured with
 * `AI_PROVIDER_FALLBACK_*` and referenced from a model chain as
 * `<AI_PROVIDER_FALLBACK_ID ?? "fallback">:<model>`.
 */

/** OpenAI-compatible base URL. Override for a different gateway/provider. */
export const AI_BASE_URL =
  process.env.AI_BASE_URL ?? "https://opencode.ai/zen/v1";

export const AI_MODEL_ID = process.env.AI_MODEL_ID ?? "space-bunny-free";

/** Cheap model for triage/classification (falls back to AI_MODEL_ID). */
export const AI_CLASSIFIER_MODEL_ID =
  process.env.AI_MODEL_CLASSIFIER_ID ?? AI_MODEL_ID;

/** Model used for drafting replies (falls back to AI_MODEL_ID). */
export const AI_DRAFT_MODEL_ID =
  process.env.AI_MODEL_DRAFT_ID ?? AI_MODEL_ID;

/** Stronger model for multi-step reasoning; falls back to AI_MODEL_ID. */
export const AI_REASONING_MODEL_ID =
  process.env.AI_MODEL_REASONING_ID ?? AI_MODEL_ID;

/** Free models are billed at $0 but are called the same way. */
const FREE_MODELS = new Set(["big-pickle"]);

export function isFreeModel(modelId: string): boolean {
  return FREE_MODELS.has(modelId) || modelId.endsWith("-free");
}

/** The primary provider id used in model chains. */
export const PRIMARY_PROVIDER_ID = "opencode";

/** The configurable secondary gateway id. */
export const FALLBACK_PROVIDER_ID =
  process.env.AI_PROVIDER_FALLBACK_ID ?? "fallback";

/**
 * Whether the provider accepts a `response_format` JSON schema. Most models on
 * the gateway do; the free stealth models do not. When disabled, structured
 * calls fail over to the deterministic heuristics.
 */
function supportsStructuredOutputs(): boolean {
  return process.env.AI_STRUCTURED_OUTPUTS !== "false";
}

function createOpenCodeProvider() {
  const sessionId = process.env.OPENCODE_SESSION_ID;
  const headers: Record<string, string> = {
    "User-Agent": "app-server/1.0",
  };
  if (sessionId) {
    headers["x-opencode-session"] = sessionId;
  }

  return createOpenAICompatible({
    name: PRIMARY_PROVIDER_ID,
    baseURL: AI_BASE_URL,
    apiKey: process.env.OPENCODE_API_KEY,
    headers,
    supportsStructuredOutputs: supportsStructuredOutputs(),
  });
}

function createFallbackProvider() {
  const baseURL = process.env.AI_PROVIDER_FALLBACK_BASE_URL;
  const apiKey = process.env.AI_PROVIDER_FALLBACK_API_KEY;
  if (!baseURL) return null;
  return createOpenAICompatible({
    name: FALLBACK_PROVIDER_ID,
    baseURL,
    apiKey,
    supportsStructuredOutputs: supportsStructuredOutputs(),
  });
}

/** Whether a provider id is usable (has credentials/base URL). */
export function isProviderConfigured(providerId: string): boolean {
  if (providerId === PRIMARY_PROVIDER_ID) {
    return Boolean(process.env.OPENCODE_API_KEY);
  }
  if (providerId === FALLBACK_PROVIDER_ID) {
    return Boolean(process.env.AI_PROVIDER_FALLBACK_BASE_URL);
  }
  return false;
}

function resolveModelForProvider(
  providerId: string,
  modelId: string,
): LanguageModel | null {
  if (!isProviderConfigured(providerId)) return null;
  try {
    if (providerId === PRIMARY_PROVIDER_ID) {
      return createOpenCodeProvider()(modelId);
    }
    if (providerId === FALLBACK_PROVIDER_ID) {
      return createFallbackProvider()?.(modelId) ?? null;
    }
    return null;
  } catch (error) {
    console.error(`[ai] failed to resolve model ${providerId}:${modelId}`, error);
    return null;
  }
}

/** Every provider id this deployment can serve. */
export function getConfiguredProviderIds(): string[] {
  const ids = [PRIMARY_PROVIDER_ID];
  if (isProviderConfigured(FALLBACK_PROVIDER_ID)) ids.push(FALLBACK_PROVIDER_ID);
  return ids;
}

export function getChatModel(): LanguageModel | null {
  return getModel(AI_MODEL_ID);
}

export function getModel(modelId: string = AI_MODEL_ID): LanguageModel | null {
  return resolveModelForProvider(PRIMARY_PROVIDER_ID, modelId);
}

/** Resolve a chain candidate (`provider:model` pair) to a model. */
export function getModelForCandidate(
  candidate: ModelCandidate,
): LanguageModel | null {
  return resolveModelForProvider(candidate.providerId, candidate.modelId);
}

export function isAiProviderConfigured(): boolean {
  return getConfiguredProviderIds().length > 0;
}
