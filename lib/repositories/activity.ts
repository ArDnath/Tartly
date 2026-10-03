import "server-only";

import { and, desc, eq, gte, sql, type SQL } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import {
  agentRuns,
  drafts,
  flowRuns,
  mailboxes,
  meetings,
  onboardingState,
  pendingActions,
} from "@/lib/db/schema";

/**
 * Read model for the Activity board (SKILL §1.1).
 *
 * This is deliberately one repository over several tables: the board is an
 * aggregation view, and keeping its SQL together is what makes the numbers
 * reproducible. It never writes. Where a table already has a repository with
 * the needed count (meetings, follow-ups), the service uses that instead.
 */

export type AgentRunLite = {
  id: string;
  status: string | null;
  model: string | null;
  stepCount: number;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number | null;
  startedAt: Date;
};

export type FlowRunLite = {
  id: string;
  triggerKind: string | null;
  status: string | null;
  startedAt: Date;
};

export type LifetimeRunStats = {
  runs: number | string;
  tokens: number | string;
};

export type ToolUsageRow = { name: string; calls: number; errors: number };
export type CategoryCountRow = { category: string; n: number };
export type SenderCountRow = { email: string; n: number };

export class ActivityRepository {
  constructor(private readonly database: Database = db) {}

  private async rawRows<T>(query: SQL): Promise<T[]> {
    const result = (await this.database.execute(query)) as unknown as {
      rows: T[];
    };
    return result.rows;
  }

  async findCalendarTimezone(userId: string): Promise<string | null> {
    const rows = await this.database
      .select({ tz: onboardingState.calendarTimezone })
      .from(onboardingState)
      .where(eq(onboardingState.userId, userId))
      .limit(1);
    return rows[0]?.tz ?? null;
  }

  async listRunsSince(input: {
    userId: string;
    since: Date;
  }): Promise<AgentRunLite[]> {
    return this.database
      .select({
        id: agentRuns.id,
        status: agentRuns.status,
        model: agentRuns.model,
        stepCount: agentRuns.stepCount,
        promptTokens: agentRuns.promptTokens,
        completionTokens: agentRuns.completionTokens,
        latencyMs: agentRuns.latencyMs,
        startedAt: agentRuns.startedAt,
      })
      .from(agentRuns)
      .where(
        and(eq(agentRuns.userId, input.userId), gte(agentRuns.startedAt, input.since)),
      )
      .orderBy(desc(agentRuns.startedAt));
  }

  async listFlowRunsSince(input: {
    userId: string;
    since: Date;
  }): Promise<FlowRunLite[]> {
    return this.database
      .select({
        id: flowRuns.id,
        triggerKind: flowRuns.triggerKind,
        status: flowRuns.status,
        startedAt: flowRuns.startedAt,
      })
      .from(flowRuns)
      .where(
        and(eq(flowRuns.userId, input.userId), gte(flowRuns.startedAt, input.since)),
      )
      .orderBy(desc(flowRuns.startedAt));
  }

  async countDraftsByStatusSince(input: {
    userId: string;
    since: Date;
  }): Promise<Array<{ status: string; n: number }>> {
    const rows = await this.database
      .select({ status: drafts.status, n: sql<number>`count(*)::int` })
      .from(drafts)
      .where(
        and(eq(drafts.userId, input.userId), gte(drafts.createdAt, input.since)),
      )
      .groupBy(drafts.status);
    return rows.map((row) => ({ status: row.status, n: Number(row.n) }));
  }

  async countPendingActionsByStatusSince(input: {
    userId: string;
    since: Date;
  }): Promise<Array<{ status: string; n: number }>> {
    const rows = await this.database
      .select({
        status: pendingActions.status,
        n: sql<number>`count(*)::int`,
      })
      .from(pendingActions)
      .where(
        and(
          eq(pendingActions.userId, input.userId),
          gte(pendingActions.createdAt, input.since),
        ),
      )
      .groupBy(pendingActions.status);
    return rows.map((row) => ({ status: row.status, n: Number(row.n) }));
  }

  async findFirstMailboxAutonomy(userId: string): Promise<string | null> {
    const rows = await this.database
      .select({ autonomy: mailboxes.autonomy })
      .from(mailboxes)
      .where(eq(mailboxes.userId, userId))
      .limit(1);
    return rows[0]?.autonomy ?? null;
  }

  async listRecentDrafts(input: {
    userId: string;
    since: Date;
    limit: number;
  }): Promise<Array<{ id: string; status: string; createdAt: Date }>> {
    return this.database
      .select({
        id: drafts.id,
        status: drafts.status,
        createdAt: drafts.createdAt,
      })
      .from(drafts)
      .where(
        and(eq(drafts.userId, input.userId), gte(drafts.createdAt, input.since)),
      )
      .orderBy(desc(drafts.createdAt))
      .limit(input.limit);
  }

  async listRecentPendingActions(input: {    userId: string;
    since: Date;
    limit: number;
  }): Promise<
    Array<{
      id: string;
      toolName: string;
      status: string;
      createdAt: Date;
    }>
  > {
    return this.database
      .select({
        id: pendingActions.id,
        toolName: pendingActions.toolName,
        status: pendingActions.status,
        createdAt: pendingActions.createdAt,
      })
      .from(pendingActions)
      .where(
        and(
          eq(pendingActions.userId, input.userId),
          gte(pendingActions.createdAt, input.since),
        ),
      )
      .orderBy(desc(pendingActions.createdAt))
      .limit(input.limit);
  }

  async listRecentMeetings(input: {
    userId: string;
    since: Date;
    limit: number;
  }): Promise<
    Array<{
      id: string;
      subject: string | null;
      status: string;
      createdAt: Date;
    }>
  > {
    return this.database
      .select({
        id: meetings.id,
        subject: meetings.subject,
        status: meetings.status,
        createdAt: meetings.createdAt,
      })
      .from(meetings)
      .where(
        and(eq(meetings.userId, input.userId), gte(meetings.createdAt, input.since)),
      )
      .orderBy(desc(meetings.createdAt))
      .limit(input.limit);
  }

  async getLifetimeRunStats(userId: string): Promise<LifetimeRunStats> {
    const rows = await this.rawRows<LifetimeRunStats>(sql`
      select count(*)::int as runs,
             coalesce(sum(prompt_tokens + completion_tokens), 0)::bigint as tokens
        from agent_runs
       where user_id = ${userId}
    `);
    return rows[0] ?? { runs: 0, tokens: 0 };
  }

  async getRunStatsBetween(input: {
    userId: string;
    from: Date;
    to: Date;
  }): Promise<LifetimeRunStats> {
    const rows = await this.rawRows<LifetimeRunStats>(sql`
      select count(*)::int as runs,
             coalesce(sum(prompt_tokens + completion_tokens), 0)::bigint as tokens
        from agent_runs
       where user_id = ${input.userId}
         and started_at >= ${input.from}
         and started_at < ${input.to}
    `);
    return rows[0] ?? { runs: 0, tokens: 0 };
  }

  async listToolUsage(input: {
    userId: string;
    since: Date;
    limit: number;
  }): Promise<ToolUsageRow[]> {
    return this.rawRows<ToolUsageRow>(sql`
      select e->>'toolName' as name,
             count(*)::int as calls,
             (count(*) filter (where e->>'status' is distinct from 'ok'))::int as errors
        from agent_runs a
        cross join lateral jsonb_array_elements(a.trace) e
       where a.user_id = ${input.userId}
         and a.started_at >= ${input.since}
         and jsonb_typeof(a.trace) = 'array'
         and e->>'toolName' is not null
       group by 1
       order by calls desc
       limit ${input.limit}
    `);
  }

  async countDistinctTools(userId: string): Promise<number> {
    const rows = await this.rawRows<{ n: number }>(sql`
      select count(distinct e->>'toolName')::int as n
        from agent_runs a
        cross join lateral jsonb_array_elements(a.trace) e
       where a.user_id = ${userId}
         and jsonb_typeof(a.trace) = 'array'
         and e->>'toolName' is not null
    `);
    return Number(rows[0]?.n ?? 0);
  }

  async listInboundByCategory(input: {
    userId: string;
    since: Date;
  }): Promise<CategoryCountRow[]> {
    return this.rawRows<CategoryCountRow>(sql`
      select coalesce(sp.category, 'Other') as category,
             count(*)::int as n
        from messages m
        join threads t on t.id = m.thread_id
        left join sender_profiles sp
          on sp.user_id = t.user_id
         and sp.email = lower(m.from_addr)
       where t.user_id = ${input.userId}
         and m.direction = 'inbound'
         and m.sent_at >= ${input.since}
       group by 1
       order by n desc
    `);
  }

  async listTopSenders(input: {
    userId: string;
    since: Date;
    limit: number;
  }): Promise<SenderCountRow[]> {
    return this.rawRows<SenderCountRow>(sql`
      select lower(m.from_addr) as email, count(*)::int as n
        from messages m
        join threads t on t.id = m.thread_id
       where t.user_id = ${input.userId}
         and m.direction = 'inbound'
         and m.from_addr is not null
         and m.sent_at >= ${input.since}
       group by 1
       order by n desc
       limit ${input.limit}
    `);
  }
}

export const activityRepository = new ActivityRepository();
