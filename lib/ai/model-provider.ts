import "server-only";

import type { LanguageModel } from "ai";

import {
  modelChainForRole,
  type ModelCandidate,
} from "@/lib/ai/model-chain";
import {
  AI_BASE_URL,
  AI_CLASSIFIER_MODEL_ID,
  AI_DRAFT_MODEL_ID,
  AI_MODEL_ID,
  AI_REASONING_MODEL_ID,
  getModel,
  getModelForCandidate,
  isAiProviderConfigured,
  isProviderConfigured,
} from "@/lib/ai/provider";

/**
 * AI provider abstraction.
 *
 * The rest of the agent runtime depends on this interface, not on OpenAI (or
 * OpenCode, or any concrete gateway). Swapping providers means adding one
 * adapter and changing `AI_PROVIDER`; no tool, service or UI imports a provider
 * SDK directly.
 *
 * Model *roles* let us route cheap work (classification, search extraction) and
 * drafting to different models without the call sites knowing which model that
 * is. Each role resolves to an ordered **chain** (`AI_MODEL_<ROLE>_CHAIN`,
 * comma-separated `provider:model`) so a failing primary falls over to the next
 * candidate instead of straight to the heuristic (A1).
 */

export type ModelRole = "fast" | "standard" | "reasoning";

export interface AIModelProvider {
  /** Stable id, e.g. "opencode". */
  readonly id: string;
  isConfigured(): boolean;
  /** Ordered fallback candidates for a role. Primary first. */
  getModelChain(role: ModelRole): ModelCandidate[];
  /** Back-compat: the primary model for a role. */
  getLanguageModel(role: ModelRole): LanguageModel | null;
  /** Resolve an arbitrary chain candidate to a model. */
  getLanguageModelForCandidate(candidate: ModelCandidate): LanguageModel | null;
}

/** The single model configured for a role, used when no chain env is set. */
export function modelIdForRole(role: ModelRole): string {
  switch (role) {
    case "fast":
      return AI_CLASSIFIER_MODEL_ID;
    case "reasoning":
      return AI_REASONING_MODEL_ID;
    case "standard":
      return AI_DRAFT_MODEL_ID;
  }
}

const ROLE_CHAIN_ENV: Record<ModelRole, string | undefined> = {
  fast: process.env.AI_MODEL_FAST_CHAIN,
  standard: process.env.AI_MODEL_STANDARD_CHAIN,
  reasoning: process.env.AI_MODEL_REASONING_CHAIN,
};

export const openCodeModelProvider: AIModelProvider = {
  id: "opencode",
  isConfigured: isAiProviderConfigured,
  getModelChain(role) {
    return modelChainForRole({
      raw: ROLE_CHAIN_ENV[role],
      fallback: { providerId: "opencode", modelId: modelIdForRole(role) },
      isProviderConfigured,
    });
  },
  getLanguageModel(role) {
    return getModel(modelIdForRole(role));
  },
  getLanguageModelForCandidate(candidate) {
    return getModelForCandidate(candidate);
  },
};

/**
 * Resolve the active provider. Kept as a function (not a module-level
 * constant) so tests and future multi-provider routing can override it.
 */
export function getModelProvider(): AIModelProvider {
  return openCodeModelProvider;
}

export { AI_BASE_URL, AI_MODEL_ID };
