import "server-only";

import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { commitments, type CommitmentDirection } from "@/lib/db/schema";

/**
 * Persistence for `commitments` (promises).
 *
 * One method = one atomic storage operation (SKILL §1.1). Extraction rules,
 * nudge copy and caps stay in `lib/commitments/service.ts`.
 */

export type Commitment = typeof commitments.$inferSelect;
export type NewCommitment = typeof commitments.$inferInsert;

export class CommitmentRepository {
  constructor(private readonly database: Database = db) {}

  async countOpen(userId: string): Promise<number> {
    const rows = await this.database
      .select({ n: sql<number>`count(*)::int` })
      .from(commitments)
      .where(
        and(
          eq(commitments.userId, userId),
          eq(commitments.status, "open"),
        ),
      );
    return rows[0]?.n ?? 0;
  }

  async listOpen(input: {
    userId: string;
    threadId?: string;
    limit: number;
  }): Promise<Commitment[]> {
    return this.database
      .select()
      .from(commitments)
      .where(
        and(
          eq(commitments.userId, input.userId),
          eq(commitments.status, "open"),
          input.threadId ? eq(commitments.threadId, input.threadId) : undefined,
        ),
      )
      .orderBy(asc(commitments.dueAt), desc(commitments.createdAt))
      .limit(input.limit);
  }

  async insert(values: NewCommitment): Promise<Commitment> {
    const rows = await this.database
      .insert(commitments)
      .values(values)
      .returning();
    return rows[0]!;
  }

  /** Owner-scoped status transition (fulfil/dismiss); false when not owned. */
  async setStatusOwned(input: {
    userId: string;
    commitmentId: string;
    status: "open" | "fulfilled" | "cancelled" | "expired";
    now: Date;
  }): Promise<boolean> {
    const updated = await this.database
      .update(commitments)
      .set({ status: input.status, updatedAt: input.now })
      .where(
        and(
          eq(commitments.id, input.commitmentId),
          eq(commitments.userId, input.userId),
        ),
      )
      .returning({ id: commitments.id });
    return updated.length > 0;
  }

  /** Fulfil every open commitment on a thread; returns how many changed. */
  async resolveOpenForThread(input: {
    threadId: string;
    direction?: CommitmentDirection;
    now: Date;
  }): Promise<number> {
    const updated = await this.database
      .update(commitments)
      .set({ status: "fulfilled", updatedAt: input.now })
      .where(
        and(
          eq(commitments.threadId, input.threadId),
          eq(commitments.status, "open"),
          input.direction
            ? eq(commitments.direction, input.direction)
            : undefined,
        ),
      )
      .returning({ id: commitments.id });
    return updated.length;
  }

  /**
   * Overdue open promises eligible for a nudge: thread-bound, under the nudge
   * cap, and outside the cooldown window.
   */
  async listDueForNudge(input: {
    now: Date;
    nudgeNotBefore: Date;
    maxNudges: number;
    limit: number;
  }): Promise<Commitment[]> {
    return this.database
      .select()
      .from(commitments)
      .where(
        and(
          eq(commitments.status, "open"),
          lte(commitments.dueAt, input.now),
          sql`${commitments.threadId} is not null`,
          sql`${commitments.nudgeCount} < ${input.maxNudges}`,
          or(
            isNull(commitments.nudgedAt),
            lte(commitments.nudgedAt, input.nudgeNotBefore),
          ),
        ),
      )
      .orderBy(asc(commitments.dueAt))
      .limit(input.limit);
  }

  async recordNudge(input: {
    commitmentId: string;
    nudgeCount: number;
    now: Date;
  }): Promise<void> {
    await this.database
      .update(commitments)
      .set({
        nudgedAt: input.now,
        nudgeCount: input.nudgeCount,
        updatedAt: input.now,
      })
      .where(eq(commitments.id, input.commitmentId));
  }

  /** Open promises attached to a set of threads (briefing reply cards). */
  async listOpenForThreads(input: {
    userId: string;
    threadIds: string[];
  }): Promise<Commitment[]> {
    if (input.threadIds.length === 0) return [];
    return this.database
      .select()
      .from(commitments)
      .where(
        and(
          eq(commitments.userId, input.userId),
          eq(commitments.status, "open"),
          inArray(commitments.threadId, input.threadIds),
        ),
      );
  }

  /** Bounded open promises on one thread, for prompt context. */
  async listOpenByThread(input: {
    userId: string;
    threadId: string;
    limit: number;
  }): Promise<Commitment[]> {
    return this.database
      .select()
      .from(commitments)
      .where(
        and(
          eq(commitments.userId, input.userId),
          eq(commitments.threadId, input.threadId),
          eq(commitments.status, "open"),
        ),
      )
      .limit(input.limit);
  }

  /** Open promises with a due date at or before `before`, soonest first. */
  async listOpenDueBefore(input: {
    userId: string;
    before: Date;
    limit: number;
  }): Promise<Commitment[]> {
    return this.database
      .select()
      .from(commitments)
      .where(
        and(
          eq(commitments.userId, input.userId),
          eq(commitments.status, "open"),
          isNotNull(commitments.dueAt),
          lte(commitments.dueAt, input.before),
        ),
      )
      .orderBy(asc(commitments.dueAt))
      .limit(input.limit);
  }

  async deleteForUser(userId: string): Promise<void> {
    await this.database
      .delete(commitments)
      .where(eq(commitments.userId, userId));
  }
}

export const commitmentRepository = new CommitmentRepository();
