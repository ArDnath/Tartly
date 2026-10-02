import { z } from "zod";

import { apiError, ok, withUser } from "@/lib/api/http";
import {
  campaignStats,
  getCampaign,
  listRecipients,
  updateCampaign,
} from "@/lib/campaigns/service";
import { isCampaignsEnabled } from "@/lib/env";

type Ctx = { params: Promise<{ id: string }> };

function serializeCampaign(campaign: NonNullable<Awaited<ReturnType<typeof getCampaign>>>) {
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    template: campaign.template,
    replyPolicy: campaign.replyPolicy,
    footerAddress: campaign.footerAddress,
    throttlePerHour: campaign.throttlePerHour,
    sendWindow: campaign.sendWindow,
    createdAt: campaign.createdAt.toISOString(),
    startedAt: campaign.startedAt?.toISOString() ?? null,
    finishedAt: campaign.finishedAt?.toISOString() ?? null,
  };
}

/** Campaign detail + recipients; PATCH to edit a draft/paused campaign. */
export const GET = withUser<Ctx>(async (userId, _request, context) => {
  const { id } = await context.params;
  const campaign = await getCampaign({ userId, campaignId: id });
  if (!campaign) return apiError("not_found", "Campaign not found", 404);

  const [stats, recipients] = await Promise.all([
    campaignStats(id),
    listRecipients({ campaignId: id, userId }),
  ]);

  return ok({
    campaign: serializeCampaign(campaign),
    stats,
    recipients: recipients.map((recipient) => ({
      id: recipient.id,
      email: recipient.email,
      name: recipient.name,
      status: recipient.status,
      attempts: recipient.attempts,
      lastError: recipient.lastError,
      sentAt: recipient.sentAt?.toISOString() ?? null,
    })),
    enabled: isCampaignsEnabled(),
  });
});

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  template: z
    .object({
      subject: z.string().max(500),
      body: z.string().min(1).max(20_000),
      inlineImageIds: z.array(z.string()).max(20).optional(),
      attachmentIds: z.array(z.string()).max(20).optional(),
    })
    .optional(),
  replyPolicy: z.enum(["off", "drafts", "autopilot"]).optional(),
  footerAddress: z.string().max(500).nullable().optional(),
  throttlePerHour: z.number().int().min(1).max(500).optional(),
});

export const PATCH = withUser<Ctx>(async (userId, request, context) => {
  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

  try {
    const campaign = await updateCampaign({ userId, campaignId: id, patch: parsed.data });
    if (!campaign) return apiError("not_found", "Campaign not found", 404);
    return ok({ campaign: serializeCampaign(campaign) });
  } catch (error) {
    return apiError(
      "conflict",
      error instanceof Error ? error.message : "Could not update.",
      409,
    );
  }
});
