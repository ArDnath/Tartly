import "server-only";

import { env } from "@/lib/env";
import { refreshWritingStyleIfStale } from "@/lib/ai/features/writing-style";
import { maybeGenerateScheduledDigest } from "@/lib/ai/features/digest";
import { recoverStuckCampaigns } from "@/lib/campaigns/service";
import { enqueueDueCommitments } from "@/lib/commitments/service";
import { pool } from "@/lib/db";
import { JOB_KIND_INBOUND_EMAIL } from "@/lib/email-operator/job-kinds";
import { getUnhealthyWatches, renewExpiringWatches } from "@/lib/gmail/watch";
import { syncMailbox } from "@/lib/gmail/sync";
import { drainQueue } from "@/lib/email-operator/drain";
import { reconcileForUser } from "@/lib/email-operator/reconcile";
import { runRetentionJobs } from "@/lib/email-operator/retention";
import { enqueueDueFollowups } from "@/lib/followup/service";
import { enqueueJob } from "@/lib/queue/queue";
import { mailboxRepository } from "@/lib/repositories/mailboxes";
import { runAutopilotReview } from "@/lib/settings/autopilot-review";

export type DailyMaintenanceSummary = {
  watchesRenewed: number;
  watchesFailed: number;
  watchesUnhealthy: number;
  mailboxesBackfilled: number;
  backfillErrors: number;
  triageEnqueued: number;
  followupsEnqueued: number;
  queueDrained: number;
  stylesRefreshed: number;
  digestsGenerated: number;
  campaignsRecovered: number;
  commitmentNudges: number;
  reconcileDrift: number;
  retentionPruned: number;
  autopilotReviews: number;
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
    watchesUnhealthy: 0,
    mailboxesBackfilled: 0,
    backfillErrors: 0,
    triageEnqueued: 0,
    followupsEnqueued: 0,
    queueDrained: 0,
    stylesRefreshed: 0,
    digestsGenerated: 0,
    campaignsRecovered: 0,
    commitmentNudges: 0,
    reconcileDrift: 0,
    retentionPruned: 0,
    autopilotReviews: 0,
  };

  if (env.GOOGLE_PUBSUB_TOPIC) {
    const watchResult = await renewExpiringWatches({
      topicName: env.GOOGLE_PUBSUB_TOPIC,
    });
    summary.watchesRenewed = watchResult.renewed;
    summary.watchesFailed = watchResult.failed;
  }

  // After renewal, report any watch still unhealthy (expiring, lapsed, or a
  // sync failure). Drives the watch-expiring alert (SLO-7).
  try {
    summary.watchesUnhealthy = (await getUnhealthyWatches()).length;
  } catch (error) {
    console.warn("[cron/daily] watch health check failed", error);
  }

  // Bounded backfill: at most the first page per mailbox.
  const rows = await mailboxRepository.listForBackfill(50);

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

      // F-14/G-11: detect send/DB drift for this user's mailboxes.
      try {
        const reconciled = await reconcileForUser(mailbox.userId);
        summary.reconcileDrift +=
          reconciled.sendMirrorMissing + reconciled.deadJobs;
      } catch (error) {
        console.warn(`[cron/daily] reconcile failed for ${mailbox.id}`, error);
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

  // 24/7 autopilot: finalize the overnight review for every enabled mailbox, so
  // the morning catch-up reflects it even on Hobby. Idempotent.
  try {
    const review = await runAutopilotReview();
    summary.autopilotReviews = review.reviewsFinalized;
  } catch (error) {
    console.warn("[cron/daily] autopilot review failed", error);
  }

  // Safety net: on Hobby the daily cron is the only guaranteed drain.
  const drained = await drainQueue({
    workerId: `cron-daily:${Date.now().toString(36)}`,
  });
  summary.queueDrained = drained.completed;

  // Retention: prune bounded, content-free history (autopilot decisions,
  // event log, old send-ledger rows). Failure never blocks the run.
  try {
    const retention = await runRetentionJobs();
    summary.retentionPruned =
      retention.autopilotDecisions + retention.eventLog + retention.sendLedger;
  } catch (error) {
    console.warn("[cron/daily] retention failed", error);
  }

  return summary;
}
