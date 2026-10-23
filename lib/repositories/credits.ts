import "server-only";

import { desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db, type Database } from "@/lib/db";
import {
  creditLedger,
  creditPurchases,
  creditWallets,
  type CreditLedgerReason,
} from "@/lib/db/schema";

/**
 * Persistence for the credit system: the materialized wallet, the append-only
 * ledger, and one-time purchase records.
 *
 * Every mutation runs in a transaction and, when an `idempotencyKey` is given,
 * inserts the ledger row first; a conflicting key aborts the whole thing so a
 * redelivered webhook can never double-grant. A spend floors the balance at 0.
 */

export type CreditWallet = typeof creditWallets.$inferSelect;
export type CreditLedgerRow = typeof creditLedger.$inferSelect;
export type CreditPurchase = typeof creditPurchases.$inferSelect;

export type ApplyDeltaInput = {
  userId: string;
  /** Signed: positive grants, negative spends. */
  delta: number;
  reason: CreditLedgerReason;
  /** Unique for grant/refund; makes redelivery a no-op. */
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type ApplyDeltaResult = {
  applied: boolean;
  balance: number;
};

export class CreditRepository {
  constructor(private readonly database: Database = db) {}

  async ensureWallet(userId: string): Promise<CreditWallet> {
    const inserted = await this.database
      .insert(creditWallets)
      .values({ userId })
      .onConflictDoNothing({ target: creditWallets.userId })
      .returning();
    if (inserted[0]) return inserted[0];
    const existing = await this.getWallet(userId);
    if (!existing) throw new Error("credit wallet could not be created");
    return existing;
  }

  async getWallet(userId: string): Promise<CreditWallet | undefined> {
    const rows = await this.database
      .select()
      .from(creditWallets)
      .where(eq(creditWallets.userId, userId))
      .limit(1);
    return rows[0];
  }

  /** Fast balance read; `0` before the wallet exists. */
  async getBalance(userId: string): Promise<number> {
    const rows = await this.database
      .select({ balance: creditWallets.balance })
      .from(creditWallets)
      .where(eq(creditWallets.userId, userId))
      .limit(1);
    return rows[0]?.balance ?? 0;
  }

  /**
   * Apply one signed movement atomically. Returns `applied: false` when the
   * idempotency key was already used (the balance is returned untouched).
   */
  async applyDelta(input: ApplyDeltaInput): Promise<ApplyDeltaResult> {
    const id = `cl_${nanoid()}`;
    return this.database.transaction(async (tx) => {
      if (input.idempotencyKey) {
        const inserted = await tx
          .insert(creditLedger)
          .values({
            id,
            userId: input.userId,
            delta: input.delta,
            reason: input.reason,
            balanceAfter: 0,
            idempotencyKey: input.idempotencyKey,
            metadata: input.metadata ?? null,
          })
          .onConflictDoNothing({ target: creditLedger.idempotencyKey })
          .returning({ id: creditLedger.id });
        if (inserted.length === 0) {
          const wallet = await tx
            .select({ balance: creditWallets.balance })
            .from(creditWallets)
            .where(eq(creditWallets.userId, input.userId))
            .limit(1);
          return { applied: false, balance: wallet[0]?.balance ?? 0 };
        }
      } else {
        await tx.insert(creditLedger).values({
          id,
          userId: input.userId,
          delta: input.delta,
          reason: input.reason,
          balanceAfter: 0,
          idempotencyKey: null,
          metadata: input.metadata ?? null,
        });
      }

      await tx
        .insert(creditWallets)
        .values({
          userId: input.userId,
          balance: Math.max(0, input.delta),
          lifetimeGranted: input.delta > 0 ? input.delta : 0,
          lifetimeSpent: input.delta < 0 ? -input.delta : 0,
        })
        .onConflictDoUpdate({
          target: creditWallets.userId,
          set: {
            balance: sql`GREATEST(${creditWallets.balance} + ${input.delta}, 0)`,
            lifetimeGranted:
              input.delta > 0
                ? sql`${creditWallets.lifetimeGranted} + ${input.delta}`
                : creditWallets.lifetimeGranted,
            lifetimeSpent:
              input.delta < 0
                ? sql`${creditWallets.lifetimeSpent} + ${-input.delta}`
                : creditWallets.lifetimeSpent,
            updatedAt: new Date(),
          },
        });

      const wallet = await tx
        .select({ balance: creditWallets.balance })
        .from(creditWallets)
        .where(eq(creditWallets.userId, input.userId))
        .limit(1);
      const balance = wallet[0]?.balance ?? 0;
      await tx
        .update(creditLedger)
        .set({ balanceAfter: balance })
        .where(eq(creditLedger.id, id));
      return { applied: true, balance };
    });
  }

  async listLedger(userId: string, limit = 25): Promise<CreditLedgerRow[]> {
    return this.database
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.userId, userId))
      .orderBy(desc(creditLedger.createdAt))
      .limit(limit);
  }

  /** Insert a purchase record once. Returns `true` when it was new. */
  async recordPurchase(input: {
    userId: string;
    dodoPaymentId: string;
    packId: string;
    usdCents: number;
    credits: number;
  }): Promise<boolean> {
    const inserted = await this.database
      .insert(creditPurchases)
      .values({ id: `cp_${nanoid()}`, status: "completed", ...input })
      .onConflictDoNothing({ target: creditPurchases.dodoPaymentId })
      .returning({ id: creditPurchases.id });
    return inserted.length > 0;
  }

  async findPurchaseByPaymentId(
    dodoPaymentId: string,
  ): Promise<CreditPurchase | undefined> {
    const rows = await this.database
      .select()
      .from(creditPurchases)
      .where(eq(creditPurchases.dodoPaymentId, dodoPaymentId))
      .limit(1);
    return rows[0];
  }

  /** Newest-first one-time purchases, for the billing history view. */
  async listPurchases(
    userId: string,
    limit = 25,
  ): Promise<CreditPurchase[]> {
    return this.database
      .select()
      .from(creditPurchases)
      .where(eq(creditPurchases.userId, userId))
      .orderBy(desc(creditPurchases.createdAt))
      .limit(limit);
  }
}

export const creditRepository = new CreditRepository();
