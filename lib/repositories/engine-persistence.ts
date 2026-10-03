import "server-only";

import { eq } from "drizzle-orm";

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

  async finishRun(input: {
    runId: string;
    status: "completed" | "failed";
    state: Record<string, unknown>;
    trace: TraceEntry[];
    error: { message: string; nodeId: string } | null;
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
