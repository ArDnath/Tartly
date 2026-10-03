import "server-only";

import { and, asc, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { pendingActions, type PendingActionStatus } from "@/lib/db/schema";

/**
 * Persistence for the `pending_actions` confirmation state machine.
 *
 * One method = one atomic storage operation (SKILL §1.1). The guarded
 * `PENDING → EXECUTING`/`CANCELLED` transitions live here because they are
 * *storage* invariants: the same conditional UPDATE that decides the race is
 * also what makes the state machine safe. Business rules (TTL, hashes, error
 * mapping) stay in `ActionService`.
 */

export type PendingAction = typeof pendingActions.$inferSelect;
export type NewPendingAction = typeof pendingActions.$inferInsert;
export type { PendingActionStatus };

export class PendingActionRepository {
  constructor(private readonly database: Database = db) {}

  /** Count of unexpired PENDING actions, used to cap the outstanding queue. */
  async countOutstanding(userId: string, now: Date): Promise<number> {
    const rows = await this.database
      .select({ count: sql<number>`count(*)::int` })
      .from(pendingActions)
      .where(
        and(
          eq(pendingActions.userId, userId),
          eq(pendingActions.status, "PENDING"),
          gt(pendingActions.expiresAt, now),
        ),
      );
    return rows[0]?.count ?? 0;
  }

  async insert(values: NewPendingAction): Promise<PendingAction> {
    const rows = await this.database
      .insert(pendingActions)
      .values(values)
      .returning();
    return rows[0]!;
  }

  /** Owner-scoped read; never returns another user's action. */
  async findByIdForUser(
    userId: string,
    actionId: string,
  ): Promise<PendingAction | undefined> {
    const rows = await this.database
      .select()
      .from(pendingActions)
      .where(
        and(
          eq(pendingActions.id, actionId),
          eq(pendingActions.userId, userId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async listForUser(input: {
    userId: string;
    status?: PendingActionStatus;
    /** Keyset position; returns rows strictly after this cursor. */
    after?: { createdAt: Date; id: string };
    limit: number;
  }): Promise<PendingAction[]> {
    const conditions = [eq(pendingActions.userId, input.userId)];
    if (input.status) conditions.push(eq(pendingActions.status, input.status));
    if (input.after) {
      conditions.push(
        sql`(${pendingActions.createdAt}, ${pendingActions.id}) < (${input.after.createdAt}::timestamptz, ${input.after.id})`,
      );
    }
    return this.database
      .select()
      .from(pendingActions)
      .where(and(...conditions))
      .orderBy(desc(pendingActions.createdAt), desc(pendingActions.id))
      .limit(input.limit);
  }

  async listUpdatedSince(input: {
    userId: string;
    since: Date;
    limit: number;
  }): Promise<PendingAction[]> {
    return this.database
      .select()
      .from(pendingActions)
      .where(
        and(
          eq(pendingActions.userId, input.userId),
          gt(pendingActions.updatedAt, input.since),
        ),
      )
      .orderBy(asc(pendingActions.updatedAt))
      .limit(input.limit);
  }

  /**
   * Batched form for the shared realtime poller: one query covers every
   * connected user, so the DB poll rate tracks the instance count, not the
   * number of open tabs.
   */
  async listUpdatedSinceMany(input: {
    userIds: string[];
    since: Date;
    limit: number;
  }): Promise<PendingAction[]> {
    if (input.userIds.length === 0) return [];
    return this.database
      .select()
      .from(pendingActions)
      .where(
        and(
          inArray(pendingActions.userId, input.userIds),
          gt(pendingActions.updatedAt, input.since),
        ),
      )
      .orderBy(asc(pendingActions.updatedAt))
      .limit(input.limit);
  }

  /** Guarded `PENDING → EXECUTING` claim; only one caller can win. */
  async claimPending(input: {
    userId: string;
    actionId: string;
    now: Date;
  }): Promise<PendingAction | undefined> {
    const rows = await this.database
      .update(pendingActions)
      .set({ status: "EXECUTING", confirmedAt: input.now, updatedAt: input.now })
      .where(
        and(
          eq(pendingActions.id, input.actionId),
          eq(pendingActions.userId, input.userId),
          eq(pendingActions.status, "PENDING"),
          gt(pendingActions.expiresAt, input.now),
        ),
      )
      .returning();
    return rows[0];
  }

  async markSucceeded(input: {
    actionId: string;
    result: Record<string, unknown>;
    now: Date;
  }): Promise<PendingAction | undefined> {
    const rows = await this.database
      .update(pendingActions)
      .set({
        status: "SUCCEEDED",
        result: input.result,
        executedAt: input.now,
        updatedAt: input.now,
        lastError: null,
      })
      .where(eq(pendingActions.id, input.actionId))
      .returning();
    return rows[0];
  }

  async markFailed(input: {
    actionId: string;
    lastError: string;
    now: Date;
  }): Promise<void> {
    await this.database
      .update(pendingActions)
      .set({
        status: "FAILED",
        lastError: input.lastError,
        executedAt: input.now,
        updatedAt: input.now,
      })
      .where(eq(pendingActions.id, input.actionId));
  }

  /** Guarded cancel; only an unexpired PENDING action can be cancelled. */
  async markCancelled(input: {
    userId: string;
    actionId: string;
    now: Date;
  }): Promise<PendingAction | undefined> {
    const rows = await this.database
      .update(pendingActions)
      .set({ status: "CANCELLED", updatedAt: input.now })
      .where(
        and(
          eq(pendingActions.id, input.actionId),
          eq(pendingActions.userId, input.userId),
          eq(pendingActions.status, "PENDING"),
          gt(pendingActions.expiresAt, input.now),
        ),
      )
      .returning();
    return rows[0];
  }

  /** Owner-scoped, still-PENDING expiry used by the confirm path. */
  async markExpiredOwned(input: {
    userId: string;
    actionId: string;
    now: Date;
  }): Promise<void> {
    await this.database
      .update(pendingActions)
      .set({ status: "EXPIRED", updatedAt: input.now })
      .where(
        and(
          eq(pendingActions.id, input.actionId),
          eq(pendingActions.userId, input.userId),
          eq(pendingActions.status, "PENDING"),
        ),
      );
  }

  async listExpiredIds(input: {
    now: Date;
    limit: number;
  }): Promise<string[]> {
    const rows = await this.database
      .select({ id: pendingActions.id })
      .from(pendingActions)
      .where(
        and(
          eq(pendingActions.status, "PENDING"),
          lte(pendingActions.expiresAt, input.now),
        ),
      )
      .limit(input.limit);
    return rows.map((row) => row.id);
  }

  async markExpiredByIds(ids: string[], now: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.database
      .update(pendingActions)
      .set({ status: "EXPIRED", updatedAt: now })
      .where(inArray(pendingActions.id, ids));
  }
}

export const pendingActionRepository = new PendingActionRepository();
