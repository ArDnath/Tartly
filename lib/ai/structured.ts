import "server-only";

import type { ZodType } from "zod";

import { generateObject } from "@/lib/ai/generate";
import {
  AI_CLASSIFIER_MODEL_ID,
  AI_DRAFT_MODEL_ID,
  AI_REASONING_MODEL_ID,
} from "@/lib/ai/provider";
import type { ModelRole } from "@/lib/ai/model-provider";

/**
 * @deprecated Structured generation with a null fallback.
 *
 * Kept for back-compat only. New code should call `generateObject` from
 * `lib/ai/generate.ts` with an explicit `role`, `feature` and `hardening`
 * level. This shim infers the role from a legacy `modelId` and labels the
 * ledger entry "structured".
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
  return generateObject({
    schema,
    role: roleForModelId(modelId),
    feature: "structured",
    ...(userId ? { userId } : {}),
    system,
    prompt,
  });
}

function roleForModelId(modelId: string | undefined): ModelRole {
  if (!modelId) return "standard";
  if (modelId === AI_CLASSIFIER_MODEL_ID) return "fast";
  if (modelId === AI_REASONING_MODEL_ID) return "reasoning";
  if (modelId === AI_DRAFT_MODEL_ID) return "standard";
  return "standard";
}
