import "server-only";

import { redis } from "@/lib/redis";

/**
 * Per-user daily AI budget, backed by an Upstash counter. Guards against a
 * runaway loop burning the model quota. Fails *open*: if Redis is unreachable
 * we allow the call rather than silently disabling the assistant.
 */

export const DEFAULT_AI_DAILY_BUDGET = Number(
  process.env.AI_DAILY_BUDGET ?? 500,
);

export type BudgetCounter = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
};

export const redisBudgetCounter: BudgetCounter = {
  incr: (key) => redis.incr(key),
  expire: (key, seconds) => redis.expire(key, seconds),
};

export function budgetKey(userId: string, date = new Date()): string {
  return `ai-budget:${userId}:${date.toISOString().slice(0, 10)}`;
}

/** Returns false when the user has no model budget left for today. */
export async function tryConsumeAiBudget({
  userId,
  limit = DEFAULT_AI_DAILY_BUDGET,
  counter = redisBudgetCounter,
  now = new Date(),
}: {
  userId: string;
  limit?: number;
  counter?: BudgetCounter;
  now?: Date;
}): Promise<boolean> {
  try {
    const key = budgetKey(userId, now);
    const count = await counter.incr(key);
    if (count === 1) {
      await counter.expire(key, 86_400);
    }
    return count <= limit;
  } catch (error) {
    console.warn("[ai/budget] counter unavailable; allowing the call", error);
    return true;
  }
}

export function isBudgetDisabled(): boolean {
  return process.env.AI_BUDGET_DISABLED === "true";
}
