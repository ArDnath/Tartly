import "server-only";

import { db, type Database } from "@/lib/db";
import { threadStates } from "@/lib/db/schema";

/** Persistence for `thread_states` upserts written by engine steps. */

export type EngineThreadState = typeof threadStates.$inferSelect;
export type NewThreadState = typeof threadStates.$inferInsert;

export class EngineThreadStateRepository {
  constructor(private readonly database: Database = db) {}

  /** Insert-or-update the single state row for a thread. */
  async upsert(input: {
    values: NewThreadState;
    set: Partial<NewThreadState>;
  }): Promise<void> {
    await this.database
      .insert(threadStates)
      .values(input.values)
      .onConflictDoUpdate({ target: threadStates.threadId, set: input.set });
  }
}

export const engineThreadStateRepository = new EngineThreadStateRepository();
