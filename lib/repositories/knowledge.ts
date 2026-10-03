import "server-only";

import { and, count, desc, eq } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { knowledgeEntries, snippets } from "@/lib/db/schema";

/**
 * Persistence for the assistant knowledge base (`knowledge_entries`) and
 * reusable `snippets` (SKILL §1.1).
 *
 * One method = one atomic storage operation. BM25 scoring, snippet expansion
 * and input truncation stay in `lib/ai/features/knowledge.ts`.
 */

export type KnowledgeEntry = typeof knowledgeEntries.$inferSelect;
export type NewKnowledgeEntry = typeof knowledgeEntries.$inferInsert;
export type Snippet = typeof snippets.$inferSelect;
export type NewSnippet = typeof snippets.$inferInsert;

export class KnowledgeRepository {
  constructor(private readonly database: Database = db) {}

  async listEntries(userId: string, limit: number): Promise<KnowledgeEntry[]> {
    return this.database
      .select()
      .from(knowledgeEntries)
      .where(eq(knowledgeEntries.userId, userId))
      .orderBy(desc(knowledgeEntries.updatedAt))
      .limit(limit);
  }

  async insertEntry(values: NewKnowledgeEntry): Promise<KnowledgeEntry> {
    const inserted = await this.database
      .insert(knowledgeEntries)
      .values(values)
      .returning();
    return inserted[0]!;
  }

  async updateEntry(input: {
    userId: string;
    id: string;
    title?: string;
    content?: string;
    now: Date;
  }): Promise<boolean> {
    const updated = await this.database
      .update(knowledgeEntries)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        updatedAt: input.now,
      })
      .where(
        and(
          eq(knowledgeEntries.id, input.id),
          eq(knowledgeEntries.userId, input.userId),
        ),
      )
      .returning({ id: knowledgeEntries.id });
    return updated.length > 0;
  }

  async deleteEntry(input: { userId: string; id: string }): Promise<boolean> {
    const deleted = await this.database
      .delete(knowledgeEntries)
      .where(
        and(
          eq(knowledgeEntries.id, input.id),
          eq(knowledgeEntries.userId, input.userId),
        ),
      )
      .returning({ id: knowledgeEntries.id });
    return deleted.length > 0;
  }

  async countEntries(userId: string): Promise<number> {
    const rows = await this.database
      .select({ value: count() })
      .from(knowledgeEntries)
      .where(eq(knowledgeEntries.userId, userId));
    return Number(rows[0]?.value ?? 0);
  }

  async listSnippets(userId: string, limit: number): Promise<Snippet[]> {
    return this.database
      .select()
      .from(snippets)
      .where(eq(snippets.userId, userId))
      .orderBy(desc(snippets.updatedAt))
      .limit(limit);
  }

  async insertSnippet(values: NewSnippet): Promise<Snippet> {
    const inserted = await this.database
      .insert(snippets)
      .values(values)
      .returning();
    return inserted[0]!;
  }

  async updateSnippet(input: {
    userId: string;
    id: string;
    shortcut?: string;
    content?: string;
    now: Date;
  }): Promise<boolean> {
    const updated = await this.database
      .update(snippets)
      .set({
        ...(input.shortcut !== undefined ? { shortcut: input.shortcut } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        updatedAt: input.now,
      })
      .where(and(eq(snippets.id, input.id), eq(snippets.userId, input.userId)))
      .returning({ id: snippets.id });
    return updated.length > 0;
  }

  async deleteSnippet(input: { userId: string; id: string }): Promise<boolean> {
    const deleted = await this.database
      .delete(snippets)
      .where(and(eq(snippets.id, input.id), eq(snippets.userId, input.userId)))
      .returning({ id: snippets.id });
    return deleted.length > 0;
  }

  async countSnippets(userId: string): Promise<number> {
    const rows = await this.database
      .select({ value: count() })
      .from(snippets)
      .where(eq(snippets.userId, userId));
    return Number(rows[0]?.value ?? 0);
  }
}

export const knowledgeRepository = new KnowledgeRepository();
