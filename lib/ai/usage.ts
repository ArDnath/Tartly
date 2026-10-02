import "server-only";

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/lib/db";
import { aiUsageEvents } from "@/lib/db/schema";

/**
 * The cross-feature AI usage ledger (A4/A8).
 *
 * Every `lib/ai/generate.ts` model call records one row: tokens, an estimated
 * cost, latency and outcome. It powers the `/activity` cost board, the global
 * daily budget, and the agent's self-reported `get_ai_cost` tool.
 *
 * All writes are best-effort: a ledger failure must never fail the AI feature.
 */

export type AiUsageInput = {
  /** The owner. Omitted (system jobs) means nothing is recorded. */
  userId?: string;
  feature: string;
  provider: string;
  model: string;
  role: string;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  ok?: boolean;
  errorCode?: string | null;
};

/**
 * Illustrative USD price per **million tokens**, keyed by a case-insensitive
 * model-id substring. Anything unmatched (including the default free gateway
 * models) costs 0. Extend as paid models are added; it is an estimate, not a
 * quote.
 */
export const MODEL_PRICING_USD_PER_MILLION: ReadonlyArray<{
  match: string;
  input: number;
  output: number;
  cachedInput?: number;
}> = [
  { match: "gpt-4o-mini", input: 0.15, output: 0.6, cachedInput: 0.075 },
  { match: "gpt-4o", input: 2.5, output: 10, cachedInput: 1.25 },
  { match: "claude-3-5-sonnet", input: 3, output: 15, cachedInput: 0.3 },
  { match: "claude-3-haiku", input: 0.25, output: 1.25, cachedInput: 0.03 },
];

/**
 * Cost in **micro-USD** (1e-6 dollars). With prices expressed per million
 * tokens, `micros = tokens * pricePerMillion` (the 1e6 factors cancel), which
 * keeps the arithmetic integer-friendly.
 */
export function estimateCostMicros({
  model,
  promptTokens = 0,
  completionTokens = 0,
  cachedTokens = 0,
}: {
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
}): number {
  const normalized = model.toLowerCase();
  const pricing = MODEL_PRICING_USD_PER_MILLION.find((entry) =>
    normalized.includes(entry.match),
  );
  if (!pricing) return 0;

  const cachedRate = pricing.cachedInput ?? pricing.input;
  // `cachedTokens` is a subset of `promptTokens` (cache reads are part of the
  // prompt), so bill the uncached remainder at the full input rate and the
  // cached remainder at the discounted rate. Charging both at the full rate
  // would double-count cached tokens.
  const uncachedInput = Math.max(0, promptTokens - cachedTokens);
  const cost =
    uncachedInput * pricing.input +
    cachedTokens * cachedRate +
    completionTokens * pricing.output;
  return Math.max(0, Math.round(cost));
}

/** Record one model call. Never throws. */
export async function recordAiUsage(input: AiUsageInput): Promise<void> {
  // The ledger is per-user; a call with no owner is not attributable.
  if (!input.userId) return;
  try {
    const promptTokens = input.promptTokens ?? 0;
    const completionTokens = input.completionTokens ?? 0;
    const cachedTokens = input.cachedTokens ?? 0;
    const totalTokens =
      input.totalTokens ?? promptTokens + completionTokens;

    await db.insert(aiUsageEvents).values({
      id: nanoid(),
      userId: input.userId,
      feature: input.feature,
      provider: input.provider,
      model: input.model,
      role: input.role,
      promptTokens,
      completionTokens,
      cachedTokens,
      totalTokens,
      estimatedCostMicros: input.ok === false
        ? 0
        : estimateCostMicros({
            model: input.model,
            promptTokens,
            completionTokens,
            cachedTokens,
          }),
      latencyMs: input.latencyMs ?? 0,
      ok: input.ok ?? true,
      errorCode: input.errorCode ?? null,
    });
  } catch (error) {
    console.warn("[ai/usage] failed to record usage", error);
  }
}

export type AiUsageSummary = {
  calls: number;
  failedCalls: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  totalTokens: number;
  estimatedCostMicros: number;
  byFeature: Array<{
    feature: string;
    calls: number;
    totalTokens: number;
    estimatedCostMicros: number;
  }>;
};

/** Aggregate usage for a user over a window (defaults to the last 7 days). */
export async function getAiUsageSummary({
  userId,
  since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  until = new Date(),
}: {
  userId: string;
  since?: Date;
  until?: Date;
}): Promise<AiUsageSummary> {
  const window = and(
    eq(aiUsageEvents.userId, userId),
    gte(aiUsageEvents.createdAt, since),
    lte(aiUsageEvents.createdAt, until),
  );

  const [totals] = await db
    .select({
      calls: sql<number>`count(*)::int`,
      failedCalls: sql<number>`count(*) filter (where ${aiUsageEvents.ok} = false)::int`,
      promptTokens: sql<number>`coalesce(sum(${aiUsageEvents.promptTokens}), 0)::int`,
      completionTokens: sql<number>`coalesce(sum(${aiUsageEvents.completionTokens}), 0)::int`,
      cachedTokens: sql<number>`coalesce(sum(${aiUsageEvents.cachedTokens}), 0)::int`,
      totalTokens: sql<number>`coalesce(sum(${aiUsageEvents.totalTokens}), 0)::int`,
      estimatedCostMicros: sql<number>`coalesce(sum(${aiUsageEvents.estimatedCostMicros}), 0)::bigint`,
    })
    .from(aiUsageEvents)
    .where(window);

  const byFeature = await db
    .select({
      feature: aiUsageEvents.feature,
      calls: sql<number>`count(*)::int`,
      totalTokens: sql<number>`coalesce(sum(${aiUsageEvents.totalTokens}), 0)::int`,
      estimatedCostMicros: sql<number>`coalesce(sum(${aiUsageEvents.estimatedCostMicros}), 0)::bigint`,
    })
    .from(aiUsageEvents)
    .where(window)
    .groupBy(aiUsageEvents.feature)
    .orderBy(desc(sql`sum(${aiUsageEvents.totalTokens})`));

  const toNumber = (value: unknown): number => {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  return {
    calls: toNumber(totals?.calls),
    failedCalls: toNumber(totals?.failedCalls),
    promptTokens: toNumber(totals?.promptTokens),
    completionTokens: toNumber(totals?.completionTokens),
    cachedTokens: toNumber(totals?.cachedTokens),
    totalTokens: toNumber(totals?.totalTokens),
    estimatedCostMicros: toNumber(totals?.estimatedCostMicros),
    byFeature: byFeature.map((row) => ({
      feature: row.feature,
      calls: toNumber(row.calls),
      totalTokens: toNumber(row.totalTokens),
      estimatedCostMicros: toNumber(row.estimatedCostMicros),
    })),
  };
}

/** Format micro-USD for display, e.g. `$0.0042`. */
export function formatMicroUsd(micros: number): string {
  const dollars = micros / 1_000_000;
  if (dollars === 0) return "$0.00";
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(2)}`;
}
