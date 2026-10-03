import "server-only";

import { and, count, desc, eq, inArray } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import {
  senderProfiles,
  type SenderCategory,
  type SenderProfileStatus,
} from "@/lib/db/schema";

/** Persistence for `sender_profiles` (sender intelligence read model). */

export type SenderProfile = typeof senderProfiles.$inferSelect;
export type NewSenderProfile = typeof senderProfiles.$inferInsert;

export class SenderProfileRepository {
  constructor(private readonly database: Database = db) {}

  async listByEmails(
    userId: string,
    emails: string[],
  ): Promise<
    Array<{ email: string; category: string; coldEmailScore: number }>
  > {
    if (emails.length === 0) return [];
    return this.database
      .select({
        email: senderProfiles.email,
        category: senderProfiles.category,
        coldEmailScore: senderProfiles.coldEmailScore,
      })
      .from(senderProfiles)
      .where(
        and(
          eq(senderProfiles.userId, userId),
          inArray(senderProfiles.email, emails),
        ),
      );
  }

  async findByEmail(
    userId: string,
    email: string,
  ): Promise<SenderProfile | undefined> {
    const rows = await this.database
      .select()
      .from(senderProfiles)
      .where(
        and(
          eq(senderProfiles.userId, userId),
          eq(senderProfiles.email, email.toLowerCase()),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async list(input: {
    userId: string;
    status?: SenderProfileStatus;
    limit: number;
  }): Promise<SenderProfile[]> {
    const conditions = [eq(senderProfiles.userId, input.userId)];
    if (input.status) conditions.push(eq(senderProfiles.status, input.status));
    return this.database
      .select()
      .from(senderProfiles)
      .where(and(...conditions))
      .orderBy(desc(senderProfiles.lastSeenAt))
      .limit(input.limit);
  }

  /**
   * Insert-or-update with explicit payloads. The caller owns defaults and the
   * "never downgrade `modelEnriched`" rule, so the storage layer stays dumb.
   */
  async upsert(input: {
    values: NewSenderProfile;
    set: Partial<NewSenderProfile>;
  }): Promise<SenderProfile> {
    const inserted = await this.database
      .insert(senderProfiles)
      .values(input.values)
      .onConflictDoUpdate({
        target: [senderProfiles.userId, senderProfiles.email],
        set: input.set,
      })
      .returning();
    return inserted[0]!;
  }

  async setStatus(input: {
    userId: string;
    id: string;
    status: SenderProfileStatus;
    now: Date;
  }): Promise<boolean> {
    const updated = await this.database
      .update(senderProfiles)
      .set({ status: input.status, updatedAt: input.now })
      .where(
        and(
          eq(senderProfiles.id, input.id),
          eq(senderProfiles.userId, input.userId),
        ),
      )
      .returning({ id: senderProfiles.id });
    return updated.length > 0;
  }

  async deleteOwned(input: { userId: string; id: string }): Promise<boolean> {
    const deleted = await this.database
      .delete(senderProfiles)
      .where(
        and(
          eq(senderProfiles.id, input.id),
          eq(senderProfiles.userId, input.userId),
        ),
      )
      .returning({ id: senderProfiles.id });
    return deleted.length > 0;
  }

  async countByCategory(
    userId: string,
  ): Promise<Array<{ category: SenderCategory; total: number }>> {
    const rows = await this.database
      .select({ category: senderProfiles.category, total: count() })
      .from(senderProfiles)
      .where(eq(senderProfiles.userId, userId))
      .groupBy(senderProfiles.category);
    return rows.map((row) => ({
      category: row.category,
      total: Number(row.total),
    }));
  }

  /** Emails whose stored category is one of `categories` (noise accounting). */
  async listEmailsByCategories(
    userId: string,
    categories: SenderCategory[],
  ): Promise<string[]> {
    if (categories.length === 0) return [];
    const rows = await this.database
      .select({ email: senderProfiles.email })
      .from(senderProfiles)
      .where(
        and(
          eq(senderProfiles.userId, userId),
          inArray(senderProfiles.category, categories),
        ),
      );
    return rows.map((row) => row.email);
  }

  /** Remember the unsubscribe mechanism we acted on for a sender. */
  async setUnsubscribe(input: {
    userId: string;
    email: string;
    url: string | null;
    method: string;
    now: Date;
  }): Promise<void> {
    await this.database
      .update(senderProfiles)
      .set({
        unsubscribeUrl: input.url,
        unsubscribeMethod: input.method,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(senderProfiles.userId, input.userId),
          eq(senderProfiles.email, input.email.toLowerCase()),
        ),
      );
  }
}

export const senderProfileRepository = new SenderProfileRepository();
