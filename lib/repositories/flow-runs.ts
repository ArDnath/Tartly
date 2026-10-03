import "server-only";

import { and, desc, eq, gte, sql } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { flowRuns } from "@/lib/db/schema";

/** Persistence for `flow_runs`; start-of-run bookkeeping and metrics counts. */

export type FlowRun = typeof flowRuns.$inferSelect;
export type NewFlowRun = typeof flowRuns.$inferInsert;

export class FlowRunRepository {
  constructor(private readonly database: Database = db) {}

  async insert(values: NewFlowRun): Promise<void> {
    await this.database.insert(flowRuns).values(values);
  }

  async findByIdForUser(
    userId: string,
    runId: string,
  ): Promise<FlowRun | undefined> {
    const rows = await this.database
      .select()
      .from(flowRuns)
      .where(and(eq(flowRuns.id, runId), eq(flowRuns.userId, userId)))
      .limit(1);
    return rows[0];
  }

  /**
   * A user's runs, newest first, keyset-paginated on `(startedAt, id)`.
   * `startedAt` is `NOT NULL`, so the cursor needs no null handling.
   */
  async listForUser(input: {
    userId: string;
    limit: number;
    after?: { startedAt: Date; id: string };
  }): Promise<FlowRun[]> {
    const conditions = [eq(flowRuns.userId, input.userId)];
    if (input.after) {
      conditions.push(
        sql`(${flowRuns.startedAt}, ${flowRuns.id}) < (${input.after.startedAt}::timestamptz, ${input.after.id})`,
      );
    }
    return this.database
      .select()
      .from(flowRuns)
      .where(and(...conditions))
      .orderBy(desc(flowRuns.startedAt), desc(flowRuns.id))
      .limit(input.limit);
  }

  async countStartedSince(userId: string, since: Date): Promise<number> {
    const rows = await this.database
      .select({ n: sql<number>`count(*)::int` })
      .from(flowRuns)
      .where(
        and(eq(flowRuns.userId, userId), gte(flowRuns.startedAt, since)),
      );
    return rows[0]?.n ?? 0;
  }
}

export const flowRunRepository = new FlowRunRepository();
