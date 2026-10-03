import "server-only";

import { nanoid } from "nanoid";

import { checkCampaignTemplate, type SpamCheckResult } from "@/lib/ai/features/spam-check";
import {
  buildOutOfOfficeAck,
  canAutoRespond,
  classifyCampaignReply,
  impliesCommitment,
  type CampaignReplyClass,
} from "@/lib/ai/features/campaign-reply";
import { pool } from "@/lib/db";
import {
  type CampaignRecipientStatus,
  type CampaignSendWindow,
  type CampaignStatus,
  type CampaignTemplate,
} from "@/lib/db/schema";
import {
  campaignBatchSize,
  campaignMaxPerDay,
  campaignMaxPerHour,
  isCampaignsEnabled,
} from "@/lib/env";
import { sendEmail } from "@/lib/gmail/send";
import { JOB_KIND_BULK_SEND } from "@/lib/email-operator/job-kinds";
import { reactivityOnInbound } from "@/lib/followup/service";
import { enqueueJob } from "@/lib/queue/queue";
import {
  campaignRepository,
  type Campaign,
  type CampaignRecipient,
} from "@/lib/repositories/campaigns";
import { contactRepository } from "@/lib/repositories/contacts";
import { draftRepository } from "@/lib/repositories/drafts";
import { mailboxRepository } from "@/lib/repositories/mailboxes";
import { threadRepository } from "@/lib/repositories/threads";

/**
 * Bulk campaign service (Phase 7).
 *
 * Owns the campaign lifecycle: import → draft → review gate → throttled batch
 * send → pause/resume/cancel → reply automation. Sending itself lives in the
 * `bulk_send` job handler; this module provides the claim/mark primitives and
 * the guardrails (suppression, throttle, review gate) they depend on.
 */

export type CampaignRow = Campaign;
export type RecipientRow = CampaignRecipient;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const NO_REPLY_PATTERN = /^(no-?reply|do-?not-?reply|donotreply|bounce|postmaster|mailer-daemon)@/i;

export type RecipientInput = {
  email: string;
  name?: string | null;
  rowData: Record<string, string>;
};

export type ImportSummary = {
  imported: number;
  invalid: number;
  duplicate: number;
  suppressed: number;
  existing: number;
};

/* -------------------------------------------------------------------------- */
/*  Suppression                                                                */
/* -------------------------------------------------------------------------- */

export async function isSuppressed({
  userId,
  email,
}: {
  userId: string;
  email: string;
}): Promise<boolean> {
  return campaignRepository.isSuppressed(userId, email);
}

export async function addSuppression({
  userId,
  email,
  reason,
}: {
  userId: string;
  email: string;
  reason: string;
}): Promise<void> {
  await campaignRepository.addSuppression({
    id: nanoid(),
    userId,
    email,
    reason,
  });
}

export async function listSuppression(userId: string) {
  return campaignRepository.listSuppression(userId, 500);
}

/* -------------------------------------------------------------------------- */
/*  Campaign lifecycle                                                         */
/* -------------------------------------------------------------------------- */

export async function createCampaign({
  userId,
  name,
  template,
  recipients,
  senderName = null,
  replyTo = null,
  replyPolicy = "drafts",
  footerAddress = null,
  throttlePerHour = campaignMaxPerHour(),
  sendWindow = null,
}: {
  userId: string;
  name: string;
  template: CampaignTemplate;
  recipients: RecipientInput[];
  senderName?: string | null;
  replyTo?: string | null;
  replyPolicy?: string;
  footerAddress?: string | null;
  throttlePerHour?: number;
  sendWindow?: CampaignSendWindow | null;
}): Promise<{ campaignId: string; summary: ImportSummary }> {
  const campaignId = nanoid();
  await campaignRepository.insertCampaign({
    id: campaignId,
    userId,
    name: name.slice(0, 200) || "Untitled campaign",
    status: "draft",
    template,
    senderName,
    replyTo,
    replyPolicy: replyPolicy === "off" || replyPolicy === "autopilot" ? replyPolicy : "drafts",
    footerAddress,
    throttlePerHour: Math.max(1, Math.min(throttlePerHour, campaignMaxPerHour())),
    sendWindow,
  });

  const summary = await importRecipients({ userId, campaignId, recipients });
  await recordCampaignEvent({ userId, campaignId, type: "created", payload: summary });
  return { campaignId, summary };
}

/** Validate, dedupe, suppress-filter and insert recipients. */
export async function importRecipients({
  userId,
  campaignId,
  recipients,
}: {
  userId: string;
  campaignId: string;
  recipients: RecipientInput[];
}): Promise<ImportSummary> {
  const summary: ImportSummary = {
    imported: 0,
    invalid: 0,
    duplicate: 0,
    suppressed: 0,
    existing: 0,
  };

  const seen = new Set<string>();
  const candidates: RecipientInput[] = [];
  for (const recipient of recipients) {
    const email = recipient.email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email) || NO_REPLY_PATTERN.test(email)) {
      summary.invalid += 1;
      continue;
    }
    if (seen.has(email)) {
      summary.duplicate += 1;
      continue;
    }
    seen.add(email);
    candidates.push({ email, name: recipient.name ?? null, rowData: recipient.rowData });
  }

  if (candidates.length === 0) return summary;
  const emails = candidates.map((candidate) => candidate.email);

  const [suppressedEmails, contactRows] = await Promise.all([
    campaignRepository.listSuppressedEmails(userId, emails),
    contactRepository.listNamesByEmails(userId, emails),
  ]);
  const suppressed = new Set(suppressedEmails);
  const existing = new Set(contactRows.map((row) => row.email));

  for (const candidate of candidates) {
    if (suppressed.has(candidate.email)) {
      summary.suppressed += 1;
      continue;
    }
    if (existing.has(candidate.email)) {
      summary.existing += 1;
      continue;
    }
    const inserted = await campaignRepository.insertRecipient({
      id: nanoid(),
      campaignId,
      userId,
      email: candidate.email,
      name: candidate.name ?? null,
      rowData: candidate.rowData,
      status: "pending",
    });
    if (inserted) summary.imported += 1;
    else summary.duplicate += 1;
  }

  return summary;
}

export async function getCampaign({
  userId,
  campaignId,
}: {
  userId: string;
  campaignId: string;
}): Promise<CampaignRow | null> {
  return (
    (await campaignRepository.findCampaignByIdForUser(userId, campaignId)) ??
    null
  );
}

export async function listCampaigns(userId: string) {
  return campaignRepository.listCampaignsForUser(userId, 100);
}

export async function updateCampaign({
  userId,
  campaignId,
  patch,
}: {
  userId: string;
  campaignId: string;
  patch: Partial<{
    name: string;
    template: CampaignTemplate;
    senderName: string | null;
    replyTo: string | null;
    replyPolicy: string;
    footerAddress: string | null;
    throttlePerHour: number;
    sendWindow: CampaignSendWindow | null;
  }>;
}): Promise<CampaignRow | null> {
  const campaign = await getCampaign({ userId, campaignId });
  if (!campaign) return null;
  if (!["draft", "paused"].includes(campaign.status)) {
    throw new Error("This campaign is already sending; pause it before editing.");
  }

  const updated = await campaignRepository.updateCampaignById(campaignId, {
    ...(patch.name !== undefined ? { name: patch.name.slice(0, 200) } : {}),
    ...(patch.template !== undefined ? { template: patch.template } : {}),
    ...(patch.senderName !== undefined ? { senderName: patch.senderName } : {}),
    ...(patch.replyTo !== undefined ? { replyTo: patch.replyTo } : {}),
    ...(patch.replyPolicy !== undefined
      ? {
          replyPolicy:
            patch.replyPolicy === "off" || patch.replyPolicy === "autopilot"
              ? patch.replyPolicy
              : "drafts",
        }
      : {}),
    ...(patch.footerAddress !== undefined
      ? { footerAddress: patch.footerAddress }
      : {}),
    ...(patch.throttlePerHour !== undefined
      ? {
          throttlePerHour: Math.max(
            1,
            Math.min(patch.throttlePerHour, campaignMaxPerHour()),
          ),
        }
      : {}),
    ...(patch.sendWindow !== undefined ? { sendWindow: patch.sendWindow } : {}),
    updatedAt: new Date(),
  });
  return updated;
}

export type CampaignStats = {
  total: number;
  byStatus: Record<CampaignRecipientStatus, number>;
};

export async function campaignStats(campaignId: string): Promise<CampaignStats> {
  const rows = await campaignRepository.countByStatus(campaignId);

  const byStatus: Record<CampaignRecipientStatus, number> = {
    pending: 0,
    sending: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    replied: 0,
    unsubscribed: 0,
    bounced: 0,
  };
  let total = 0;
  for (const row of rows) {
    byStatus[row.status] = row.n;
    total += row.n;
  }
  return { total, byStatus };
}

export async function listRecipients({
  campaignId,
  userId,
  limit = 200,
}: {
  campaignId: string;
  userId: string;
  limit?: number;
}): Promise<RecipientRow[]> {
  return campaignRepository.listRecipients({
    campaignId,
    userId,
    limit: Math.min(limit, 500),
  });
}

export async function recordCampaignEvent({
  userId,
  campaignId,
  type,
  recipientId = null,
  payload = {},
}: {
  userId: string;
  campaignId: string;
  type: string;
  recipientId?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    await campaignRepository.insertEvent({
      id: nanoid(),
      userId,
      campaignId,
      recipientId,
      type,
      payload,
    });
  } catch (error) {
    console.warn("[campaigns] failed to record event", error);
  }
}

/* -------------------------------------------------------------------------- */
/*  Review gate + sending                                                      */
/* -------------------------------------------------------------------------- */

export type StartCampaignResult =
  | { ok: true }
  | { ok: false; blocked: true; check: SpamCheckResult }
  | { ok: false; blocked: false; reason: string };

/** The review gate: spam-check then start sending. Nothing sends before this. */
export async function startCampaign({
  userId,
  campaignId,
  skipQualityCheck = false,
}: {
  userId: string;
  campaignId: string;
  skipQualityCheck?: boolean;
}): Promise<StartCampaignResult> {
  if (!isCampaignsEnabled()) {
    return { ok: false, blocked: false, reason: "Campaigns are disabled." };
  }
  const campaign = await getCampaign({ userId, campaignId });
  if (!campaign) return { ok: false, blocked: false, reason: "Campaign not found." };
  if (!["draft", "paused"].includes(campaign.status)) {
    return { ok: false, blocked: false, reason: "This campaign is already running." };
  }

  if (!skipQualityCheck) {
    const check = await checkCampaignTemplate({
      userId,
      name: campaign.name,
      subject: campaign.template.subject,
      body: campaign.template.body,
    });
    if (check.blocked) return { ok: false, blocked: true, check };
  }

  // Recover any rows a crashed previous run left in `sending`.
  await resetStaleClaims({ campaignId });

  const pendingCount = await campaignRepository.countRecipientsByStatuses(
    campaignId,
    ["pending", "failed"],
  );
  if (pendingCount === 0) {
    return { ok: false, blocked: false, reason: "There are no pending recipients." };
  }

  await campaignRepository.updateCampaignById(campaignId, {
    status: "sending",
    startedAt: campaign.startedAt ?? new Date(),
    updatedAt: new Date(),
  });

  await recordCampaignEvent({ userId, campaignId, type: "started" });
  await enqueueJob(pool, userId, {
    kind: JOB_KIND_BULK_SEND,
    laneKey: `campaign:${campaignId}`,
    payload: { campaignId },
    sourceEventId: `campaign:${campaignId}:${Date.now()}`,
  });

  return { ok: true };
}

export async function pauseCampaign({
  userId,
  campaignId,
}: {
  userId: string;
  campaignId: string;
}): Promise<boolean> {
  const paused = await campaignRepository.pauseSendingOwned({
    userId,
    campaignId,
    now: new Date(),
  });
  if (paused) {
    await recordCampaignEvent({ userId, campaignId, type: "paused" });
  }
  return paused;
}

export async function resumeCampaign({
  userId,
  campaignId,
}: {
  userId: string;
  campaignId: string;
}): Promise<StartCampaignResult> {
  const campaign = await getCampaign({ userId, campaignId });
  if (!campaign || campaign.status !== "paused") {
    return { ok: false, blocked: false, reason: "Campaign is not paused." };
  }
  // A pause can land mid-batch; return any in-flight rows to pending.
  await campaignRepository.resetSendingToPending(campaignId);
  return startCampaign({ userId, campaignId, skipQualityCheck: true });
}

/** Cancel: stop sending and skip every pending recipient. */
export async function cancelCampaign({
  userId,
  campaignId,
}: {
  userId: string;
  campaignId: string;
}): Promise<boolean> {
  const campaign = await getCampaign({ userId, campaignId });
  if (!campaign || campaign.status === "done" || campaign.status === "cancelled") {
    return false;
  }
  await campaignRepository.updateCampaignById(campaignId, {
    status: "cancelled",
    finishedAt: new Date(),
    updatedAt: new Date(),
  });
  await campaignRepository.skipUnfinished(campaignId);
  await recordCampaignEvent({ userId, campaignId, type: "cancelled" });
  return true;
}

/**
 * Remaining send allowance for a campaign right now, respecting both the
 * campaign throttle and the platform per-hour/per-day ceilings.
 */
export async function campaignSendAllowance({
  userId,
  campaign,
  now = new Date(),
}: {
  userId: string;
  campaign: CampaignRow;
  now?: Date;
}): Promise<{ allowed: number; reason: string | null }> {
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const dayAgo = new Date(now.getTime() - 86_400_000);

  const [hourSent, daySent, campaignHourSent] = await Promise.all([
    campaignRepository.countSentSinceForUser(userId, hourAgo),
    campaignRepository.countSentSinceForUser(userId, dayAgo),
    campaignRepository.countSentSinceForCampaign(campaign.id, hourAgo),
  ]);

  const hourRemaining = campaignMaxPerHour() - hourSent;
  const dayRemaining = campaignMaxPerDay() - daySent;
  const campaignRemaining = campaign.throttlePerHour - campaignHourSent;
  if (dayRemaining <= 0) return { allowed: 0, reason: "Daily limit reached" };
  if (hourRemaining <= 0) return { allowed: 0, reason: "Hourly limit reached" };
  if (campaignRemaining <= 0) {
    return { allowed: 0, reason: "Campaign throttle reached" };
  }
  return {
    allowed: Math.min(hourRemaining, dayRemaining, campaignRemaining),
    reason: null,
  };
}

/**
 * Atomically claim a batch of pending recipients, moving them to `sending`.
 * `FOR UPDATE SKIP LOCKED` means a crashed or duplicated job can only ever claim
 * rows it actually holds; the `sending` status means a retry cannot re-send a
 * row another invocation already took. `resetStaleClaims` recovers rows left
 * `sending` by a crash.
 */
export async function claimRecipientBatch({
  campaignId,
  limit = campaignBatchSize(),
}: {
  campaignId: string;
  limit?: number;
}): Promise<RecipientRow[]> {
  return campaignRepository.claimRecipientBatch(campaignId, limit);
}

/** Return rows stuck in `sending` (a crashed batch) to `pending`. */
export async function resetStaleClaims({
  campaignId,
  olderThanMs = 10 * 60 * 1000,
}: {
  campaignId: string;
  olderThanMs?: number;
}): Promise<number> {
  return campaignRepository.resetStaleClaims({
    campaignId,
    cutoff: new Date(Date.now() - olderThanMs),
  });
}

export async function markRecipientSent({
  recipientId,
  gmailMessageId,
  threadId,
  personalizedBody,
}: {
  recipientId: string;
  gmailMessageId: string | null;
  threadId: string | null;
  personalizedBody: string;
}): Promise<void> {
  await campaignRepository.updateRecipientById(recipientId, {
    status: "sent",
    gmailMessageId,
    threadId,
    personalizedBody,
    sentAt: new Date(),
    lastError: null,
  });
}

export async function markRecipientFailed({
  recipientId,
  error,
}: {
  recipientId: string;
  error: string;
}): Promise<void> {
  await campaignRepository.updateRecipientById(recipientId, {
    status: "failed",
    lastError: error.slice(0, 500),
  });
}

export async function markRecipientSkipped(recipientId: string): Promise<void> {
  await campaignRepository.updateRecipientById(recipientId, {
    status: "skipped",
  });
}

export async function countPending(campaignId: string): Promise<number> {
  return campaignRepository.countPending(campaignId);
}

export async function finishCampaignIfDone(campaignId: string): Promise<boolean> {
  const pending = await countPending(campaignId);
  if (pending > 0) return false;
  const campaign = await campaignRepository.findCampaignById(campaignId);
  if (!campaign || campaign.status === "cancelled" || campaign.status === "done") {
    return false;
  }
  await campaignRepository.updateCampaignById(campaignId, {
    status: "done",
    finishedAt: new Date(),
    updatedAt: new Date(),
  });
  await recordCampaignEvent({ userId: campaign.userId, campaignId, type: "done" });
  return true;
}

/* -------------------------------------------------------------------------- */
/*  Reply automation                                                           */
/* -------------------------------------------------------------------------- */

/** Find the campaign recipient a reply belongs to (by thread, else sender). */
export async function findCampaignRecipientForReply({
  userId,
  threadId,
  fromEmail,
}: {
  userId: string;
  threadId: string | null;
  fromEmail: string | null;
}): Promise<RecipientRow | null> {
  if (threadId) {
    const byThread = await campaignRepository.findRecipientForReplyByThread(
      userId,
      threadId,
    );
    if (byThread) return byThread;
  }
  if (fromEmail) {
    const byEmail = await campaignRepository.findSentRecipientByEmail(
      userId,
      fromEmail,
    );
    if (byEmail) return byEmail;
  }
  return null;
}

export type ReplyAutomationOutcome = {
  classification: CampaignReplyClass;
  action: "suppressed" | "auto_replied" | "drafted" | "tagged";
};

/**
 * Handle a reply to a campaign. Suppression, bounce handling and out-of-office
 * acknowledgement are the only automatic effects; everything else is drafted or
 * tagged. A reply always stops any follow-up enrollment for its thread.
 */
export async function handleCampaignReply({
  userId,
  recipient,
  subject,
  body,
  from,
  mirrorThreadId = null,
  idempotencyKeyPrefix,
}: {
  userId: string;
  recipient: RecipientRow;
  subject: string | null;
  body: string | null;
  from: string | null;
  /** The mirror `threads.id` (for follow-ups/drafts), when known. */
  mirrorThreadId?: string | null;
  idempotencyKeyPrefix?: string;
}): Promise<ReplyAutomationOutcome> {
  const campaign = await campaignRepository.findCampaignById(recipient.campaignId);
  const policy = campaign?.replyPolicy ?? "drafts";

  const verdict = await classifyCampaignReply({
    userId,
    from,
    subject,
    body,
  });

  if (mirrorThreadId) {
    await reactivityOnInbound(mirrorThreadId).catch(() => undefined);
  }

  if (verdict.classification === "unsubscribe") {
    await addSuppression({ userId, email: recipient.email, reason: "unsubscribe" });
    await campaignRepository.updateRecipientById(recipient.id, {
      status: "unsubscribed",
    });
    await recordCampaignEvent({
      userId,
      campaignId: recipient.campaignId,
      recipientId: recipient.id,
      type: "unsubscribed",
    });
    return { classification: verdict.classification, action: "suppressed" };
  }

  if (verdict.classification === "bounce") {
    await addSuppression({ userId, email: recipient.email, reason: "bounce" });
    await campaignRepository.updateRecipientById(recipient.id, {
      status: "bounced",
    });
    await recordCampaignEvent({
      userId,
      campaignId: recipient.campaignId,
      recipientId: recipient.id,
      type: "bounced",
    });
    return { classification: verdict.classification, action: "suppressed" };
  }

  await campaignRepository.updateRecipientById(recipient.id, {
    status: "replied",
  });
  await recordCampaignEvent({
    userId,
    campaignId: recipient.campaignId,
    recipientId: recipient.id,
    type: "replied",
    payload: { classification: verdict.classification, policy },
  });

  // Auto-acknowledge out-of-office only, and only when it cannot imply a
  // commitment. Everything else becomes a draft or is merely tagged.
  if (
    policy === "autopilot" &&
    canAutoRespond(verdict.classification) &&
    !impliesCommitment(body, subject)
  ) {
    const ack = buildOutOfOfficeAck();
    const fromEmail = await mailboxRepository.findFirstEmailForUser(userId);
    try {
      if (!fromEmail) throw new Error("No connected mailbox");
      await sendEmail({
        userId,
        email: {
          from: fromEmail,
          to: [recipient.email],
          subject: subject ? `Re: ${subject}` : "Re: your message",
          text: ack,
        },
        gmailThreadId: recipient.threadId ?? null,
        idempotencyKey: `${idempotencyKeyPrefix ?? "campaign-ack"}:${recipient.id}`,
      });
      await recordCampaignEvent({
        userId,
        campaignId: recipient.campaignId,
        recipientId: recipient.id,
        type: "auto_replied",
      });
      return { classification: verdict.classification, action: "auto_replied" };
    } catch (error) {
      console.warn("[campaigns] auto-reply failed", error);
    }
  }

  if (
    (policy === "drafts" || policy === "autopilot") &&
    mirrorThreadId &&
    (verdict.classification === "interested" || verdict.classification === "question")
  ) {
    const existing = await draftRepository.findAnyPendingByThread(mirrorThreadId);
    if (!existing) {
      await draftRepository.insert({
        id: nanoid(),
        userId,
        threadId: mirrorThreadId,
        body: buildReplyStub(verdict.classification),
        pipelineVersion: "campaign-reply-v1",
        status: "pending",
      });
    }
    return { classification: verdict.classification, action: "drafted" };
  }

  return { classification: verdict.classification, action: "tagged" };
}

function buildReplyStub(classification: CampaignReplyClass): string {
  if (classification === "interested") {
    return "Thanks for getting back to me — happy to share more. Would a quick call work this week?";
  }
  return "Thanks for the note — I'll come back to you shortly with the details.";
}

/** A thread's owning user + subject, for reply routing from the inbound job. */
export async function loadThreadForCampaignReply(threadId: string) {
  return (await threadRepository.findOwnerAndSubjectById(threadId)) ?? null;
}

/** Counts for the dashboard list view. */
export async function listCampaignsWithStats(userId: string) {
  const campaigns = await listCampaigns(userId);
  if (campaigns.length === 0) return [];
  const ids = campaigns.map((campaign) => campaign.id);
  const counts = await campaignRepository.countByStatusForCampaigns(ids);

  const byId = new Map<string, Partial<Record<CampaignRecipientStatus, number>>>();
  for (const row of counts) {
    const bucket = byId.get(row.campaignId) ?? {};
    bucket[row.status] = row.n;
    byId.set(row.campaignId, bucket);
  }

  return campaigns.map((campaign) => {
    const bucket = byId.get(campaign.id) ?? {};
    const total = Object.values(bucket).reduce((sum, value) => sum + (value ?? 0), 0);
    return { campaign, stats: bucket, total };
  });
}

/**
 * Safety net for the daily cron: re-enqueue campaigns stuck `sending` (e.g. the
 * function was killed mid-batch) after returning stale claims to pending.
 * Deduped per campaign per day so a double-fired cron cannot stack jobs.
 */
export async function recoverStuckCampaigns(userId: string): Promise<number> {
  const stuck = await campaignRepository.listStuckSending(userId);
  if (stuck.length === 0) return 0;

  let reenqueued = 0;
  const day = new Date().toISOString().slice(0, 10);
  for (const campaign of stuck) {
    await resetStaleClaims({ campaignId: campaign.id });
    const remaining = await countPending(campaign.id);
    if (remaining === 0) {
      await finishCampaignIfDone(campaign.id);
      continue;
    }
    await enqueueJob(pool, userId, {
      kind: JOB_KIND_BULK_SEND,
      laneKey: `campaign:${campaign.id}`,
      payload: { campaignId: campaign.id },
      sourceEventId: `campaign-recover:${campaign.id}:${day}`,
    });
    reenqueued += 1;
  }
  return reenqueued;
}

export type { CampaignSendWindow, CampaignStatus, CampaignTemplate };
