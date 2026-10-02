import "server-only";

import { env } from "@/lib/env";
import { refreshWritingStyleIfStale } from "@/lib/ai/features/writing-style";
import { maybeGenerateScheduledDigest } from "@/lib/ai/features/digest";
import { recoverStuckCampaigns } from "@/lib/campaigns/service";
import { enqueueDueCommitments } from "@/lib/commitments/service";
import { db, pool } from "@/lib/db";
import { mailboxes } from "@/lib/db/schema";
import { JOB_KIND_INBOUND_EMAIL } from "@/lib/email-operator/job-kinds";
import { renewExpiringWatches } from "@/lib/gmail/watch";
import { syncMailbox } from "@/lib/gmail/sync";
import { drainQueue } from "@/lib/email-operator/drain";
import { enqueueDueFollowups } from "@/lib/followup/service";
import { enqueueJob } from "@/lib/queue/queue";

export type DailyMaintenanceSummary = {
  watchesRenewed: number;
  watchesFailed: number;
  mailboxesBackfilled: number;
  backfillErrors: number;
  triageEnqueued: number;
  followupsEnqueued: number;
  queueDrained: number;
  stylesRefreshed: number;
  digestsGenerated: number;
  campaignsRecovered: number;
  commitmentNudges: number;
};

/**
 * Hobby cron entry: one invocation fans out the day's safety-net work.
 *
 * Phase 1 renews the (7-day) Gmail watches and backfills recently missed mail.
 * Later phases append due follow-ups, the queue reaper and reconciliation —
 * all inside this same function so the Hobby cron count stays at one.
 */
export async function runDailyMaintenance(): Promise<DailyMaintenanceSummary> {
  const summary: DailyMaintenanceSummary = {
    watchesRenewed: 0,
    watchesFailed: 0,
    mailboxesBackfilled: 0,
    backfillErrors: 0,
    triageEnqueued: 0,
    followupsEnqueued: 0,
    queueDrained: 0,
    stylesRefreshed: 0,
    digestsGenerated: 0,
    campaignsRecovered: 0,
    commitmentNudges: 0,
  };

  if (env.GOOGLE_PUBSUB_TOPIC) {
    const watchResult = await renewExpiringWatches({
      topicName: env.GOOGLE_PUBSUB_TOPIC,
    });
    summary.watchesRenewed = watchResult.renewed;
    summary.watchesFailed = watchResult.failed;
  }

  // Bounded backfill: at most the first page per mailbox.
  const rows = await db
    .select({ id: mailboxes.id, userId: mailboxes.userId })
    .from(mailboxes)
    .limit(50);

  for (const mailbox of rows) {
    try {
      await syncMailbox(mailbox.userId, mailbox.id);
      summary.mailboxesBackfilled += 1;

      // Hand the backfilled mail to triage. Deduped per mailbox per day so a
      // double-fired cron cannot stack duplicate triage passes.
      await enqueueJob(pool, mailbox.userId, {
        kind: JOB_KIND_INBOUND_EMAIL,
        laneKey: `mailbox:${mailbox.id}`,
        payload: { mailboxId: mailbox.id },
        sourceEventId: `cron:${mailbox.id}:${new Date().toISOString().slice(0, 10)}`,
      });
      summary.triageEnqueued += 1;

      // Voice: refresh the learned writing style at most monthly. Best-effort;
      // a failure never blocks the maintenance run.
      try {
        const refreshed = await refreshWritingStyleIfStale({
          userId: mailbox.userId,
        });
        if (refreshed.refreshed) summary.stylesRefreshed += 1;
      } catch (error) {
        console.warn(`[cron/daily] style refresh failed for ${mailbox.id}`, error);
      }

      // Phase 4: generate a digest only when the user's cadence says one is due.
      try {
        const generated = await maybeGenerateScheduledDigest({
          userId: mailbox.userId,
        });
        if (generated) summary.digestsGenerated += 1;
      } catch (error) {
        console.warn(`[cron/daily] digest failed for ${mailbox.id}`, error);
      }

      // Phase 7: re-enqueue campaigns killed mid-batch by a crashed function.
      try {
        summary.campaignsRecovered += await recoverStuckCampaigns(mailbox.userId);
      } catch (error) {
        console.warn(`[cron/daily] campaign recovery failed for ${mailbox.id}`, error);
      }
    } catch (error) {
      summary.backfillErrors += 1;
      console.error(`[cron/daily] backfill failed for ${mailbox.id}`, error);
    }
  }

  // Enqueue due follow-ups before draining so the daily net picks them up.
  summary.followupsEnqueued = await enqueueDueFollowups();

  // Overdue promises: prepare chaser/reminder drafts (never sends). Idempotent
  // per (commitment, nudgeCount) via the send ledger.
  summary.commitmentNudges = await enqueueDueCommitments();

  // Safety net: on Hobby the daily cron is the only guaranteed drain.
  const drained = await drainQueue({
    workerId: `cron-daily:${Date.now().toString(36)}`,
  });
  summary.queueDrained = drained.completed;

  return summary;
}
