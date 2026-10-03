import "server-only";

import { z } from "zod";

import {
  TRIAGE_PIPELINE_VERSION,
  classifyThreadsBatch,
  heuristicTriage,
  triageResultSchema,
  type TriageResult,
} from "@/lib/ai/features/triage";
import { deriveReplyStatus } from "@/lib/ai/features/thread-status";
import { defineStep } from "@/lib/engine/step";
import { isReplyStatusEnabled } from "@/lib/env";
import { loadThreadContext } from "@/lib/email-operator/thread-context";
import { engineThreadStateRepository } from "@/lib/repositories/engine-thread-states";
import { requireThreadId } from "./helpers";

// Re-exported so existing callers/tests keep working; the implementation now
// lives in `lib/ai/features/triage.ts` (shared with the batched inbox pass).
export {
  TRIAGE_CATEGORIES,
  heuristicTriage,
  triageResultSchema,
  type TriageAction,
  type TriageCategory,
  type TriageResult,
} from "@/lib/ai/features/triage";

/** A precomputed verdict passed through the run trigger by the inbox batch pass. */
type PrecomputedTriage = {
  category: TriageResult["category"];
  priority: number;
  action: TriageResult["action"];
  reason?: string;
};

function readPrecomputedTriage(
  state: Record<string, unknown>,
): PrecomputedTriage | null {
  const trigger = state.trigger as { triage?: unknown } | undefined;
  const parsed = triageResultSchema.safeParse(trigger?.triage);
  return parsed.success ? parsed.data : null;
}

export const triageStep = defineStep({
  type: "triage",
  configSchema: z.object({
    maxBodyChars: z.number().int().positive().max(20_000).optional(),
  }),
  async run(ctx) {
    const threadId = requireThreadId(ctx);
    const context = await loadThreadContext({
      userId: ctx.userId,
      threadId,
      historyLimit: 4,
    });

    const subject = context?.thread.subject ?? null;
    const body = (
      context?.latestInbound?.bodyText ??
      context?.latestInbound?.snippet ??
      ""
    ).slice(0, ctx.input.maxBodyChars ?? 6_000);
    const lastDirection = context?.history.at(-1)?.direction ?? null;

    // Prefer a verdict the inbox batch pass already produced (one model call for
    // several threads); otherwise classify this thread on its own.
    const precomputed = readPrecomputedTriage(ctx.state);
    let result: TriageResult;
    if (precomputed) {
      result = precomputed;
    } else {
      const [classified] = await classifyThreadsBatch({
        userId: ctx.userId,
        threads: [{ threadId, subject, body, lastDirection }],
        ...(ctx.input.maxBodyChars ? { maxBodyChars: ctx.input.maxBodyChars } : {}),
      });
      result = classified ?? heuristicTriage({ subject, body, lastDirection });
    }

    // Reply Zero (Phase 4) is a kill-switchable capability: when disabled we
    // ignore the model's verdict and keep the deterministic direction signal.
    const replyStatus = isReplyStatusEnabled()
      ? result.replyStatus ?? deriveReplyStatus({ lastDirection, subject, body })
      : deriveReplyStatus({ lastDirection, subject, body });

    await engineThreadStateRepository.upsert({
      values: {
        threadId,
        category: result.category,
        priority: result.priority,
        action: result.action,
        reason: result.reason ?? null,
        triageVersion: TRIAGE_PIPELINE_VERSION,
        replyStatus,
      },
      set: {
        category: result.category,
        priority: result.priority,
        action: result.action,
        reason: result.reason ?? null,
        triageVersion: TRIAGE_PIPELINE_VERSION,
        replyStatus,
        updatedAt: new Date(),
      },
    });

    ctx.log("triage", { ...result, replyStatus });
    return { ...result, replyStatus };
  },
});
