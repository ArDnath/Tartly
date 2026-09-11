import "server-only";

import { generateObject } from "ai";
import type { ZodType } from "zod";

import { isBudgetDisabled, tryConsumeAiBudget } from "@/lib/ai/budget";
import { getModel } from "@/lib/ai/provider";

/**
 * Structured generation with a graceful offline path.
 *
 * Returns `null` when no provider is configured (or the model call fails), so
 * every step that uses it must have a deterministic heuristic fallback. That is
 * what keeps the whole pipeline runnable without an AI key.
 */
export async function generateStructured<T>({
  schema,
  system,
  prompt,
  modelId,
  userId,
}: {
  schema: ZodType<T>;
  system: string;
  prompt: string;
  modelId?: string;
  /** When set, each call consumes one unit of the user's daily AI budget. */
  userId?: string;
}): Promise<T | null> {
  const model = getModel(modelId);
  if (!model) return null;

  if (userId && !isBudgetDisabled()) {
    const allowed = await tryConsumeAiBudget({ userId });
    if (!allowed) {
      console.warn(`[ai/structured] daily budget exhausted for ${userId}`);
      return null;
    }
  }

  try {
    const { object } = await generateObject({ model, schema, system, prompt });
    return object as T;
  } catch (error) {
    console.error("[ai/structured] generation failed", error);
    return null;
  }
}
