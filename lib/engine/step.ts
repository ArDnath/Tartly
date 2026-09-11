import type { ZodType } from "zod";

import type { Database } from "@/lib/db";

/**
 * A step is a single, composable unit of work in a flow. Steps are registered
 * by `type` (see `registry.ts`) and configured per node in the flow graph.
 */

export type StepPolicy = "critical" | "best_effort";

export type StepCtx = {
  db: Database;
  userId: string;
  runId: string;
  /** Accumulated output of the nodes already executed in this run. */
  state: Record<string, unknown>;
  log: (event: string, data?: unknown) => void;
};

export interface StepDefinition<I = unknown, O = unknown> {
  type: string;
  configSchema: ZodType<I>;
  /**
   * `critical` (default) fails the run when the step throws.
   * `best_effort` records the error and continues.
   */
  policy?: StepPolicy;
  run(ctx: StepCtx & { input: I }): Promise<O>;
}

/**
 * Identity helper that preserves the inferred config/return types when a step
 * module declares its definition. Keeps step modules free of any import from
 * the registry (which would create a module cycle).
 */
export function defineStep<I, O>(
  definition: StepDefinition<I, O>,
): StepDefinition<I, O> {
  return definition;
}
