import "server-only";

import { and, eq, gte, like, lt, sql } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { sendLedger } from "@/lib/db/schema";

/** Persistence for the `send_ledger`; the metrics board counts commitment nudges. */

export class SendLedgerRepository {
  constructor(private readonly database: Database = db) {}

  /** Commitment nudge drafts prepared in the window. */
  async countCommitmentNudgesSince(
    userId: string,
    since: Date,
  ): Promise<number> {
    const rows = await this.database
      .select({ n: sql<number>`count(*)::int` })
      .from(sendLedger)
      .where(
        and(
          eq(sendLedger.userId, userId),
          like(sendLedger.idempotencyKey, "commitment:%"),
          gte(sendLedger.createdAt, since),
        ),
      );
    return rows[0]?.n ?? 0;
  }

  /**
   * Claim an idempotency key for a draft-only side effect. Returns the new id
   * when this caller won, or undefined when the key was already claimed.
   */
  async claimDraft(input: {
    id: string;
    userId: string;
    idempotencyKey: string;
    seq: number;
  }): Promise<string | undefined> {
    const claimed = await this.database
      .insert(sendLedger)
      .values({
        id: input.id,
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
        status: "drafted",
        seq: input.seq,
      })
      .onConflictDoNothing({ target: sendLedger.idempotencyKey })
      .returning({ id: sendLedger.id });
    return claimed[0]?.id;
  }

  /** Deletes ledger rows older than `cutoff` (send-idempotency retention). */
  async deleteBefore(cutoff: Date): Promise<number> {
    const deleted = await this.database
      .delete(sendLedger)
      .where(lt(sendLedger.createdAt, cutoff))
      .returning({ id: sendLedger.id });
    return deleted.length;
  }
}

export const sendLedgerRepository = new SendLedgerRepository();
