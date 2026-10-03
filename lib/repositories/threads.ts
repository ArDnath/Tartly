import "server-only";

import { and, count, desc, eq, gt, gte, inArray, ne, sql } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { messages, threadStates, threads } from "@/lib/db/schema";

/**
 * Persistence for the mirrored `threads`/`thread_states` read model.
 *
 * The inbox bucket `CASE` expression is SQL, so it lives here rather than in the
 * service. Counting and listing share one expression, which is what guarantees a
 * sidebar badge always equals the rows it links to.
 */

export type Thread = typeof threads.$inferSelect;
export type ThreadState = typeof threadStates.$inferSelect;

export type MirroredThreadInput = {
  id: string;
  mailboxId: string;
  userId: string;
  gmailThreadId: string;
  subject: string | null;
  lastMessageAt: Date | null;
  labels: string[];
  isUnread: boolean;
};

export type InboxThreadRow = {
  thread: Thread;
  state: ThreadState | null;
};

/**
 * Keyset cursor position for the inbox order. Mirrors Postgres' default
 * `DESC NULLS FIRST` on `priority`: a `null` priority sorts *before* every
 * numeric priority (and `null` `lastMessageAt` before every timestamp). The
 * query coalesces to sentinels so the comparison stays a clean tuple test.
 */
export type InboxCursor = {
  priority: number | null;
  lastMessageAt: Date | null;
  id: string;
};

/** Can't collide with a real `priority` (int4) once widened to bigint. */
const NULL_PRIORITY_SENTINEL = sql`9223372036854775807::bigint`;

/** `'infinity'` sorts after every real timestamp, reproducing NULLS FIRST. */
const NULL_LAST_MESSAGE_SENTINEL = sql`'infinity'::timestamptz`;

function inboxPriorityKey() {
  return sql`coalesce(${threadStates.priority}::bigint, 9223372036854775807)`;
}

function inboxLastMessageKey() {
  return sql`coalesce(${threads.lastMessageAt}, 'infinity'::timestamptz)`;
}

/**
 * The one inbox ordering: priority (nulls first) → lastMessageAt (nulls first)
 * → id. Exposed as a function so list and keyset filter can never drift.
 */
function inboxOrderBy() {
  return [
    sql`${inboxPriorityKey()} desc`,
    sql`${inboxLastMessageKey()} desc`,
    desc(threads.id),
  ] as const;
}

function inboxAfterCondition(cursor: InboxCursor) {
  const priority =
    cursor.priority === null
      ? NULL_PRIORITY_SENTINEL
      : sql`${cursor.priority}::bigint`;
  const lastMessageAt =
    cursor.lastMessageAt === null
      ? NULL_LAST_MESSAGE_SENTINEL
      : sql`${cursor.lastMessageAt}::timestamptz`;
  return sql`(${inboxPriorityKey()}, ${inboxLastMessageKey()}, ${threads.id}) < (${priority}, ${lastMessageAt}, ${cursor.id})`;
}

/**
 * The one source of truth for bucketing, as a SQL `CASE` expression. Order is
 * the precedence ladder, so counts (grouped on this expression) and lists
 * (filtered on it) can never disagree.
 */
function bucketExpression({
  now,
  endOfDay,
}: {
  now: Date;
  endOfDay: Date;
}) {
  return sql<string>`case
    when ${threadStates.category} in ('needs_reply','meeting_request')
      or ${threadStates.action} = 'handoff'
      or ${threadStates.category} is null
      then 'needs_reply'
    when exists (
      select 1 from followup_enrollments fe
      where fe.thread_id = ${threads.id}
        and fe.status = 'active'
        and fe.next_eval_at <= ${endOfDay}
    ) then 'follow_up_today'
    when exists (
      select 1 from meetings mt
      where mt.thread_id = ${threads.id}
        and mt.start_at >= ${now}
    ) or (
      ${threadStates.category} = 'meeting_request'
      and exists (
        select 1 from meetings mt2
        where mt2.thread_id = ${threads.id} and mt2.status = 'proposed'
      )
    ) then 'meetings'
    when ${threadStates.category} = 'awaiting_reply'
      or ${threadStates.replyStatus} = 'awaiting_them'
      then 'waiting'
    when exists (
      select 1 from drafts d_ai
      where d_ai.thread_id = ${threads.id}
        and d_ai.sent_by = 'ai'
        and d_ai.status = 'sent'
        and d_ai.decided_at >= (${now}::timestamptz - interval '7 days')
        and d_ai.decided_at >= coalesce(
          (
            select max(mi.sent_at) from messages mi
            where mi.thread_id = ${threads.id} and mi.direction = 'inbound'
          ),
          '-infinity'::timestamptz
        )
    ) then 'ai_handled'
    else 'fyi'
  end`;
}

export class ThreadRepository {
  constructor(private readonly database: Database = db) {}

  /**
   * Unscoped id lookup for engine steps that already vetted the thread upstream
   * and deliberately read across tenants. Prefer `findByIdForUser` on any
   * user-facing path.
   */
  async findById(threadId: string): Promise<Thread | undefined> {
    const rows = await this.database
      .select()
      .from(threads)
      .where(eq(threads.id, threadId))
      .limit(1);
    return rows[0];
  }

  /** Unscoped mailbox id for a thread (engine egress routing). */
  async findMailboxIdById(threadId: string): Promise<string | undefined> {
    const rows = await this.database
      .select({ mailboxId: threads.mailboxId })
      .from(threads)
      .where(eq(threads.id, threadId))
      .limit(1);
    return rows[0]?.mailboxId;
  }

  /** Idempotent thread mirror keyed on the Gmail thread id. */
  async upsertMirrored(
    values: MirroredThreadInput,
  ): Promise<{ id: string; lastMessageAt: Date | null }> {
    const inserted = await this.database
      .insert(threads)
      .values(values)
      .onConflictDoUpdate({
        target: threads.gmailThreadId,
        set: {
          subject: values.subject,
          labels: values.labels,
          isUnread: values.isUnread,
          updatedAt: new Date(),
        },
      })
      .returning({ id: threads.id, lastMessageAt: threads.lastMessageAt });
    return inserted[0];
  }

  /** Monotonic cursor advance: only moves `lastMessageAt` forward. */
  async updateLastMessageAt(
    threadId: string,
    lastMessageAt: Date,
  ): Promise<void> {
    await this.database
      .update(threads)
      .set({ lastMessageAt })
      .where(eq(threads.id, threadId));
  }

  async findByIdForUser(
    userId: string,
    threadId: string,
  ): Promise<Thread | undefined> {
    const rows = await this.database
      .select()
      .from(threads)
      .where(and(eq(threads.id, threadId), eq(threads.userId, userId)))
      .limit(1);
    return rows[0];
  }

  /** Existence check that selects only the id. */
  async findIdForUser(
    userId: string,
    threadId: string,
  ): Promise<{ id: string } | undefined> {
    const rows = await this.database
      .select({ id: threads.id })
      .from(threads)
      .where(and(eq(threads.id, threadId), eq(threads.userId, userId)))
      .limit(1);
    return rows[0];
  }

  async findByGmailThreadIdForUser(
    userId: string,
    gmailThreadId: string,
  ): Promise<Thread | undefined> {
    const rows = await this.database
      .select()
      .from(threads)
      .where(
        and(
          eq(threads.gmailThreadId, gmailThreadId),
          eq(threads.userId, userId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /** Owner + subject for a thread id, used to route an inbound campaign reply. */
  async findOwnerAndSubjectById(threadId: string): Promise<
    { userId: string; subject: string | null } | undefined
  > {
    const rows = await this.database
      .select({ userId: threads.userId, subject: threads.subject })
      .from(threads)
      .where(eq(threads.id, threadId))
      .limit(1);
    return rows[0];
  }

  async countByBucket(input: {
    userId: string;
    view: string;
    now: Date;
    endOfDay: Date;
  }): Promise<number> {
    const bucket = bucketExpression({ now: input.now, endOfDay: input.endOfDay });
    const rows = await this.database
      .select({ total: count() })
      .from(threads)
      .leftJoin(threadStates, eq(threadStates.threadId, threads.id))
      .where(
        and(eq(threads.userId, input.userId), sql`${bucket} = ${input.view}`),
      );
    return Number(rows[0]?.total ?? 0);
  }

  async countUnread(userId: string): Promise<number> {
    const rows = await this.database
      .select({ total: count() })
      .from(threads)
      .where(and(eq(threads.userId, userId), eq(threads.isUnread, true)));
    return Number(rows[0]?.total ?? 0);
  }

  async listInbox(input: {
    userId: string;
    view: string;
    now: Date;
    endOfDay: Date;
    since?: Date;
    /** Keyset position; returns rows strictly after this cursor. */
    after?: InboxCursor;
    limit: number;
  }): Promise<InboxThreadRow[]> {
    const conditions = [
      eq(threads.userId, input.userId),
      sql`${bucketExpression({ now: input.now, endOfDay: input.endOfDay })} = ${input.view}`,
    ];
    if (input.since) {
      conditions.push(gt(threads.lastMessageAt, input.since));
    }
    if (input.after) {
      conditions.push(inboxAfterCondition(input.after));
    }

    const rows = await this.database
      .select({ thread: threads, state: threadStates })
      .from(threads)
      .leftJoin(threadStates, eq(threadStates.threadId, threads.id))
      .where(and(...conditions))
      .orderBy(...inboxOrderBy())
      .limit(input.limit);
    return rows;
  }

  /**
   * Threads active since `since`, newest first, with their state row. Used by
   * the inbox digest, which groups by the same state the inbox renders.
   */
  async listRecentWithState(input: {
    userId: string;
    since: Date;
    limit: number;
  }): Promise<InboxThreadRow[]> {
    return this.database
      .select({ thread: threads, state: threadStates })
      .from(threads)
      .leftJoin(threadStates, eq(threadStates.threadId, threads.id))
      .where(
        and(
          eq(threads.userId, input.userId),
          gte(threads.lastMessageAt, input.since),
        ),
      )
      .orderBy(...inboxOrderBy())
      .limit(input.limit);
  }

  /**
   * Prior threads with any of `senderEmails` as a participant, newest message
   * per thread. Backs the meeting brief's "what's our history" section.
   */
  async listPriorThreadsWithSenders(input: {
    userId: string;
    senderEmails: string[];
    excludeThreadId?: string | null;
    limit: number;
  }): Promise<
    Array<{
      threadId: string;
      subject: string | null;
      lastMessageAt: Date | null;
      snippet: string | null;
      bodyText: string | null;
    }>
  > {
    if (input.senderEmails.length === 0) return [];
    return this.database
      .selectDistinctOn([threads.id], {
        threadId: threads.id,
        subject: threads.subject,
        lastMessageAt: threads.lastMessageAt,
        snippet: messages.snippet,
        bodyText: messages.bodyText,
      })
      .from(messages)
      .innerJoin(threads, eq(threads.id, messages.threadId))
      .where(
        and(
          eq(threads.userId, input.userId),
          inArray(messages.fromAddr, input.senderEmails),
          input.excludeThreadId
            ? ne(threads.id, input.excludeThreadId)
            : undefined,
        ),
      )
      .orderBy(threads.id, desc(messages.sentAt))
      .limit(input.limit);
  }
}

export const threadRepository = new ThreadRepository();
