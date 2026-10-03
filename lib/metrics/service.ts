import "server-only";

import { commitmentRepository } from "@/lib/repositories/commitments";
import { draftRepository } from "@/lib/repositories/drafts";
import { flowRunRepository } from "@/lib/repositories/flow-runs";
import { followupEnrollmentRepository } from "@/lib/repositories/followup-enrollments";
import { meetingRepository } from "@/lib/repositories/meetings";
import { sendLedgerRepository } from "@/lib/repositories/send-ledger";

/**
 * Operational metrics for the run panel / dashboard. All counts are windowed on
 * `sinceDays` except the standing counts (active follow-ups, open promises).
 *
 * Pure read-model orchestration: each count is one atomic repository method, and
 * this service composes them.
 */

export type Metrics = {
  sinceDays: number;
  runs: number;
  drafts: number;
  repliesSent: number;
  meetingsBooked: number;
  followupsActive: number;
  /** Replies the operator sent on its own in the window. */
  aiHandled: number;
  /** Open promises (both directions), not windowed. */
  promisesOpen: number;
  /** Commitment nudge drafts prepared in the window. */
  briefingActions: number;
};

export async function getMetrics({
  userId,
  sinceDays = 7,
  now = new Date(),
}: {
  userId: string;
  sinceDays?: number;
  now?: Date;
}): Promise<Metrics> {
  const since = new Date(now.getTime() - sinceDays * 24 * 60 * 60 * 1000);

  const [
    runs,
    draftCount,
    repliesSent,
    meetingsBooked,
    followupsActive,
    aiHandled,
    promisesOpen,
    briefingActions,
  ] = await Promise.all([
    flowRunRepository.countStartedSince(userId, since),
    draftRepository.countCreatedSince(userId, since),
    draftRepository.countSentSince(userId, since),
    meetingRepository.countCreatedSince(userId, since),
    followupEnrollmentRepository.countActive(userId),
    draftRepository.countAiHandledSince(userId, since),
    commitmentRepository.countOpen(userId),
    sendLedgerRepository.countCommitmentNudgesSince(userId, since),
  ]);

  return {
    sinceDays,
    runs,
    drafts: draftCount,
    repliesSent,
    meetingsBooked,
    followupsActive,
    aiHandled,
    promisesOpen,
    briefingActions,
  };
}
