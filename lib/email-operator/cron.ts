import "server-only";

import { env } from "@/lib/env";
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
    } catch (error) {
      summary.backfillErrors += 1;
      console.error(`[cron/daily] backfill failed for ${mailbox.id}`, error);
    }
  }

  // Enqueue due follow-ups before draining so the daily net picks them up.
  summary.followupsEnqueued = await enqueueDueFollowups();

  // Safety net: on Hobby the daily cron is the only guaranteed drain.
  const drained = await drainQueue({
    workerId: `cron-daily:${Date.now().toString(36)}`,
  });
  summary.queueDrained = drained.completed;

  return summary;
}
