import "server-only";

import { resolveOutboundAssets } from "@/lib/assets/outbound";
import { personalizeRecipients } from "@/lib/ai/features/campaign-personalize";
import { renderTemplate } from "@/lib/campaigns/template";
import {
  campaignSendAllowance,
  claimRecipientBatch,
  countPending,
  finishCampaignIfDone,
  getCampaign,
  isSuppressed,
  markRecipientFailed,
  markRecipientSent,
  markRecipientSkipped,
  recordCampaignEvent,
} from "@/lib/campaigns/service";
import { pool } from "@/lib/db";
import { campaignBatchSize, isCampaignsEnabled } from "@/lib/env";
import { sendEmail } from "@/lib/gmail/send";
import { JOB_KIND_BULK_SEND } from "@/lib/email-operator/job-kinds";
import type { JobHandler } from "@/lib/email-operator/jobs";
import { enqueueJob, type JobRow } from "@/lib/queue/queue";
import { mailboxRepository } from "@/lib/repositories/mailboxes";

/**
 * `bulk_send` handler (Phase 7).
 *
 * Sends a bounded batch of a campaign, then re-enqueues itself with a delay so
 * sending stays within the campaign's hourly throttle and the platform ceilings.
 * Resumable and pause-aware: it re-reads the campaign status before every send,
 * refuses to double-send (per-recipient idempotency key + the send ledger), and
 * re-checks the suppression list at send time.
 */

const UNSUBSCRIBE_NOTE =
  "You received this email because you were contacted directly. Reply with \"unsubscribe\" to stop receiving messages.";

function footer(text: string, physicalAddress: string | null): string {
  const lines = [text, "", "---", UNSUBSCRIBE_NOTE];
  if (physicalAddress?.trim()) lines.push(physicalAddress.trim());
  return lines.join("\n");
}

async function handleBulkSend(job: JobRow): Promise<void> {
  if (!isCampaignsEnabled()) return;
  const campaignId =
    typeof job.payload.campaignId === "string" ? job.payload.campaignId : null;
  if (!campaignId) return;

  const campaign = await getCampaign({ userId: job.userId, campaignId });
  if (!campaign || campaign.status !== "sending") return;

  const allowance = await campaignSendAllowance({ userId: job.userId, campaign });
  if (allowance.allowed <= 0) {
    await reenqueue(job.userId, campaignId, 60 * 60 * 1000);
    return;
  }

  const recipients = await claimRecipientBatch({
    campaignId,
    limit: Math.min(campaignBatchSize(), allowance.allowed),
  });
  if (recipients.length === 0) {
    await finishCampaignIfDone(campaignId);
    return;
  }

  const fromEmail = await mailboxRepository.findFirstEmailForUser(job.userId);
  if (!fromEmail) {
    await finishCampaignIfDone(campaignId);
    return;
  }

  const template = campaign.template;
  const assets =
    template.inlineImageIds?.length || template.attachmentIds?.length
      ? await resolveOutboundAssets({
          userId: job.userId,
          inlineImageIds: template.inlineImageIds ?? [],
          attachmentIds: template.attachmentIds ?? [],
        })
      : null;

  const personalized = await personalizeRecipients({
    userId: job.userId,
    template: template.body,
    recipients: recipients.map((recipient) => ({
      recipientId: recipient.id,
      data: {
        ...recipient.rowData,
        email: recipient.email,
        name: recipient.name ?? "",
      },
    })),
  });
  const bodyById = new Map(personalized.map((entry) => [entry.recipientId, entry.body]));

  for (const recipient of recipients) {
    // Re-check the campaign before each send so pause/cancel takes effect fast.
    const current = await getCampaign({ userId: job.userId, campaignId });
    if (!current || current.status !== "sending") return;

    if (await isSuppressed({ userId: job.userId, email: recipient.email })) {
      await markRecipientSkipped(recipient.id);
      await recordCampaignEvent({
        userId: job.userId,
        campaignId,
        recipientId: recipient.id,
        type: "skipped_suppressed",
      });
      continue;
    }

    const data = {
      ...recipient.rowData,
      email: recipient.email,
      name: recipient.name ?? "",
    };
    const subject = renderTemplate({ template: template.subject, data }) || campaign.name;
    const body = footer(bodyById.get(recipient.id) ?? "", campaign.footerAddress);

    try {
      const result = await sendEmail({
        userId: job.userId,
        email: {
          from: fromEmail,
          to: [recipient.email],
          subject,
          text: body,
          ...(assets?.inlineImages.length || assets?.attachments.length
            ? {
                ...(assets.inlineImages.length ? { inlineImages: assets.inlineImages } : {}),
                ...(assets.attachments.length ? { attachments: assets.attachments } : {}),
                html: `${body.replace(/\n/g, "<br>")}${assets.htmlImages}`,
              }
            : {}),
          headers: {
            "List-Unsubscribe": `<mailto:${fromEmail}?subject=unsubscribe>`,
          },
        },
        idempotencyKey: `campaign:${campaignId}:${recipient.id}`,
      });

      await markRecipientSent({
        recipientId: recipient.id,
        gmailMessageId: result.gmailMessageId,
        threadId: result.gmailThreadId,
        personalizedBody: body,
      });
      await recordCampaignEvent({
        userId: job.userId,
        campaignId,
        recipientId: recipient.id,
        type: "sent",
        payload: { deduped: result.deduped },
      });
    } catch (error) {
      await markRecipientFailed({
        recipientId: recipient.id,
        error: error instanceof Error ? error.message : "send failed",
      });
      await recordCampaignEvent({
        userId: job.userId,
        campaignId,
        recipientId: recipient.id,
        type: "failed",
      });
    }
  }

  const remaining = await countPending(campaignId);
  if (remaining > 0) {
    // Space the next batch at the campaign's hourly rate (min 60s).
    const delay = Math.max(
      60_000,
      Math.ceil(3_600_000 / Math.max(1, campaign.throttlePerHour)) * recipients.length,
    );
    await reenqueue(job.userId, campaignId, delay);
  } else {
    await finishCampaignIfDone(campaignId);
  }
}

async function reenqueue(
  userId: string,
  campaignId: string,
  delayMs: number,
): Promise<void> {
  await enqueueJob(pool, userId, {
    kind: JOB_KIND_BULK_SEND,
    laneKey: `campaign:${campaignId}`,
    payload: { campaignId },
    runAfter: new Date(Date.now() + delayMs),
  });
}

export const bulkSendHandler: { kind: string; handler: JobHandler } = {
  kind: JOB_KIND_BULK_SEND,
  handler: handleBulkSend,
};

/** Test seam: assert the campaign status guard without queueing. */
export async function assertCampaignSending(
  userId: string,
  campaignId: string,
): Promise<boolean> {
  const campaign = await getCampaign({ userId, campaignId });
  return Boolean(campaign && campaign.status === "sending");
}
