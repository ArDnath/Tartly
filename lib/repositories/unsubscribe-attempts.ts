import "server-only";

import { db, type Database } from "@/lib/db";
import { unsubscribeAttempts } from "@/lib/db/schema";

/**
 * Persistence for the bulk-unsubscribe audit log (`unsubscribe_attempts`)
 * (SKILL §1.1). One method = one atomic storage operation; mechanism selection
 * and the HTTP call stay in `lib/ai/features/unsubscribe.ts`.
 */

export type NewUnsubscribeAttempt = typeof unsubscribeAttempts.$inferInsert;

export class UnsubscribeAttemptRepository {
  constructor(private readonly database: Database = db) {}

  async insert(values: NewUnsubscribeAttempt): Promise<void> {
    await this.database.insert(unsubscribeAttempts).values(values);
  }
}

export const unsubscribeAttemptRepository = new UnsubscribeAttemptRepository();
