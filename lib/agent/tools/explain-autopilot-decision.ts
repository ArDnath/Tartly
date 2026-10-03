import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import { autopilotRepository } from "@/lib/repositories/autopilot";
import { autopilotReasonLabel } from "@/lib/settings/autopilot";

import { requireReadPermission } from "./shared";

const inputSchema = z.object({
  threadId: z
    .string()
    .min(1)
    .max(256)
    .describe("The thread to explain, from search_emails or get_thread."),
});

export type ExplainAutopilotDecisionInput = z.infer<typeof inputSchema>;

function buildExplainAutopilotDecisionTool(): AnyToolDefinition {
  return defineTool({
    name: "explain_autopilot_decision",
    description:
      "Explain why 24/7 Autopilot sent or held a reply on a specific thread: the decision, the human-readable reason, the category, confidence and the check results. Use when the user asks 'why did it send that?' or 'why is this a draft?'.",
    risk: "READ",
    inputSchema,
    authorize(ctx) {
      requireReadPermission(ctx);
    },
    async execute(ctx, input) {
      const decision = await autopilotRepository.findLatestDecisionForThread(
        ctx.userId,
        input.threadId,
      );
      if (!decision) {
        return {
          found: false,
          notice:
            "No autopilot decision has been recorded for that thread yet.",
        };
      }
      return {
        found: true,
        decision: decision.decision,
        reason: decision.reason,
        reasonLabel: autopilotReasonLabel(decision.reason),
        category: decision.category,
        confidence: decision.confidence,
        checks: decision.checks,
        at: decision.createdAt.toISOString(),
      };
    },
  });
}

/** `explain_autopilot_decision` — READ. */
export const explainAutopilotDecisionTool =
  buildExplainAutopilotDecisionTool();

export type ExplainAutopilotDecisionOutput = Awaited<
  ReturnType<typeof explainAutopilotDecisionTool.execute>
>;
