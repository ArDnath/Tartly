import "server-only";

import { eq } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { assistantSettings } from "@/lib/db/schema";

/**
 * Persistence for the per-user `assistant_settings` row (SKILL §1.1).
 *
 * Field defaults, normalisation and DTO shaping stay in
 * `lib/ai/features/draft-context.ts`; the repository takes the exact insert /
 * update payloads so behaviour is byte-for-byte preserved.
 */

export type AssistantSettings = typeof assistantSettings.$inferSelect;
export type NewAssistantSettings = typeof assistantSettings.$inferInsert;

export class AssistantSettingsRepository {
  constructor(private readonly database: Database = db) {}

  async findByUser(userId: string): Promise<AssistantSettings | undefined> {
    const rows = await this.database
      .select()
      .from(assistantSettings)
      .where(eq(assistantSettings.userId, userId))
      .limit(1);
    return rows[0];
  }

  async findStyleAnalyzedAt(
    userId: string,
  ): Promise<{ analyzedAt: Date | null } | undefined> {
    const rows = await this.database
      .select({ analyzedAt: assistantSettings.styleAnalyzedAt })
      .from(assistantSettings)
      .where(eq(assistantSettings.userId, userId))
      .limit(1);
    return rows[0];
  }

  /** Insert-or-update with explicit payloads; the caller owns the defaults. */
  async upsert(input: {
    values: NewAssistantSettings;
    set: Partial<NewAssistantSettings>;
  }): Promise<void> {
    await this.database
      .insert(assistantSettings)
      .values(input.values)
      .onConflictDoUpdate({
        target: assistantSettings.userId,
        set: input.set,
      });
  }

  /** Upsert just the learned writing-style fields (style refresh path). */
  async upsertStyle(input: {
    userId: string;
    style: AssistantSettings["writingStyle"];
    learnedWritingStyle: string;
    styleVersion: number;
    analyzedAt: Date;
  }): Promise<void> {
    await this.database
      .insert(assistantSettings)
      .values({
        userId: input.userId,
        writingStyle: input.style,
        learnedWritingStyle: input.learnedWritingStyle,
        styleVersion: input.styleVersion,
        styleAnalyzedAt: input.analyzedAt,
      })
      .onConflictDoUpdate({
        target: assistantSettings.userId,
        set: {
          writingStyle: input.style,
          learnedWritingStyle: input.learnedWritingStyle,
          styleVersion: input.styleVersion,
          styleAnalyzedAt: input.analyzedAt,
          updatedAt: input.analyzedAt,
        },
      });
  }
}

export const assistantSettingsRepository = new AssistantSettingsRepository();
