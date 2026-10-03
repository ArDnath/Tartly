import "server-only";

import { and, asc, desc, eq, lte, sql } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { followupEnrollments, threads } from "@/lib/db/schema";

/**
 * Persistence for `followup_enrollments`.
 *
 * One method = one atomic storage operation (SKILL §1.1). Owner-scoped reads
 * and guarded transitions live here; the cadence rules (deliverable windows,
 * attempt caps, unreachable recipients) stay in `lib/followup/service.ts`.
 */

export type FollowupEnrollment = typeof followupEnrollments.$inferSelect;
export type NewFollowupEnrollment = typeof followupEnrollments.$inferInsert;

export type FollowupWithSubject = {
  enrollment: FollowupEnrollment;
  subject: string | null;
};

export class FollowupEnrollmentRepository {
  constructor(private readonly database: Database = db) {}

  async countActive(userId: string): Promise<number> {
    const rows = await this.database
      .select({ n: sql<number>`count(*)::int` })
      .from(followupEnrollments)
      .where(
        and(
          eq(followupEnrollments.userId, userId),
          eq(followupEnrollments.status, "active"),
        ),
      );
    return rows[0]?.n ?? 0;
  }

  /**
   * The active enrollment for a mirrored thread, regardless of owner. The
   * caller already resolved the thread, so this mirrors the original
   * thread-scoped idempotency check.
   */
  async findActiveByThread(
    threadId: string,
  ): Promise<FollowupEnrollment | undefined> {
    const rows = await this.database
      .select()
      .from(followupEnrollments)
      .where(
        and(
          eq(followupEnrollments.threadId, threadId),
          eq(followupEnrollments.status, "active"),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async findById(enrollmentId: string): Promise<FollowupEnrollment | undefined> {
    const rows = await this.database
      .select()
      .from(followupEnrollments)
      .where(eq(followupEnrollments.id, enrollmentId))
      .limit(1);
    return rows[0];
  }

  async findByIdForUser(
    userId: string,
    enrollmentId: string,
  ): Promise<FollowupEnrollment | undefined> {
    const rows = await this.database
      .select()
      .from(followupEnrollments)
      .where(
        and(
          eq(followupEnrollments.id, enrollmentId),
          eq(followupEnrollments.userId, userId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async insert(values: NewFollowupEnrollment): Promise<FollowupEnrollment> {
    const rows = await this.database
      .insert(followupEnrollments)
      .values(values)
      .returning();
    return rows[0]!;
  }

  /** Explicit field patch by primary key; returns the updated row. */
  async updateById(
    enrollmentId: string,
    values: Partial<NewFollowupEnrollment>,
  ): Promise<FollowupEnrollment | null> {
    const rows = await this.database
      .update(followupEnrollments)
      .set(values)
      .where(eq(followupEnrollments.id, enrollmentId))
      .returning();
    return rows[0] ?? null;
  }

  /** Stops every active enrollment for a thread; returns how many changed. */
  async stopActiveByThread(input: {
    threadId: string;
    reason: string;
    now: Date;
  }): Promise<number> {
    const updated = await this.database
      .update(followupEnrollments)
      .set({ status: "stopped", stopReason: input.reason, updatedAt: input.now })
      .where(
        and(
          eq(followupEnrollments.threadId, input.threadId),
          eq(followupEnrollments.status, "active"),
        ),
      )
      .returning({ id: followupEnrollments.id });
    return updated.length;
  }

  /** Owner-scoped stop; returns false when nothing matching was updated. */
  async stopOwned(input: {
    userId: string;
    enrollmentId: string;
    reason: string;
    now: Date;
  }): Promise<boolean> {
    const updated = await this.database
      .update(followupEnrollments)
      .set({ status: "stopped", stopReason: input.reason, updatedAt: input.now })
      .where(
        and(
          eq(followupEnrollments.id, input.enrollmentId),
          eq(followupEnrollments.userId, input.userId),
        ),
      )
      .returning({ id: followupEnrollments.id });
    return updated.length > 0;
  }

  async setPaused(input: {
    userId: string;
    enrollmentId: string;
    paused: boolean;
    now: Date;
  }): Promise<FollowupEnrollment | null> {
    const rows = await this.database
      .update(followupEnrollments)
      .set({
        status: input.paused ? "paused" : "active",
        updatedAt: input.now,
      })
      .where(
        and(
          eq(followupEnrollments.id, input.enrollmentId),
          eq(followupEnrollments.userId, input.userId),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /** Enrollment list with the thread subject, newest first (keyset-ready). */
  async listForUserWithSubject(input: {
    userId: string;
    limit: number;
    after?: { createdAt: Date; id: string };
  }): Promise<FollowupWithSubject[]> {
    const conditions = [eq(followupEnrollments.userId, input.userId)];
    if (input.after) {
      conditions.push(
        sql`(${followupEnrollments.createdAt}, ${followupEnrollments.id}) < (${input.after.createdAt}::timestamptz, ${input.after.id})`,
      );
    }
    const rows = await this.database
      .select({
        enrollment: followupEnrollments,
        subject: threads.subject,
      })
      .from(followupEnrollments)
      .leftJoin(threads, eq(threads.id, followupEnrollments.threadId))
      .where(and(...conditions))
      .orderBy(desc(followupEnrollments.createdAt), desc(followupEnrollments.id))
      .limit(input.limit);
    return rows;
  }

  /** Active enrollments whose next evaluation is due, earliest first. */
  async listDueActive(input: {
    now: Date;
    limit: number;
  }): Promise<FollowupEnrollment[]> {
    return this.database
      .select()
      .from(followupEnrollments)
      .where(
        and(
          eq(followupEnrollments.status, "active"),
          lte(followupEnrollments.nextEvalAt, input.now),
        ),
      )
      .orderBy(asc(followupEnrollments.nextEvalAt))
      .limit(input.limit);
  }

  /**
   * A user's active enrollments due by the end of the local day, joined to the
   * thread subject for the briefing card. Earliest first.
   */
  async listActiveDueForUser(input: {
    userId: string;
    before: Date;
    limit: number;
  }): Promise<
    Array<{
      enrollmentId: string;
      threadId: string;
      nextEvalAt: Date | null;
      subject: string | null;
    }>
  > {
    return this.database
      .select({
        enrollmentId: followupEnrollments.id,
        threadId: followupEnrollments.threadId,
        nextEvalAt: followupEnrollments.nextEvalAt,
        subject: threads.subject,
      })
      .from(followupEnrollments)
      .leftJoin(threads, eq(threads.id, followupEnrollments.threadId))
      .where(
        and(
          eq(followupEnrollments.userId, input.userId),
          eq(followupEnrollments.status, "active"),
          lte(followupEnrollments.nextEvalAt, input.before),
        ),
      )
      .orderBy(asc(followupEnrollments.nextEvalAt))
      .limit(input.limit);
  }

  async deleteForUser(userId: string): Promise<void> {
    await this.database
      .delete(followupEnrollments)
      .where(eq(followupEnrollments.userId, userId));
  }
}

export const followupEnrollmentRepository = new FollowupEnrollmentRepository();
