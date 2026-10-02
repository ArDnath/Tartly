import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import {
  campaignStats,
  getCampaign,
  listCampaignsWithStats,
} from "@/lib/campaigns/service";

import { requireReadPermission } from "./shared";

/**
 * `get_campaign_status` — READ.
 *
 * Progress of one campaign, or a list of all campaigns with counts.
 */

const inputSchema = z.object({
  campaignId: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe("A campaign id from start_campaign; omit to list all campaigns."),
});

export type GetCampaignStatusInput = z.infer<typeof inputSchema>;

export const getCampaignStatusTool: AnyToolDefinition = defineTool({
  name: "get_campaign_status",
  description:
    "Check how a bulk campaign is doing: sent, failed, replied, unsubscribed, bounced. Pass a campaignId, or omit it to list every campaign with counts.",
  risk: "READ",
  inputSchema,
  authorize(ctx) {
    requireReadPermission(ctx);
  },
  async execute(ctx, input) {
    if (input.campaignId) {
      const campaign = await getCampaign({ userId: ctx.userId, campaignId: input.campaignId });
      if (!campaign) return { found: false, notice: "No campaign with that id." };
      const stats = await campaignStats(input.campaignId);
      return {
        found: true,
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        replyPolicy: campaign.replyPolicy,
        counts: stats.byStatus,
        total: stats.total,
      };
    }

    const campaigns = await listCampaignsWithStats(ctx.userId);
    return {
      count: campaigns.length,
      campaigns: campaigns.map(({ campaign, stats, total }) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        total,
        counts: stats,
      })),
    };
  },
});
