import "server-only";

import { asc, eq } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { flowCheckpoints, flowRuns, type TraceEntry } from "@/lib/db/schema";

/** Persistence for flow-run bookkeeping: node checkpoints and run completion. */

export type FlowCheckpoint = typeof flowCheckpoints.$inferSelect;
export type NewFlowCheckpoint = typeof flowCheckpoints.$inferInsert;
export type FlowRun = typeof flowRuns.$inferSelect;

export class EnginePersistenceRepository {
  constructor(private readonly database: Database = db) {}

  async insertCheckpoint(values: NewFlowCheckpoint): Promise<void> {
    await this.database.insert(flowCheckpoints).values(values);
  }

  /**
   * Journal entries for one run. The runtime sorts by the record's `seq`; the
   * timestamp/id order keeps legacy rows (which have no seq) stable.
   */
  async listCheckpoints(runId: string): Promise<FlowCheckpoint[]> {
    return this.database
      .select()
      .from(flowCheckpoints)
      .where(eq(flowCheckpoints.runId, runId))
      .orderBy(asc(flowCheckpoints.createdAt), asc(flowCheckpoints.id));
  }

  async finishRun(input: {
    runId: string;
    status: "completed" | "failed";
    state: Record<string, unknown>;
    trace: TraceEntry[];
    error: { message: string; nodeId: string; code?: string } | null;
    finishedAt: Date;
  }): Promise<void> {
    await this.database
      .update(flowRuns)
      .set({
        status: input.status,
        state: input.state,
        trace: input.trace,
        error: input.error,
        finishedAt: input.finishedAt,
      })
      .where(eq(flowRuns.id, input.runId));
  }
}

export const enginePersistenceRepository = new EnginePersistenceRepository();
