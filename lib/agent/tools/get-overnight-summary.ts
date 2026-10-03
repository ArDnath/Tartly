import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import { getAutopilotPolicy } from "@/lib/settings/autopilot";
import { getOvernightSummary } from "@/lib/settings/autopilot-usage";

import { requireReadPermission } from "./shared";

const inputSchema = z.object({});

export type GetOvernightSummaryInput = z.infer<typeof inputSchema>;

function buildGetOvernightSummaryTool(): AnyToolDefinition {
  return defineTool({
    name: "get_overnight_summary",
    description:
      "What did 24/7 Autopilot do overnight: replies it sent on its own, drafts it prepared, and anything it held back with the reason. Use when the user asks what happened while they were away.",
    risk: "READ",
    inputSchema,
    authorize(ctx) {
      requireReadPermission(ctx);
    },
    async execute(ctx) {
      const policy = await getAutopilotPolicy(ctx.userId);
      if (!policy.enabled) {
        return {
          enabled: false,
          sent: 0,
          drafted: 0,
          blocked: 0,
          notice:
            "24/7 Autopilot is off for this mailbox, so nothing was sent automatically.",
        };
      }

      const summary = await getOvernightSummary(ctx.userId, new Date(), policy);
      return {
        enabled: true,
        windowLabel: summary.windowLabel,
        totals: summary.totals,
        sent: summary.sent,
        drafted: summary.drafted,
        blocked: summary.blocked,
      };
    },
  });
}

/** `get_overnight_summary` — READ. */
export const getOvernightSummaryTool = buildGetOvernightSummaryTool();

export type GetOvernightSummaryOutput = Awaited<
  ReturnType<typeof getOvernightSummaryTool.execute>
>;
