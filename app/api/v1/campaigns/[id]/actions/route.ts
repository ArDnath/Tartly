import { z } from "zod";

import { apiError, ok, withUser } from "@/lib/api/http";
import { checkCampaignTemplate } from "@/lib/ai/features/spam-check";
import {
  cancelCampaign,
  getCampaign,
  listRecipients,
  pauseCampaign,
  resumeCampaign,
  startCampaign,
} from "@/lib/campaigns/service";
import { renderTemplate } from "@/lib/campaigns/template";
import { isCampaignsEnabled } from "@/lib/env";
import { getMailboxForUser } from "@/lib/email-operator/mailbox";
import { sendEmail } from "@/lib/gmail/send";
import { nanoid } from "nanoid";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  action: z.enum(["check", "start", "pause", "resume", "cancel", "test"]),
  /** The review gate: `start` requires an explicit confirmation. */
  confirm: z.boolean().optional(),
});

/**
 * Campaign actions (Phase 7). `check` runs the pre-send quality gate, `start` is
 * the review gate (spam check + enqueue), `test` sends a rendered preview to the
 * user themselves, and pause/resume/cancel control a running send.
 */
export const POST = withUser<{ params: Promise<{ id: string }> }>(
  async (userId, request, context) => {
    const { id } = await context.params;
    if (!isCampaignsEnabled()) {
      return apiError("disabled", "Campaigns are disabled.", 403);
    }

    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

    const campaign = await getCampaign({ userId, campaignId: id });
    if (!campaign) return apiError("not_found", "Campaign not found", 404);

    switch (parsed.data.action) {
      case "check": {
        const check = await checkCampaignTemplate({
          userId,
          name: campaign.name,
          subject: campaign.template.subject,
          body: campaign.template.body,
        });
        return ok({ check });
      }
      case "start": {
        if (!parsed.data.confirm) {
          return apiError(
            "confirmation_required",
            "Confirm the preview before sending.",
            409,
          );
        }
        const result = await startCampaign({ userId, campaignId: id });
        if (!result.ok) {
          if (result.blocked) {
            return apiError("blocked", "The quality check blocked this send.", 422);
          }
          return apiError("conflict", result.reason, 409);
        }
        return ok({ started: true });
      }
      case "pause":
        return ok({ paused: await pauseCampaign({ userId, campaignId: id }) });
      case "resume": {
        const result = await resumeCampaign({ userId, campaignId: id });
        if (!result.ok) {
          return apiError(
            "conflict",
            result.blocked ? "Blocked by the quality check." : result.reason,
            409,
          );
        }
        return ok({ resumed: true });
      }
      case "cancel":
        return ok({ cancelled: await cancelCampaign({ userId, campaignId: id }) });
      case "test": {
        const mailbox = await getMailboxForUser(userId);
        if (!mailbox) return apiError("no_mailbox", "No connected mailbox", 409);
        const [first] = await listRecipients({ campaignId: id, userId, limit: 1 });
        const data = first
          ? { ...first.rowData, email: first.email, name: first.name ?? "" }
          : { name: "there", company: "your company" };
        const subject = renderTemplate({ template: campaign.template.subject, data });
        const body = renderTemplate({ template: campaign.template.body, data });
        const result = await sendEmail({
          userId,
          email: {
            from: mailbox.email,
            to: [mailbox.email],
            subject: subject ? `[Test] ${subject}` : "[Test] Campaign",
            text: body,
          },
          idempotencyKey: `campaign-test:${id}:${nanoid()}`,
        });
        return ok({ sent: Boolean(result.gmailMessageId), to: mailbox.email });
      }
      default:
        return apiError("bad_request", "Unknown action", 400);
    }
  },
);
