import "server-only";

import type { LanguageModel } from "ai";

import {
  AI_BASE_URL,
  AI_CLASSIFIER_MODEL_ID,
  AI_DRAFT_MODEL_ID,
  AI_MODEL_ID,
  getModel,
  isAiProviderConfigured,
} from "@/lib/ai/provider";

/**
 * AI provider abstraction.
 *
 * The rest of the agent runtime depends on this interface, not on OpenAI (or
 * OpenCode, or any concrete gateway). Swapping providers means adding one
 * adapter and changing `AI_PROVIDER`; no tool, service or UI imports a provider
 * SDK directly.
 *
 * Today the only adapter is the OpenAI-compatible OpenCode gateway that also
 * powers the existing assistant endpoints. Model *roles* let us route cheap
 * work (classification, search extraction) and drafting to different models
 * without the call sites knowing which model that is.
 */

export type ModelRole = "fast" | "standard" | "reasoning";

export interface AIModelProvider {
  /** Stable id, e.g. "opencode". */
  readonly id: string;
  isConfigured(): boolean;
  getLanguageModel(role: ModelRole): LanguageModel | null;
}

const REASONING_MODEL_ID = process.env.AI_MODEL_REASONING_ID ?? AI_MODEL_ID;

function modelIdForRole(role: ModelRole): string {
  switch (role) {
    case "fast":
      return AI_CLASSIFIER_MODEL_ID;
    case "reasoning":
      return REASONING_MODEL_ID;
    case "standard":
      return AI_DRAFT_MODEL_ID;
  }
}

export const openCodeModelProvider: AIModelProvider = {
  id: "opencode",
  isConfigured: isAiProviderConfigured,
  getLanguageModel(role) {
    return getModel(modelIdForRole(role));
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
