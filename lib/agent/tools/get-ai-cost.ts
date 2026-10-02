import { z } from "zod";

import {
  defineTool,
  type AnyToolDefinition,
} from "@/lib/agent/registry";
import { formatMicroUsd, getAiUsageSummary } from "@/lib/ai/usage";

import { requireReadPermission } from "./shared";

/**
 * `get_ai_cost` — READ.
 *
 * Lets the user ask "what has this cost me?" and get a real answer from the
 * usage ledger. This is a trust builder: it makes the AI's spend inspectable
 * rather than hidden. Read-only and bounded.
 */

const inputSchema = z.object({
  windowDays: z
    .number()
    .int()
    .min(1)
    .max(30)
    .optional()
    .describe("How many days back to report. Defaults to 7."),
});

export type GetAiCostInput = z.infer<typeof inputSchema>;

export const getAiCostTool: AnyToolDefinition = defineTool({
  name: "get_ai_cost",
  description:
    "Report the user's own AI usage and estimated cost over a recent window. Use it when the user asks what the assistant has cost, how many AI calls have run, or how their budget is being used. Read-only; never changes anything.",
  risk: "READ",
  inputSchema,
  authorize(ctx) {
    requireReadPermission(ctx);
  },
  async execute(ctx, input) {
    const windowDays = input.windowDays ?? 7;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const summary = await getAiUsageSummary({ userId: ctx.userId, since });

    return {
      windowDays,
      calls: summary.calls,
      failedCalls: summary.failedCalls,
      totalTokens: summary.totalTokens,
      cachedTokens: summary.cachedTokens,
      estimatedCostMicros: summary.estimatedCostMicros,
      estimatedCostLabel: formatMicroUsd(summary.estimatedCostMicros),
      byFeature: summary.byFeature.slice(0, 12).map((feature) => ({
        feature: feature.feature,
        calls: feature.calls,
        totalTokens: feature.totalTokens,
        estimatedCostLabel: formatMicroUsd(feature.estimatedCostMicros),
      })),
      notice:
        "Costs are an estimate from token counts, not a provider invoice.",
    };
  },
});
