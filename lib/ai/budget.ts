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

/* -------------------------------------------------------------------------- */
/*  Platform-wide daily budget (A8)                                            */
/* -------------------------------------------------------------------------- */

/**
 * Platform-wide daily ceiling, shared by every user. Blank/unset means "no
 * cap" — the plan's optional-env rule. When exceeded, classification features
 * drop to heuristics while user-initiated chat/draft calls are still allowed
 * (enforced by `lib/ai/generate.ts`).
 */
export const DEFAULT_GLOBAL_AI_DAILY_BUDGET = (() => {
  const raw = process.env.AI_GLOBAL_DAILY_BUDGET;
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
})();

export function globalBudgetKey(date = new Date()): string {
  return `ai-global-budget:${date.toISOString().slice(0, 10)}`;
}

/** True once the global daily budget is exhausted (false when unset). */
export async function isGlobalAiBudgetExhausted({
  limit = DEFAULT_GLOBAL_AI_DAILY_BUDGET,
  counter = redisBudgetCounter,
}: {
  limit?: number | null;
  counter?: BudgetCounter;
} = {}): Promise<boolean> {
  if (!limit || isBudgetDisabled()) return false;
  try {
    const key = globalBudgetKey();
    const value = await counter.incr(key);
    // `incr` also consumes the probe; that is acceptable — the counter is a
    // ceiling on attempts, and the probe is one of them. Mirror the per-user
    // path and set a TTL on the first increment so the dated key can never
    // leak in Redis after its day has passed.
    if (value === 1) {
      await counter.expire(key, 86_400);
    }
    return value > limit;
  } catch (error) {
    console.warn("[ai/budget] global counter unavailable; allowing the call", error);
    return false;
  }
}
