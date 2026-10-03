import "server-only";

import { eq } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { sendLedger } from "@/lib/db/schema";

/** Persistence for the outbound `send_ledger` idempotency rows. */

export type SendLedger = typeof sendLedger.$inferSelect;
export type NewSendLedger = typeof sendLedger.$inferInsert;

export class GmailSendLedgerRepository {
  constructor(private readonly database: Database = db) {}

  /** Claims an idempotency key, or returns undefined when already claimed. */
  async claim(values: NewSendLedger): Promise<SendLedger | undefined> {
    const inserted = await this.database
      .insert(sendLedger)
      .values(values)
      .onConflictDoNothing({ target: sendLedger.idempotencyKey })
      .returning();
    return inserted[0];
  }

  async findStatus(idempotencyKey: string): Promise<string | undefined> {
    const rows = await this.database
      .select({ status: sendLedger.status })
      .from(sendLedger)
      .where(eq(sendLedger.idempotencyKey, idempotencyKey))
      .limit(1);
    return rows[0]?.status;
  }

  async updateStatus(idempotencyKey: string, status: string): Promise<void> {
    await this.database
      .update(sendLedger)
      .set({ status })
      .where(eq(sendLedger.idempotencyKey, idempotencyKey));
  }
}

export const gmailSendLedgerRepository = new GmailSendLedgerRepository();
