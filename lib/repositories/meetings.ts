import "server-only";

import { and, asc, eq, gte, lte, sql } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { meetings } from "@/lib/db/schema";

/** Persistence for booked `meetings`; the metrics board counts them by window. */

export type Meeting = typeof meetings.$inferSelect;

export class MeetingRepository {
  constructor(private readonly database: Database = db) {}

  async countCreatedSince(userId: string, since: Date): Promise<number> {
    const rows = await this.database
      .select({ n: sql<number>`count(*)::int` })
      .from(meetings)
      .where(
        and(eq(meetings.userId, userId), gte(meetings.createdAt, since)),
      );
    return rows[0]?.n ?? 0;
  }

  /** Meetings starting inside `[from, to]`, soonest first. */
  async listStartingBetween(input: {
    userId: string;
    from: Date;
    to: Date;
    limit: number;
  }): Promise<Meeting[]> {
    return this.database
      .select()
      .from(meetings)
      .where(
        and(
          eq(meetings.userId, input.userId),
          gte(meetings.startAt, input.from),
          lte(meetings.startAt, input.to),
        ),
      )
      .orderBy(asc(meetings.startAt))
      .limit(input.limit);
  }

  /**
   * Unscoped id lookup for engine steps that already vetted the meeting
   * upstream. Prefer `findByIdForUser` on any user-facing path.
   */
  async findById(meetingId: string): Promise<Meeting | undefined> {
    const rows = await this.database
      .select()
      .from(meetings)
      .where(eq(meetings.id, meetingId))
      .limit(1);
    return rows[0];
  }

  async findByIdForUser(
    userId: string,
    meetingId: string,
  ): Promise<Meeting | undefined> {
    const rows = await this.database
      .select()
      .from(meetings)
      .where(and(eq(meetings.id, meetingId), eq(meetings.userId, userId)))
      .limit(1);
    return rows[0];
  }
}

export const meetingRepository = new MeetingRepository();
