import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { scheduledActions } from "@/lib/db/schema";

/**
 * Persistence for `scheduled_actions`. The `pending → processing` claim is a
 * guarded conditional UPDATE so a re-fired job loses the race and does nothing.
 */

export type ScheduledAction = typeof scheduledActions.$inferSelect;
export type NewScheduledAction = typeof scheduledActions.$inferInsert;

export class ScheduledActionRepository {
  constructor(private readonly database: Database = db) {}

  async findByPendingAction(
    userId: string,
    pendingActionId: string,
  ): Promise<ScheduledAction | undefined> {
    const rows = await this.database
      .select()
      .from(scheduledActions)
      .where(
        and(
          eq(scheduledActions.userId, userId),
          eq(scheduledActions.pendingActionId, pendingActionId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async insert(values: NewScheduledAction): Promise<ScheduledAction> {
    const rows = await this.database
      .insert(scheduledActions)
      .values(values)
      .returning();
    return rows[0]!;
  }

  async findByIdForUser(
    userId: string,
    scheduledActionId: string,
  ): Promise<ScheduledAction | undefined> {
    const rows = await this.database
      .select()
      .from(scheduledActions)
      .where(
        and(
          eq(scheduledActions.id, scheduledActionId),
          eq(scheduledActions.userId, userId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async listForUser(input: {
    userId: string;
    limit: number;
  }): Promise<ScheduledAction[]> {
    return this.database
      .select()
      .from(scheduledActions)
      .where(eq(scheduledActions.userId, input.userId))
      .orderBy(desc(scheduledActions.runAfter))
      .limit(input.limit);
  }

  /** Guarded `pending → processing` claim for one due schedule. */
  async claimPending(
    scheduledActionId: string,
  ): Promise<ScheduledAction | undefined> {
    const rows = await this.database
      .update(scheduledActions)
      .set({ status: "processing" })
      .where(
        and(
          eq(scheduledActions.id, scheduledActionId),
          eq(scheduledActions.status, "pending"),
        ),
      )
      .returning();
    return rows[0];
  }

  async markDone(scheduledActionId: string): Promise<void> {
    await this.database
      .update(scheduledActions)
      .set({ status: "done", lastError: null })
      .where(eq(scheduledActions.id, scheduledActionId));
  }

  /** Return a failed schedule to `pending` so the queue's retry can reclaim it. */
  async releaseAfterFailure(input: {
    scheduledActionId: string;
    attempts: number;
    lastError: string;
  }): Promise<void> {
    await this.database
      .update(scheduledActions)
      .set({
        status: "pending",
        attempts: input.attempts,
        lastError: input.lastError,
      })
      .where(eq(scheduledActions.id, input.scheduledActionId));
  }
}

export const scheduledActionRepository = new ScheduledActionRepository();
