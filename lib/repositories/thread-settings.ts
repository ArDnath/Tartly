import "server-only";

import { and, eq } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { contacts, mailboxes, threadSettings, threads } from "@/lib/db/schema";

/**
 * Persistence for autonomy settings: the mailbox default, per-contact overrides
 * and per-thread overrides. Every method is a single storage operation; the
 * precedence ladder and normalization live in `lib/settings/autonomy.ts`.
 */

export type ThreadSettings = typeof threadSettings.$inferSelect;
export type NewThreadSettings = typeof threadSettings.$inferInsert;

export class ThreadSettingsRepository {
  constructor(private readonly database: Database = db) {}

  async findMailboxAutonomyForUser(
    userId: string,
  ): Promise<string | null | undefined> {
    const rows = await this.database
      .select({ autonomy: mailboxes.autonomy })
      .from(mailboxes)
      .where(eq(mailboxes.userId, userId))
      .limit(1);
    return rows[0]?.autonomy;
  }

  async findMailboxAutonomyById(
    mailboxId: string,
  ): Promise<string | null | undefined> {
    const rows = await this.database
      .select({ autonomy: mailboxes.autonomy })
      .from(mailboxes)
      .where(eq(mailboxes.id, mailboxId))
      .limit(1);
    return rows[0]?.autonomy;
  }

  async updateMailboxAutonomy(input: {
    userId: string;
    autonomy: string;
    now: Date;
  }): Promise<boolean> {
    const updated = await this.database
      .update(mailboxes)
      .set({ autonomy: input.autonomy, updatedAt: input.now })
      .where(eq(mailboxes.userId, input.userId))
      .returning({ id: mailboxes.id });
    return updated.length > 0;
  }

  async listContactOverridesForUser(userId: string): Promise<
    Array<{ email: string; name: string | null; override: string | null }>
  > {
    return this.database
      .select({
        email: contacts.email,
        name: contacts.name,
        override: contacts.autonomyOverride,
      })
      .from(contacts)
      .where(eq(contacts.userId, userId));
  }

  async findContactOverride(input: {
    userId: string;
    email: string;
  }): Promise<string | null | undefined> {
    const rows = await this.database
      .select({ override: contacts.autonomyOverride })
      .from(contacts)
      .where(
        and(
          eq(contacts.userId, input.userId),
          eq(contacts.email, input.email.toLowerCase()),
        ),
      )
      .limit(1);
    return rows[0]?.override;
  }

  async updateContactOverride(input: {
    userId: string;
    email: string;
    override: string | null;
    now: Date;
  }): Promise<boolean> {
    const updated = await this.database
      .update(contacts)
      .set({ autonomyOverride: input.override, updatedAt: input.now })
      .where(
        and(
          eq(contacts.userId, input.userId),
          eq(contacts.email, input.email.toLowerCase()),
        ),
      )
      .returning({ id: contacts.id });
    return updated.length > 0;
  }

  async listThreadOverridesWithSubject(userId: string): Promise<
    Array<{ threadId: string; autonomy: string | null; subject: string | null }>
  > {
    return this.database
      .select({
        threadId: threadSettings.threadId,
        autonomy: threadSettings.autonomy,
        subject: threads.subject,
      })
      .from(threadSettings)
      .leftJoin(threads, eq(threads.id, threadSettings.threadId))
      .where(eq(threadSettings.userId, userId));
  }

  async findThreadAutonomy(input: {
    userId: string;
    threadId: string;
  }): Promise<string | null | undefined> {
    const rows = await this.database
      .select({ autonomy: threadSettings.autonomy })
      .from(threadSettings)
      .where(
        and(
          eq(threadSettings.threadId, input.threadId),
          eq(threadSettings.userId, input.userId),
        ),
      )
      .limit(1);
    return rows[0]?.autonomy;
  }

  async deleteThreadAutonomy(input: {
    userId: string;
    threadId: string;
  }): Promise<void> {
    await this.database
      .delete(threadSettings)
      .where(
        and(
          eq(threadSettings.threadId, input.threadId),
          eq(threadSettings.userId, input.userId),
        ),
      );
  }

  async upsertThreadAutonomy(input: {
    threadId: string;
    userId: string;
    autonomy: string;
    now: Date;
  }): Promise<void> {
    await this.database
      .insert(threadSettings)
      .values({
        threadId: input.threadId,
        userId: input.userId,
        autonomy: input.autonomy,
      })
      .onConflictDoUpdate({
        target: threadSettings.threadId,
        set: { autonomy: input.autonomy, updatedAt: input.now },
      });
  }
}

export const threadSettingsRepository = new ThreadSettingsRepository();
