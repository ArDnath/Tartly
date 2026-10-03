import "server-only";

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";

import { db, type Database } from "@/lib/db";
import { aiUsageEvents } from "@/lib/db/schema";

/**
 * Persistence for the cross-feature `ai_usage_events` ledger.
 *
 * One method = one atomic storage operation (SKILL §1.1); cost estimation and
 * formatting stay in `lib/ai/usage.ts`.
 */

export type AiUsageEvent = typeof aiUsageEvents.$inferSelect;
export type NewAiUsageEvent = typeof aiUsageEvents.$inferInsert;

export type AiUsageTotals = {
  calls: number;
  failedCalls: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  totalTokens: number;
  estimatedCostMicros: number;
};

export type AiUsageByFeature = {
  feature: string;
  calls: number;
  totalTokens: number;
  estimatedCostMicros: number;
};

export class AiUsageRepository {
  constructor(private readonly database: Database = db) {}

  async insert(values: NewAiUsageEvent): Promise<void> {
    await this.database.insert(aiUsageEvents).values(values);
  }

  private window(userId: string, since: Date, until: Date) {
    return and(
      eq(aiUsageEvents.userId, userId),
      gte(aiUsageEvents.createdAt, since),
      lte(aiUsageEvents.createdAt, until),
    );
  }

  async summaryTotals(input: {
    userId: string;
    since: Date;
    until: Date;
  }): Promise<AiUsageTotals | undefined> {
    const [totals] = await this.database
      .select({
        calls: sql<number>`count(*)::int`,
        failedCalls: sql<number>`count(*) filter (where ${aiUsageEvents.ok} = false)::int`,
        promptTokens: sql<number>`coalesce(sum(${aiUsageEvents.promptTokens}), 0)::int`,
        completionTokens: sql<number>`coalesce(sum(${aiUsageEvents.completionTokens}), 0)::int`,
        cachedTokens: sql<number>`coalesce(sum(${aiUsageEvents.cachedTokens}), 0)::int`,
        totalTokens: sql<number>`coalesce(sum(${aiUsageEvents.totalTokens}), 0)::int`,
        estimatedCostMicros: sql<string>`coalesce(sum(${aiUsageEvents.estimatedCostMicros}), 0)::bigint`,
      })
      .from(aiUsageEvents)
      .where(this.window(input.userId, input.since, input.until));
    if (!totals) return undefined;
    return {
      calls: Number(totals.calls),
      failedCalls: Number(totals.failedCalls),
      promptTokens: Number(totals.promptTokens),
      completionTokens: Number(totals.completionTokens),
      cachedTokens: Number(totals.cachedTokens),
      totalTokens: Number(totals.totalTokens),
      estimatedCostMicros: Number(totals.estimatedCostMicros),
    };
  }

  async summaryByFeature(input: {
    userId: string;
    since: Date;
    until: Date;
  }): Promise<AiUsageByFeature[]> {
    const rows = await this.database
      .select({
        feature: aiUsageEvents.feature,
        calls: sql<number>`count(*)::int`,
        totalTokens: sql<number>`coalesce(sum(${aiUsageEvents.totalTokens}), 0)::int`,
        estimatedCostMicros: sql<string>`coalesce(sum(${aiUsageEvents.estimatedCostMicros}), 0)::bigint`,
      })
      .from(aiUsageEvents)
      .where(this.window(input.userId, input.since, input.until))
      .groupBy(aiUsageEvents.feature)
      .orderBy(desc(sql`sum(${aiUsageEvents.totalTokens})`));
    return rows.map((row) => ({
      feature: row.feature,
      calls: Number(row.calls),
      totalTokens: Number(row.totalTokens),
      estimatedCostMicros: Number(row.estimatedCostMicros),
    }));
  }
}

export const aiUsageRepository = new AiUsageRepository();
