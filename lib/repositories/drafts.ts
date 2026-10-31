import "server-only";

import {
  and,
  desc,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNotNull,
  notExists,
  sql,
} from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { drafts, mailboxes, messages, threads } from "@/lib/db/schema";

/** Persistence for AI/user `drafts`, plus the count queries the metrics board reads. */

export type Draft = typeof drafts.$inferSelect;
export type NewDraft = typeof drafts.$inferInsert;

export class DraftRepository {
  constructor(private readonly database: Database = db) {}

  /** Threads that have a visible (non-suppressed) pending draft. */
  async listPendingThreadIds(threadIds: string[]): Promise<string[]> {
    if (threadIds.length === 0) return [];
    const rows = await this.database
      .select({ threadId: drafts.threadId })
      .from(drafts)
      .where(
        and(
          inArray(drafts.threadId, threadIds),
          eq(drafts.status, "pending"),
          // A draft below the user's confidence threshold is stored but hidden.
          eq(drafts.suppressed, false),
        ),
      );
    return rows.map((row) => row.threadId);
  }

  /**
   * AI-sent drafts whose thread recorded no outbound mirror within 15 minutes of
   * the decision — the send-succeeded-but-mirror-write-didn't drift signature
   * (F-14/G-11). Bounded; returns draft ids only, never content.
   */
  async listAiSentWithoutMirror(
    userId: string,
    limit = 200,
  ): Promise<string[]> {
    const rows = await this.database
      .select({ id: drafts.id })
      .from(drafts)
      .where(
        and(
          eq(drafts.userId, userId),
          eq(drafts.sentBy, "ai"),
          eq(drafts.status, "sent"),
          isNotNull(drafts.decidedAt),
          notExists(
            this.database
              .select({ one: sql`1` })
              .from(messages)
              .where(
                and(
                  eq(messages.threadId, drafts.threadId),
                  eq(messages.direction, "outbound"),
                  sql`${messages.sentAt} between ${drafts.decidedAt} - interval '15 minutes' and ${drafts.decidedAt} + interval '15 minutes'`,
                ),
              ),
          ),
          // Outlook sends do not return a message id to mirror, so this drift
          // check is Gmail-only rather than reporting every Outlook send.
          notExists(
            this.database
              .select({ one: sql`1` })
              .from(threads)
              .innerJoin(mailboxes, eq(mailboxes.id, threads.mailboxId))
              .where(
                and(
                  eq(threads.id, drafts.threadId),
                  eq(mailboxes.provider, "microsoft"),
                ),
              ),
          ),
        ),
      )
      .limit(limit);
    return rows.map((row) => row.id);
  }

  /**
   * Pending drafts whose thread received inbound mail after the draft was
   * created (the draft may no longer reflect the conversation). Bounded;
   * returns draft ids only.
   */
  async listStalePending(userId: string, limit = 200): Promise<string[]> {
    const rows = await this.database
      .select({ id: drafts.id })
      .from(drafts)
      .where(
        and(
          eq(drafts.userId, userId),
          eq(drafts.status, "pending"),
          exists(
            this.database
              .select({ one: sql`1` })
              .from(messages)
              .where(
                and(
                  eq(messages.threadId, drafts.threadId),
                  eq(messages.direction, "inbound"),
                  gt(messages.sentAt, drafts.createdAt),
                ),
              ),
          ),
        ),
      )
      .limit(limit);
    return rows.map((row) => row.id);
  }

  /** The actionable pending draft for one thread, newest first. */
  async findPendingByThread(threadId: string): Promise<Draft | undefined> {
    const rows = await this.database
      .select()
      .from(drafts)
      .where(
        and(
          eq(drafts.threadId, threadId),
          eq(drafts.status, "pending"),
          eq(drafts.suppressed, false),
        ),
      )
      .orderBy(desc(drafts.createdAt))
      .limit(1);
    return rows[0];
  }

  /**
   * Any pending draft for a thread, including suppressed ones. Automation
   * refreshes an existing pending draft in place rather than stacking a second
   * one, so a hidden draft is still the row to update.
   */
  async findAnyPendingByThread(threadId: string): Promise<Draft | undefined> {
    const rows = await this.database
      .select()
      .from(drafts)
      .where(and(eq(drafts.threadId, threadId), eq(drafts.status, "pending")))
      .limit(1);
    return rows[0];
  }

  /** Refreshes the generated body of an existing draft. */
  async updateBodyById(input: {
    draftId: string;
    body: string;
    pipelineVersion?: string | null;
  }): Promise<void> {
    await this.database
      .update(drafts)
      .set({
        body: input.body,
        ...(input.pipelineVersion !== undefined
          ? { pipelineVersion: input.pipelineVersion }
          : {}),
      })
      .where(eq(drafts.id, input.draftId));
  }

  async insert(values: NewDraft): Promise<Draft> {
    const rows = await this.database
      .insert(drafts)
      .values(values)
      .returning();
    return rows[0]!;
  }

  async findByIdForUser(
    userId: string,
    draftId: string,
  ): Promise<Draft | undefined> {
    const rows = await this.database
      .select()
      .from(drafts)
      .where(and(eq(drafts.id, draftId), eq(drafts.userId, userId)))
      .limit(1);
    return rows[0];
  }

  async markSent(input: {
    draftId: string;
    sentBy: "user" | "ai";
    editedBody?: string | null;
    decidedAt: Date;
  }): Promise<void> {
    await this.database
      .update(drafts)
      .set({
        status: "sent",
        sentBy: input.sentBy,
        ...(input.editedBody !== undefined
          ? { editedBody: input.editedBody }
          : {}),
        decidedAt: input.decidedAt,
      })
      .where(eq(drafts.id, input.draftId));
  }

  /** Owner-scoped discard; returns false when nothing matching was updated. */
  async discardForUser(input: {
    userId: string;
    draftId: string;
    now: Date;
  }): Promise<boolean> {
    const updated = await this.database
      .update(drafts)
      .set({ status: "discarded", decidedAt: input.now })
      .where(and(eq(drafts.id, input.draftId), eq(drafts.userId, input.userId)))
      .returning({ id: drafts.id });
    return updated.length > 0;
  }

  async countCreatedSince(userId: string, since: Date): Promise<number> {
    return this.countSince(
      and(eq(drafts.userId, userId), gte(drafts.createdAt, since)),
    );
  }

  async countSentSince(userId: string, since: Date): Promise<number> {
    return this.countSince(
      and(
        eq(drafts.userId, userId),
        eq(drafts.status, "sent"),
        gte(drafts.createdAt, since),
      ),
    );
  }

  /** Replies sent in the window, keyed on the decision time (report metric). */
  async countSentSinceDecided(userId: string, since: Date): Promise<number> {
    return this.countSince(
      and(
        eq(drafts.userId, userId),
        eq(drafts.status, "sent"),
        gte(drafts.decidedAt, since),
      ),
    );
  }

  /** Replies the operator sent on its own in the window ("AI handled"). */
  async countAiHandledSince(userId: string, since: Date): Promise<number> {
    return this.countSince(
      and(
        eq(drafts.userId, userId),
        eq(drafts.status, "sent"),
        eq(drafts.sentBy, "ai"),
        gte(drafts.decidedAt, since),
      ),
    );
  }

  private async countSince(
    where: ReturnType<typeof and>,
  ): Promise<number> {
    const rows = await this.database
      .select({ n: sql<number>`count(*)::int` })
      .from(drafts)
      .where(where);
    return rows[0]?.n ?? 0;
  }
}

export const draftRepository = new DraftRepository();
