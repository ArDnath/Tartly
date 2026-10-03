import "server-only";

import { eq } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { drafts } from "@/lib/db/schema";

/** Persistence for engine-generated drafts (the draft-reply step). */

export type EngineDraft = typeof drafts.$inferSelect;
export type NewEngineDraft = typeof drafts.$inferInsert;

export class EngineDraftRepository {
  constructor(private readonly database: Database = db) {}

  /** Refreshes a pending draft in place: one pending draft per thread. */
  async updatePending(input: {
    draftId: string;
    body: string;
    runId: string;
    editedBody: string | null;
    confidence: string | null;
    suppressed: boolean;
    pipelineVersion: string | null;
  }): Promise<void> {
    await this.database
      .update(drafts)
      .set({
        body: input.body,
        runId: input.runId,
        editedBody: input.editedBody,
        confidence: input.confidence,
        suppressed: input.suppressed,
        pipelineVersion: input.pipelineVersion,
      })
      .where(eq(drafts.id, input.draftId));
  }

  async insert(values: NewEngineDraft): Promise<void> {
    await this.database.insert(drafts).values(values);
  }
}

export const engineDraftRepository = new EngineDraftRepository();
