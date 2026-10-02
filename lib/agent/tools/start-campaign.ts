import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import { createCampaign } from "@/lib/campaigns/service";
import { isCampaignsEnabled } from "@/lib/env";
import { AuthorizationError } from "@/lib/agent/errors";

import { requireWritePermission } from "./shared";

/**
 * `start_campaign` — WRITE.
 *
 * Creates a **draft** campaign from a template and recipients. It never sends:
 * the user reviews the preview and starts it in `/campaigns`. This is the safe
 * half of the feature the model is allowed to touch.
 */

const inputSchema = z.object({
  name: z.string().min(1).max(200).describe("A label for the campaign."),
  subject: z.string().max(500).describe("The subject line; may contain {{merge}} fields."),
  body: z
    .string()
    .min(1)
    .max(10_000)
    .describe("The message body; may contain {{merge}} fields and {{AI: …}} blocks."),
  recipients: z
    .array(
      z.object({
        email: z.string().min(3).max(320),
        name: z.string().max(200).optional(),
      }),
    )
    .min(1)
    .max(500)
    .describe("Recipients. Never invent addresses; use ones the user provided."),
  replyPolicy: z.enum(["off", "drafts", "autopilot"]).optional(),
});

export type StartCampaignInput = z.infer<typeof inputSchema>;

export const startCampaignTool: AnyToolDefinition = defineTool({
  name: "start_campaign",
  description:
    "Create a DRAFT bulk-email campaign. This never sends anything: the user reviews the preview and starts it in the Campaigns page. Use it when the user asks to email many people. Never invent recipient addresses.",
  risk: "WRITE",
  inputSchema,
  authorize(ctx) {
    requireWritePermission(ctx);
    if (!isCampaignsEnabled()) {
      throw new AuthorizationError("Campaigns are disabled.");
    }
  },
  async execute(ctx, input) {
    const { campaignId, summary } = await createCampaign({
      userId: ctx.userId,
      name: input.name,
      template: { subject: input.subject, body: input.body },
      recipients: input.recipients.map((recipient) => ({
        email: recipient.email,
        name: recipient.name ?? null,
        rowData: (recipient.name
          ? { name: recipient.name }
          : {}) as Record<string, string>,
      })),
      replyPolicy: input.replyPolicy ?? "drafts",
    });

    return {
      created: true,
      campaignId,
      summary,
      notice:
        "Draft created. Nothing has been sent — open Campaigns to preview, run the quality check, and start it.",
    };
  },
});
