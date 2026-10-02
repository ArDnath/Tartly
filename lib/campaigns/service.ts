import "server-only";

import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { checkCampaignTemplate, type SpamCheckResult } from "@/lib/ai/features/spam-check";
import {
  buildOutOfOfficeAck,
  canAutoRespond,
  classifyCampaignReply,
  impliesCommitment,
  type CampaignReplyClass,
} from "@/lib/ai/features/campaign-reply";
import { db, pool } from "@/lib/db";
import {
  bulkCampaigns,
  bulkRecipients,
  campaignEvents,
  contacts,
  drafts,
  mailboxes,
  suppressionList,
  threads,
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

/**
 * Bulk campaign service (Phase 7).
 *
 * Owns the campaign lifecycle: import → draft → review gate → throttled batch
 * send → pause/resume/cancel → reply automation. Sending itself lives in the
 * `bulk_send` job handler; this module provides the claim/mark primitives and
 * the guardrails (suppression, throttle, review gate) they depend on.
 */

export type CampaignRow = typeof bulkCampaigns.$inferSelect;
export type RecipientRow = typeof bulkRecipients.$inferSelect;

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
  const rows = await db
    .select({ id: suppressionList.id })
    .from(suppressionList)
    .where(
      and(
        eq(suppressionList.userId, userId),
        eq(suppressionList.email, email.toLowerCase()),
      ),
    )
    .limit(1);
  return rows.length > 0;
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
  await db
    .insert(suppressionList)
    .values({ id: nanoid(), userId, email: email.toLowerCase(), reason })
    .onConflictDoNothing({ target: [suppressionList.userId, suppressionList.email] });
}

export async function listSuppression(userId: string) {
  return db
    .select()
    .from(suppressionList)
    .where(eq(suppressionList.userId, userId))
    .orderBy(desc(suppressionList.createdAt))
    .limit(500);
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
  await db.insert(bulkCampaigns).values({
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

  const [suppressedRows, contactRows] = await Promise.all([
    db
      .select({ email: suppressionList.email })
      .from(suppressionList)
      .where(and(eq(suppressionList.userId, userId), inArray(suppressionList.email, emails))),
    db
      .select({ email: contacts.email })
      .from(contacts)
      .where(and(eq(contacts.userId, userId), inArray(contacts.email, emails))),
  ]);
  const suppressed = new Set(suppressedRows.map((row) => row.email));
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
    const inserted = await db
      .insert(bulkRecipients)
      .values({
        id: nanoid(),
        campaignId,
        userId,
        email: candidate.email,
        name: candidate.name ?? null,
        rowData: candidate.rowData,
        status: "pending",
      })
      .onConflictDoNothing({ target: [bulkRecipients.campaignId, bulkRecipients.email] })
      .returning({ id: bulkRecipients.id });
    if (inserted.length > 0) summary.imported += 1;
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
  const rows = await db
    .select()
    .from(bulkCampaigns)
    .where(and(eq(bulkCampaigns.id, campaignId), eq(bulkCampaigns.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listCampaigns(userId: string) {
  return db
    .select()
    .from(bulkCampaigns)
    .where(eq(bulkCampaigns.userId, userId))
    .orderBy(desc(bulkCampaigns.createdAt))
    .limit(100);
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

  const updated = await db
    .update(bulkCampaigns)
    .set({
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
    })
    .where(eq(bulkCampaigns.id, campaignId))
    .returning();
  return updated[0] ?? null;
}

export type CampaignStats = {
  total: number;
  byStatus: Record<CampaignRecipientStatus, number>;
};

export async function campaignStats(campaignId: string): Promise<CampaignStats> {
  const rows = await db
    .select({ status: bulkRecipients.status, n: sql<number>`count(*)::int` })
    .from(bulkRecipients)
    .where(eq(bulkRecipients.campaignId, campaignId))
    .groupBy(bulkRecipients.status);

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
    byStatus[row.status] = Number(row.n);
    total += Number(row.n);
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
  return db
    .select()
    .from(bulkRecipients)
    .where(and(eq(bulkRecipients.campaignId, campaignId), eq(bulkRecipients.userId, userId)))
    .orderBy(desc(bulkRecipients.createdAt))
    .limit(Math.min(limit, 500));
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
    await db
      .insert(campaignEvents)
      .values({ id: nanoid(), userId, campaignId, recipientId, type, payload });
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

  const pending = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bulkRecipients)
    .where(
      and(
        eq(bulkRecipients.campaignId, campaignId),
        inArray(bulkRecipients.status, ["pending", "failed"]),
      ),
    );
  if (Number(pending[0]?.n ?? 0) === 0) {
    return { ok: false, blocked: false, reason: "There are no pending recipients." };
  }

  await db
    .update(bulkCampaigns)
    .set({ status: "sending", startedAt: campaign.startedAt ?? new Date(), updatedAt: new Date() })
    .where(eq(bulkCampaigns.id, campaignId));

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
  const updated = await db
    .update(bulkCampaigns)
    .set({ status: "paused", updatedAt: new Date() })
    .where(
      and(
        eq(bulkCampaigns.id, campaignId),
        eq(bulkCampaigns.userId, userId),
        eq(bulkCampaigns.status, "sending"),
      ),
    )
    .returning({ id: bulkCampaigns.id });
  if (updated.length > 0) {
    await recordCampaignEvent({ userId, campaignId, type: "paused" });
  }
  return updated.length > 0;
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
  await db
    .update(bulkRecipients)
    .set({ status: "pending" })
    .where(
      and(
        eq(bulkRecipients.campaignId, campaignId),
        eq(bulkRecipients.status, "sending"),
      ),
    );
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
  await db
    .update(bulkCampaigns)
    .set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() })
    .where(eq(bulkCampaigns.id, campaignId));
  await db
    .update(bulkRecipients)
    .set({ status: "skipped" })
    .where(
      and(
        eq(bulkRecipients.campaignId, campaignId),
        inArray(bulkRecipients.status, ["pending", "failed", "sending"]),
      ),
    );
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

  const [hourRows, dayRows, campaignHourRows] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(bulkRecipients)
      .where(
        and(
          eq(bulkRecipients.userId, userId),
          eq(bulkRecipients.status, "sent"),
          sql`${bulkRecipients.sentAt} >= ${hourAgo.toISOString()}`,
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(bulkRecipients)
      .where(
        and(
          eq(bulkRecipients.userId, userId),
          eq(bulkRecipients.status, "sent"),
          sql`${bulkRecipients.sentAt} >= ${dayAgo.toISOString()}`,
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(bulkRecipients)
      .where(
        and(
          eq(bulkRecipients.campaignId, campaign.id),
          eq(bulkRecipients.status, "sent"),
          sql`${bulkRecipients.sentAt} >= ${hourAgo.toISOString()}`,
        ),
      ),
  ]);

  const hourRemaining = campaignMaxPerHour() - Number(hourRows[0]?.n ?? 0);
  const dayRemaining = campaignMaxPerDay() - Number(dayRows[0]?.n ?? 0);
  const campaignRemaining = campaign.throttlePerHour - Number(campaignHourRows[0]?.n ?? 0);
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
  const result = await pool.query<RecipientRow>(
    `update bulk_recipients r
        set attempts = attempts + 1,
            status = 'sending',
            updated_at = now()
      where r.id in (
        select id from bulk_recipients
         where campaign_id = $1 and status = 'pending'
         order by created_at
         limit $2
         for update skip locked
      )
      returning r.*`,
    [campaignId, limit],
  );
  return result.rows;
}

/** Return rows stuck in `sending` (a crashed batch) to `pending`. */
export async function resetStaleClaims({
  campaignId,
  olderThanMs = 10 * 60 * 1000,
}: {
  campaignId: string;
  olderThanMs?: number;
}): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const updated = await db
    .update(bulkRecipients)
    .set({ status: "pending" })
    .where(
      and(
        eq(bulkRecipients.campaignId, campaignId),
        eq(bulkRecipients.status, "sending"),
        sql`${bulkRecipients.updatedAt} < ${cutoff.toISOString()}`,
      ),
    )
    .returning({ id: bulkRecipients.id });
  return updated.length;
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
  await db
    .update(bulkRecipients)
    .set({
      status: "sent",
      gmailMessageId,
      threadId,
      personalizedBody,
      sentAt: new Date(),
      lastError: null,
    })
    .where(eq(bulkRecipients.id, recipientId));
}

export async function markRecipientFailed({
  recipientId,
  error,
}: {
  recipientId: string;
  error: string;
}): Promise<void> {
  await db
    .update(bulkRecipients)
    .set({ status: "failed", lastError: error.slice(0, 500) })
    .where(eq(bulkRecipients.id, recipientId));
}

export async function markRecipientSkipped(recipientId: string): Promise<void> {
  await db
    .update(bulkRecipients)
    .set({ status: "skipped" })
    .where(eq(bulkRecipients.id, recipientId));
}

export async function countPending(campaignId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bulkRecipients)
    .where(
      and(eq(bulkRecipients.campaignId, campaignId), eq(bulkRecipients.status, "pending")),
    );
  return Number(rows[0]?.n ?? 0);
}

export async function finishCampaignIfDone(campaignId: string): Promise<boolean> {
  const pending = await countPending(campaignId);
  if (pending > 0) return false;
  const campaign = (
    await db.select().from(bulkCampaigns).where(eq(bulkCampaigns.id, campaignId)).limit(1)
  )[0];
  if (!campaign || campaign.status === "cancelled" || campaign.status === "done") {
    return false;
  }
  await db
    .update(bulkCampaigns)
    .set({ status: "done", finishedAt: new Date(), updatedAt: new Date() })
    .where(eq(bulkCampaigns.id, campaignId));
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
    const byThread = await db
      .select()
      .from(bulkRecipients)
      .where(and(eq(bulkRecipients.userId, userId), eq(bulkRecipients.threadId, threadId)))
      .limit(1);
    if (byThread[0]) return byThread[0];
  }
  if (fromEmail) {
    const byEmail = await db
      .select()
      .from(bulkRecipients)
      .where(
        and(
          eq(bulkRecipients.userId, userId),
          eq(bulkRecipients.email, fromEmail.toLowerCase()),
          eq(bulkRecipients.status, "sent"),
        ),
      )
      .limit(1);
    if (byEmail[0]) return byEmail[0];
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
  const campaign = (
    await db.select().from(bulkCampaigns).where(eq(bulkCampaigns.id, recipient.campaignId)).limit(1)
  )[0];
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
    await db
      .update(bulkRecipients)
      .set({ status: "unsubscribed" })
      .where(eq(bulkRecipients.id, recipient.id));
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
    await db
      .update(bulkRecipients)
      .set({ status: "bounced" })
      .where(eq(bulkRecipients.id, recipient.id));
    await recordCampaignEvent({
      userId,
      campaignId: recipient.campaignId,
      recipientId: recipient.id,
      type: "bounced",
    });
    return { classification: verdict.classification, action: "suppressed" };
  }

  await db
    .update(bulkRecipients)
    .set({ status: "replied" })
    .where(eq(bulkRecipients.id, recipient.id));
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
    const mailboxRows = await db
      .select({ email: mailboxes.email })
      .from(mailboxes)
      .where(eq(mailboxes.userId, userId))
      .limit(1);
    const fromEmail = mailboxRows[0]?.email;
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
    const existing = await db
      .select({ id: drafts.id })
      .from(drafts)
      .where(
        and(
          eq(drafts.threadId, mirrorThreadId),
          eq(drafts.status, "pending"),
        ),
      )
      .limit(1);
    if (!existing[0]) {
      await db.insert(drafts).values({
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
  const rows = await db
    .select({ userId: threads.userId, subject: threads.subject })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  return rows[0] ?? null;
}

/** Counts for the dashboard list view. */
export async function listCampaignsWithStats(userId: string) {
  const campaigns = await listCampaigns(userId);
  if (campaigns.length === 0) return [];
  const ids = campaigns.map((campaign) => campaign.id);
  const counts = await db
    .select({
      campaignId: bulkRecipients.campaignId,
      status: bulkRecipients.status,
      n: count(),
    })
    .from(bulkRecipients)
    .where(inArray(bulkRecipients.campaignId, ids))
    .groupBy(bulkRecipients.campaignId, bulkRecipients.status);

  const byId = new Map<string, Partial<Record<CampaignRecipientStatus, number>>>();
  for (const row of counts) {
    const bucket = byId.get(row.campaignId) ?? {};
    bucket[row.status] = Number(row.n);
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
  const stuck = await db
    .select({ id: bulkCampaigns.id })
    .from(bulkCampaigns)
    .where(and(eq(bulkCampaigns.userId, userId), eq(bulkCampaigns.status, "sending")));
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
