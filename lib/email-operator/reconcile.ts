import "server-only";

import { pool } from "@/lib/db";
import { countDeadJobs } from "@/lib/queue/queue";
import { draftRepository } from "@/lib/repositories/drafts";

/**
 * Send/DB reconciliation (F-14, G-11).
 *
 * A send can succeed in Gmail while the local mirror write fails. The ledger
 * key prevents a re-send; this job detects the drift so it is visible and
 * repairable. It never re-sends and never stores content.
 */

export type ReconcileResult = {
  checked: number;
  sendMirrorMissing: number;
  staleDrafts: number;
  deadJobs: number;
};

/**
 * Counts AI-sent drafts with no outbound mirror row near `decided_at`, and
 * pending drafts whose thread received newer inbound mail. Scoped to one user.
 */
export async function reconcileForUser(
  userId: string,
): Promise<ReconcileResult> {
  const [missing, stale, deadJobs] = await Promise.all([
    draftRepository.listAiSentWithoutMirror(userId),
    draftRepository.listStalePending(userId),
    countDeadJobs(pool, userId),
  ]);

  const sendMirrorMissing = missing.length;
  const staleDrafts = stale.length;

  if (sendMirrorMissing > 0 || deadJobs > 0) {
    console.warn("[reconcile] drift detected", {
      userId,
      sendMirrorMissing,
      staleDrafts,
      deadJobs,
    });
  }

  return {
    checked: sendMirrorMissing + staleDrafts,
    sendMirrorMissing,
    staleDrafts,
    deadJobs,
  };
}
