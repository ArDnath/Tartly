import "server-only";

import { and, eq, isNull, lt, or } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { mailboxes } from "@/lib/db/schema";

/**
 * Persistence for connected `mailboxes`, including the Gmail watch/sync cursors.
 * Consolidates the former `gmail-persistence` mailbox methods and the unscoped
 * engine lookup so there is one owner for the table.
 */

export type Mailbox = typeof mailboxes.$inferSelect;
export type NewMailbox = typeof mailboxes.$inferInsert;

export class MailboxRepository {
  constructor(private readonly database: Database = db) {}

  async findById(mailboxId: string): Promise<Mailbox | undefined> {
    const rows = await this.database
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.id, mailboxId))
      .limit(1);
    return rows[0];
  }

  async findFirstIdForUser(
    userId: string,
  ): Promise<{ id: string } | undefined> {
    const rows = await this.database
      .select({ id: mailboxes.id })
      .from(mailboxes)
      .where(eq(mailboxes.userId, userId))
      .limit(1);
    return rows[0];
  }

  async findFirstEmailForUser(
    userId: string,
  ): Promise<string | undefined> {
    const rows = await this.database
      .select({ email: mailboxes.email })
      .from(mailboxes)
      .where(eq(mailboxes.userId, userId))
      .limit(1);
    return rows[0]?.email;
  }

  /** Creates the mailbox for a connected account, updating the cursor on retry. */
  async upsert(values: NewMailbox): Promise<Mailbox> {
    const inserted = await this.database
      .insert(mailboxes)
      .values(values)
      .onConflictDoUpdate({
        target: [mailboxes.userId, mailboxes.email],
        set: {
          ...(values.historyId ? { historyId: values.historyId } : {}),
          updatedAt: new Date(),
        },
      })
      .returning();
    return inserted[0];
  }

  async findByUser(userId: string): Promise<Mailbox | undefined> {
    const rows = await this.database
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.userId, userId))
      .limit(1);
    return rows[0];
  }

  async findByIdForUser(
    userId: string,
    mailboxId: string,
  ): Promise<Mailbox | undefined> {
    const rows = await this.database
      .select()
      .from(mailboxes)
      .where(and(eq(mailboxes.id, mailboxId), eq(mailboxes.userId, userId)))
      .limit(1);
    return rows[0];
  }

  /** Owner-scoped email lookup for engine steps. */
  async findEmailByIdForUser(input: {
    mailboxId: string;
    userId: string;
  }): Promise<string | undefined> {
    const rows = await this.database
      .select({ email: mailboxes.email })
      .from(mailboxes)
      .where(
        and(
          eq(mailboxes.id, input.mailboxId),
          eq(mailboxes.userId, input.userId),
        ),
      )
      .limit(1);
    return rows[0]?.email;
  }

  /** Resolves the mailbox a Pub/Sub notification belongs to. */
  async findByEmail(email: string): Promise<Mailbox | undefined> {
    const rows = await this.database
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.email, email.toLowerCase()))
      .limit(1);
    return rows[0];
  }

  /** Bounded set for the daily backfill: at most `limit` mailboxes. */
  async listForBackfill(
    limit: number,
  ): Promise<Array<{ id: string; userId: string }>> {
    return this.database
      .select({ id: mailboxes.id, userId: mailboxes.userId })
      .from(mailboxes)
      .limit(limit);
  }

  /** Watches missing or expiring before `cutoff`. */
  async listExpiringWatches(
    cutoff: Date,
  ): Promise<Array<{ id: string; userId: string }>> {
    return this.database
      .select({ id: mailboxes.id, userId: mailboxes.userId })
      .from(mailboxes)
      .where(
        or(
          isNull(mailboxes.watchExpiration),
          lt(mailboxes.watchExpiration, cutoff),
        ),
      );
  }

  /**
   * Watch + sync health for every connected mailbox. Small table; the caller
   * derives `ok | expiring | lapsed` and surfaces the last sync error.
   */
  async listWatchHealth(): Promise<
    Array<{
      id: string;
      userId: string;
      email: string;
      watchExpiration: Date | null;
      lastSyncedAt: Date | null;
      syncError: string | null;
    }>
  > {
    return this.database
      .select({
        id: mailboxes.id,
        userId: mailboxes.userId,
        email: mailboxes.email,
        watchExpiration: mailboxes.watchExpiration,
        lastSyncedAt: mailboxes.lastSyncedAt,
        syncError: mailboxes.syncError,
      })
      .from(mailboxes);
  }

  /** Records (or clears, with `null`) a short, content-free sync failure. */
  async updateSyncError(
    mailboxId: string,
    syncError: string | null,
  ): Promise<void> {
    await this.database
      .update(mailboxes)
      .set({ syncError })
      .where(eq(mailboxes.id, mailboxId));
  }

  async updateWatch(input: {
    mailboxId: string;
    expiration: Date | null;
    historyId?: string | null;
  }): Promise<void> {
    await this.database
      .update(mailboxes)
      .set({
        watchExpiration: input.expiration,
        ...(input.historyId ? { historyId: input.historyId } : {}),
      })
      .where(eq(mailboxes.id, input.mailboxId));
  }

  async updateSyncCursor(input: {
    mailboxId: string;
    historyId: string | null;
    lastSyncedAt: Date;
  }): Promise<void> {
    await this.database
      .update(mailboxes)
      .set({ historyId: input.historyId, lastSyncedAt: input.lastSyncedAt })
      .where(eq(mailboxes.id, input.mailboxId));
  }
}

export const mailboxRepository = new MailboxRepository();
