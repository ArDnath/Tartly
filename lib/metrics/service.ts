import "server-only";

import { and, eq, gte, like, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  commitments,
  drafts,
  flowRuns,
  followupEnrollments,
  meetings,
  sendLedger,
} from "@/lib/db/schema";

/**
 * Operational metrics for the run panel / dashboard. All counts are windowed on
 * `sinceDays` except the standing counts (active follow-ups, open promises).
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

function count(query: Promise<Array<{ n: number }>>): Promise<number> {
  return query.then((rows) => rows[0]?.n ?? 0);
}

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
      count(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(flowRuns)
          .where(and(eq(flowRuns.userId, userId), gte(flowRuns.startedAt, since))),
      ),
      count(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(drafts)
          .where(and(eq(drafts.userId, userId), gte(drafts.createdAt, since))),
      ),
      count(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(drafts)
          .where(
            and(
              eq(drafts.userId, userId),
              eq(drafts.status, "sent"),
              gte(drafts.createdAt, since),
            ),
          ),
      ),
      count(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(meetings)
          .where(
            and(eq(meetings.userId, userId), gte(meetings.createdAt, since)),
          ),
      ),
      count(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(followupEnrollments)
          .where(
            and(
              eq(followupEnrollments.userId, userId),
              eq(followupEnrollments.status, "active"),
            ),
          ),
      ),
      count(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(drafts)
          .where(
            and(
              eq(drafts.userId, userId),
              eq(drafts.status, "sent"),
              eq(drafts.sentBy, "ai"),
              gte(drafts.decidedAt, since),
            ),
          ),
      ),
      count(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(commitments)
          .where(
            and(
              eq(commitments.userId, userId),
              eq(commitments.status, "open"),
            ),
          ),
      ),
      count(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(sendLedger)
          .where(
            and(
              eq(sendLedger.userId, userId),
              like(sendLedger.idempotencyKey, "commitment:%"),
              gte(sendLedger.createdAt, since),
            ),
          ),
      ),
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
