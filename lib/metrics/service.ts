import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  drafts,
  flowRuns,
  followupEnrollments,
  meetings,
} from "@/lib/db/schema";

/**
 * Operational metrics for the run panel / dashboard. All counts are windowed on
 * `sinceDays` except the active follow-up count.
 */

export type Metrics = {
  sinceDays: number;
  runs: number;
  drafts: number;
  repliesSent: number;
  meetingsBooked: number;
  followupsActive: number;
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

  const [runs, draftCount, repliesSent, meetingsBooked, followupsActive] =
    await Promise.all([
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
    ]);

  return {
    sinceDays,
    runs,
    drafts: draftCount,
    repliesSent,
    meetingsBooked,
    followupsActive,
  };
}
