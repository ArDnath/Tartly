import "server-only";

import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import {
  messages,
  threads,
  type MessageUnsubscribeInfo,
} from "@/lib/db/schema";

/** Persistence for mirrored `messages`. */

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export type MirroredMessageInput = {
  id: string;
  threadId: string;
  gmailMessageId: string;
  direction: string;
  fromAddr: string | null;
  toAddr: string[];
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  snippet: string | null;
  unsubscribe: MessageUnsubscribeInfo | null;
  autoSubmitted?: boolean | null;
  sentAt: Date | null;
};

export class MessageRepository {
  constructor(private readonly database: Database = db) {}

  async listByThread(threadId: string): Promise<Message[]> {
    return this.database
      .select()
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(messages.sentAt);
  }

  /** The oldest `limit` messages of a thread, for bounded transcript building. */
  async listOldestByThread(threadId: string, limit: number): Promise<Message[]> {
    return this.database
      .select()
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(messages.sentAt)
      .limit(limit);
  }

  /**
   * The newest `limit` messages of a thread, returned oldest-first. Use this
   * (not `listOldestByThread`) for reply context: the engine must see the most
   * recent turn, and `latestInbound` must not fall outside the window on long
   * threads.
   */
  async listRecentByThread(threadId: string, limit: number): Promise<Message[]> {
    const rows = await this.database
      .select()
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(desc(messages.sentAt))
      .limit(limit);
    return rows.reverse();
  }

  /**
   * Only the newest message per thread feeds an inbox row. `DISTINCT ON` lets
   * Postgres return one row per thread instead of streaming the whole history
   * so JS can throw all but the last away.
   */
  async latestByThreadIds(threadIds: string[]): Promise<Message[]> {
    if (threadIds.length === 0) return [];
    return this.database
      .selectDistinctOn([messages.threadId])
      .from(messages)
      .where(inArray(messages.threadId, threadIds))
      .orderBy(messages.threadId, desc(messages.sentAt));
  }

  async latestInboundByThreadId(
    threadId: string,
  ): Promise<Message | undefined> {
    const rows = await this.database
      .select()
      .from(messages)
      .where(
        and(eq(messages.threadId, threadId), eq(messages.direction, "inbound")),
      )
      .orderBy(desc(messages.sentAt))
      .limit(1);
    return rows[0];
  }

  /** Newest message of a thread in one direction (briefing follow-up cards). */
  async latestByThreadAndDirection(
    threadId: string,
    direction: string,
  ): Promise<Message | undefined> {
    const rows = await this.database
      .select()
      .from(messages)
      .where(
        and(eq(messages.threadId, threadId), eq(messages.direction, direction)),
      )
      .orderBy(desc(messages.sentAt))
      .limit(1);
    return rows[0];
  }

  /** Which of these provider message ids are already mirrored. */
  async existingGmailMessageIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.database
      .select({ id: messages.gmailMessageId })
      .from(messages)
      .where(inArray(messages.gmailMessageId, ids));
    return new Set(rows.map((row) => row.id));
  }

  /** Idempotent mirror insert keyed on the Gmail message id. */
  async insert(values: NewMessage): Promise<void> {
    await this.database
      .insert(messages)
      .values(values)
      .onConflictDoNothing({ target: messages.gmailMessageId });
  }

  /** Idempotent message mirror keyed on the Gmail message id (upsert). */
  async upsertMirrored(
    values: MirroredMessageInput,
  ): Promise<{ id: string }> {
    const inserted = await this.database
      .insert(messages)
      .values(values)
      .onConflictDoUpdate({
        target: messages.gmailMessageId,
        set: {
          bodyText: values.bodyText,
          bodyHtml: values.bodyHtml,
          snippet: values.snippet,
          unsubscribe: values.unsubscribe,
          autoSubmitted: values.autoSubmitted ?? null,
        },
      })
      .returning({ id: messages.id });
    return inserted[0];
  }

  /**
   * The user's most recent outbound messages, newest first (writing-style
   * samples). Only rows with a stored body are returned.
   */
  async listSentSamples(input: {
    userId: string;
    limit: number;
  }): Promise<Array<{ toAddr: string[] | null; bodyText: string | null }>> {
    return this.database
      .select({ toAddr: messages.toAddr, bodyText: messages.bodyText })
      .from(messages)
      .innerJoin(threads, eq(messages.threadId, threads.id))
      .where(
        and(
          eq(threads.userId, input.userId),
          eq(messages.direction, "outbound"),
          isNotNull(messages.bodyText),
        ),
      )
      .orderBy(desc(messages.sentAt))
      .limit(input.limit);
  }

  /**
   * Latest inbound message from `email` that carried unsubscribe headers,
   * owner-scoped through the thread.
   */
  async findLatestInboundWithUnsubscribe(input: {
    userId: string;
    email: string;
  }): Promise<{ unsubscribe: unknown; gmailMessageId: string } | undefined> {
    const rows = await this.database
      .select({
        unsubscribe: messages.unsubscribe,
        gmailMessageId: messages.gmailMessageId,
      })
      .from(messages)
      .innerJoin(threads, eq(messages.threadId, threads.id))
      .where(
        and(
          eq(threads.userId, input.userId),
          eq(messages.direction, "inbound"),
          eq(messages.fromAddr, input.email),
          isNotNull(messages.unsubscribe),
        ),
      )
      .orderBy(desc(messages.sentAt))
      .limit(1);
    return rows[0];
  }

  /** Participant addresses of a thread, for attendee inference. */
  async listAddressPairsByThread(
    threadId: string,
  ): Promise<Array<{ fromAddr: string | null; toAddr: string[] | null }>> {
    return this.database
      .select({ fromAddr: messages.fromAddr, toAddr: messages.toAddr })
      .from(messages)
      .where(eq(messages.threadId, threadId));
  }

  /** Gmail ids of every message in a thread (mailbox operations). */
  async listGmailIdsByThread(threadId: string): Promise<string[]> {
    const rows = await this.database
      .select({ gmailMessageId: messages.gmailMessageId })
      .from(messages)
      .where(eq(messages.threadId, threadId));
    return rows.map((row) => row.gmailMessageId).filter(Boolean);
  }

  /** Owner-scoped Gmail ids, for actions that must not touch another tenant. */
  async listGmailIdsByThreadOwned(input: {
    userId: string;
    threadId: string;
  }): Promise<string[]> {
    const rows = await this.database
      .select({ gmailMessageId: messages.gmailMessageId })
      .from(messages)
      .innerJoin(threads, eq(messages.threadId, threads.id))
      .where(
        and(
          eq(messages.threadId, input.threadId),
          eq(threads.userId, input.userId),
        ),
      );
    return rows.map((row) => row.gmailMessageId).filter(Boolean);
  }

  /** Inbound message counts per sender in a window (report top senders). */
  async countInboundBySender(input: {
    userId: string;
    since: Date;
    limit: number;
  }): Promise<Array<{ email: string | null; n: number }>> {
    return this.database
      .select({ email: messages.fromAddr, n: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(threads, eq(threads.id, messages.threadId))
      .where(
        and(
          eq(threads.userId, input.userId),
          eq(messages.direction, "inbound"),
          gte(messages.sentAt, input.since),
        ),
      )
      .groupBy(messages.fromAddr)
      .orderBy(desc(sql`count(*)`))
      .limit(input.limit);
  }

  /** Minimal per-message rows to compute inbound→outbound response time. */
  async listWindowForResponseTime(input: {
    userId: string;
    since: Date;
  }): Promise<Array<{ threadId: string; direction: string; sentAt: Date | null }>> {
    return this.database
      .select({
        threadId: messages.threadId,
        direction: messages.direction,
        sentAt: messages.sentAt,
      })
      .from(messages)
      .innerJoin(threads, eq(threads.id, messages.threadId))
      .where(
        and(eq(threads.userId, input.userId), gte(messages.sentAt, input.since)),
      )
      .orderBy(messages.sentAt);
  }

  /** Whether the user has ever sent to `email` (strong "known sender" signal). */
  async hasPriorOutboundTo(input: {
    userId: string;
    email: string;
  }): Promise<boolean> {
    const result = (await this.database.execute(sql`
      select 1
      from messages m
      join threads t on m.thread_id = t.id
      where t.user_id = ${input.userId}
        and m.direction = 'outbound'
        and m.to_addr @> ${JSON.stringify([input.email])}::jsonb
      limit 1
    `)) as unknown as { rows?: unknown[] };
    return (result.rows?.length ?? 0) > 0;
  }
}

export const messageRepository = new MessageRepository();
