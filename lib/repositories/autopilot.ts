import "server-only";

import { and, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import {
  autopilotDecisions,
  autopilotPolicies,
  contacts,
  drafts,
  messages,
  threads,
} from "@/lib/db/schema";

/**
 * Persistence for 24/7 Autopilot: the mailbox policy, the content-free decision
 * audit, and the usage counters the send gate reads. Every query is scoped by
 * `user_id` (or by a mailbox/thread the caller already proved is owned).
 *
 * INV-11: the decision table never stores message bodies, subjects or tokens.
 */

export type AutopilotPolicyRow = typeof autopilotPolicies.$inferSelect;
export type NewAutopilotPolicy = typeof autopilotPolicies.$inferInsert;
export type AutopilotDecisionRow = typeof autopilotDecisions.$inferSelect;
export type NewAutopilotDecision = typeof autopilotDecisions.$inferInsert;

export type AutopilotUsage = {
  sentLastHour: number;
  sentLastDay: number;
  sentInThread: number;
  consecutiveAutomatedExchanges: number;
};

export class AutopilotRepository {
  constructor(private readonly database: Database = db) {}

  /* ------------------------------------------------------------------ */
  /*  Policy                                                             */
  /* ------------------------------------------------------------------ */

  async findPolicyByMailboxId(
    mailboxId: string,
  ): Promise<AutopilotPolicyRow | undefined> {
    const rows = await this.database
      .select()
      .from(autopilotPolicies)
      .where(eq(autopilotPolicies.mailboxId, mailboxId))
      .limit(1);
    return rows[0];
  }

  /** The user's primary mailbox policy, if a mailbox exists. */
  async findPolicyForUser(
    userId: string,
  ): Promise<AutopilotPolicyRow | undefined> {
    const rows = await this.database
      .select()
      .from(autopilotPolicies)
      .where(eq(autopilotPolicies.userId, userId))
      .limit(1);
    return rows[0];
  }

  /** Creates the disabled default for a mailbox on first read. */
  async ensurePolicy(
    values: NewAutopilotPolicy,
  ): Promise<AutopilotPolicyRow> {
    const inserted = await this.database
      .insert(autopilotPolicies)
      .values(values)
      .onConflictDoNothing({ target: autopilotPolicies.mailboxId })
      .returning();
    if (inserted[0]) return inserted[0];

    const existing = await this.findPolicyByMailboxId(values.mailboxId);
    if (!existing) {
      throw new Error("Failed to create or load autopilot policy.");
    }
    return existing;
  }

  async updatePolicy(
    mailboxId: string,
    patch: Partial<NewAutopilotPolicy>,
    now: Date,
  ): Promise<AutopilotPolicyRow> {
    const updated = await this.database
      .update(autopilotPolicies)
      .set({ ...patch, updatedAt: now })
      .where(eq(autopilotPolicies.mailboxId, mailboxId))
      .returning();
    return updated[0];
  }

  /* ------------------------------------------------------------------ */
  /*  Decisions (content-free audit)                                     */
  /* ------------------------------------------------------------------ */

  async insertDecision(values: NewAutopilotDecision): Promise<void> {
    await this.database.insert(autopilotDecisions).values(values);
  }

  async listDecisionsForUser(input: {
    userId: string;
    since?: Date | null;
    before?: Date | null;
    limit: number;
  }): Promise<AutopilotDecisionRow[]> {
    const predicates = [eq(autopilotDecisions.userId, input.userId)];
    if (input.since) {
      predicates.push(gte(autopilotDecisions.createdAt, input.since));
    }
    if (input.before) {
      predicates.push(lt(autopilotDecisions.createdAt, input.before));
    }

    return this.database
      .select()
      .from(autopilotDecisions)
      .where(and(...predicates))
      .orderBy(desc(autopilotDecisions.createdAt))
      .limit(input.limit);
  }

  async listDecisionsSince(
    userId: string,
    since: Date,
    limit = 500,
  ): Promise<AutopilotDecisionRow[]> {
    return this.database
      .select()
      .from(autopilotDecisions)
      .where(
        and(
          eq(autopilotDecisions.userId, userId),
          gte(autopilotDecisions.createdAt, since),
        ),
      )
      .orderBy(desc(autopilotDecisions.createdAt))
      .limit(limit);
  }

  /** Most recent decision for one thread (the "Why?" popover). */
  async findLatestDecisionForThread(
    userId: string,
    threadId: string,
  ): Promise<AutopilotDecisionRow | undefined> {
    const rows = await this.database
      .select()
      .from(autopilotDecisions)
      .where(
        and(
          eq(autopilotDecisions.userId, userId),
          eq(autopilotDecisions.threadId, threadId),
        ),
      )
      .orderBy(desc(autopilotDecisions.createdAt))
      .limit(1);
    return rows[0];
  }

  async pruneDecisionsBefore(cutoff: Date): Promise<number> {
    const deleted = await this.database
      .delete(autopilotDecisions)
      .where(lt(autopilotDecisions.createdAt, cutoff))
      .returning({ id: autopilotDecisions.id });
    return deleted.length;
  }

  /* ------------------------------------------------------------------ */
  /*  Usage + loop counters                                              */
  /* ------------------------------------------------------------------ */

  async countAiSendsSince(userId: string, since: Date): Promise<number> {
    const rows = await this.database
      .select({ count: sql<number>`count(*)::int` })
      .from(drafts)
      .where(
        and(
          eq(drafts.userId, userId),
          eq(drafts.sentBy, "ai"),
          eq(drafts.status, "sent"),
          gte(drafts.decidedAt, since),
        ),
      );
    return rows[0]?.count ?? 0;
  }

  async countAiSendsInThread(userId: string, threadId: string): Promise<number> {
    const rows = await this.database
      .select({ count: sql<number>`count(*)::int` })
      .from(drafts)
      .where(
        and(
          eq(drafts.userId, userId),
          eq(drafts.threadId, threadId),
          eq(drafts.sentBy, "ai"),
          eq(drafts.status, "sent"),
        ),
      );
    return rows[0]?.count ?? 0;
  }

  /**
   * Trailing automated exchanges since the last human-driven message. A human
   * inbound OR a human-sent draft resets the counter. Bounded to the recent
   * history so it stays cheap.
   */
  async countConsecutiveAutomatedExchanges(
    userId: string,
    threadId: string,
    bound = 6,
  ): Promise<number> {
    const lastInbound = await this.database
      .select({ at: sql<Date | null>`max(${messages.sentAt})` })
      .from(messages)
      .innerJoin(threads, eq(threads.id, messages.threadId))
      .where(
        and(
          eq(threads.userId, userId),
          eq(messages.threadId, threadId),
          eq(messages.direction, "inbound"),
        ),
      );

    const lastHumanDraft = await this.database
      .select({ at: sql<Date | null>`max(${drafts.decidedAt})` })
      .from(drafts)
      .where(
        and(
          eq(drafts.userId, userId),
          eq(drafts.threadId, threadId),
          eq(drafts.sentBy, "user"),
        ),
      );

    const inboundAt = lastInbound[0]?.at ? new Date(lastInbound[0].at) : null;
    const humanAt = lastHumanDraft[0]?.at
      ? new Date(lastHumanDraft[0].at)
      : null;
    const resetAt =
      inboundAt && humanAt
        ? inboundAt > humanAt
          ? inboundAt
          : humanAt
        : inboundAt ?? humanAt;

    const where = resetAt
      ? and(
          eq(drafts.userId, userId),
          eq(drafts.threadId, threadId),
          eq(drafts.sentBy, "ai"),
          eq(drafts.status, "sent"),
          gte(drafts.decidedAt, resetAt),
        )
      : and(
          eq(drafts.userId, userId),
          eq(drafts.threadId, threadId),
          eq(drafts.sentBy, "ai"),
          eq(drafts.status, "sent"),
        );

    const rows = await this.database
      .select({ count: sql<number>`count(*)::int` })
      .from(drafts)
      .where(where);
    return Math.min(rows[0]?.count ?? 0, bound);
  }

  async getUsage(input: {
    userId: string;
    threadId: string;
    now: Date;
    hourMs?: number;
    dayMs?: number;
    loopBound?: number;
  }): Promise<AutopilotUsage> {
    const hourMs = input.hourMs ?? 60 * 60 * 1000;
    const dayMs = input.dayMs ?? 24 * 60 * 60 * 1000;
    const [sentLastHour, sentLastDay, sentInThread, consecutive] =
      await Promise.all([
        this.countAiSendsSince(input.userId, new Date(input.now.getTime() - hourMs)),
        this.countAiSendsSince(input.userId, new Date(input.now.getTime() - dayMs)),
        this.countAiSendsInThread(input.userId, input.threadId),
        this.countConsecutiveAutomatedExchanges(
          input.userId,
          input.threadId,
          input.loopBound ?? 6,
        ),
      ]);
    return {
      sentLastHour,
      sentLastDay,
      sentInThread,
      consecutiveAutomatedExchanges: consecutive,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Sender knowledge                                                   */
  /* ------------------------------------------------------------------ */

  /** A contact row exists for this (user, email). */
  async contactExists(userId: string, email: string): Promise<boolean> {
    const rows = await this.database
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(eq(contacts.userId, userId), eq(contacts.email, email.toLowerCase())),
      )
      .limit(1);
    return rows.length > 0;
  }

  /** The user has previously sent this address a message (mirror fallback). */
  async hasPriorOutboundTo(userId: string, email: string): Promise<boolean> {
    const rows = await this.database
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(threads, eq(threads.id, messages.threadId))
      .where(
        and(
          eq(threads.userId, userId),
          eq(messages.direction, "outbound"),
          sql`${messages.toAddr} @> ${JSON.stringify([email.toLowerCase()])}::jsonb`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /** Distinct AI-sent thread ids since `since` (overnight sent list). */
  async listAiSentDraftIdsSince(
    userId: string,
    since: Date,
    limit = 50,
  ): Promise<Array<{ threadId: string; draftId: string; decidedAt: Date | null }>> {
    return this.database
      .select({
        threadId: drafts.threadId,
        draftId: drafts.id,
        decidedAt: drafts.decidedAt,
      })
      .from(drafts)
      .where(
        and(
          eq(drafts.userId, userId),
          eq(drafts.sentBy, "ai"),
          ne(drafts.status, "discarded"),
          gte(drafts.decidedAt, since),
        ),
      )
      .orderBy(desc(drafts.decidedAt))
      .limit(limit);
  }

  /** Thread ids that got an autopilot `send` decision since `since`. */
  async listSentDecisionThreadIds(
    userId: string,
    threadIds: string[],
    since: Date,
  ): Promise<string[]> {
    if (threadIds.length === 0) return [];
    const rows = await this.database
      .selectDistinct({ threadId: autopilotDecisions.threadId })
      .from(autopilotDecisions)
      .where(
        and(
          eq(autopilotDecisions.userId, userId),
          eq(autopilotDecisions.decision, "send"),
          gte(autopilotDecisions.createdAt, since),
          inArray(autopilotDecisions.threadId, threadIds),
        ),
      );
    return rows
      .map((row) => row.threadId)
      .filter((id): id is string => Boolean(id));
  }
}

export const autopilotRepository = new AutopilotRepository();
