import { ALL_STEPS } from "@/lib/engine/steps";
import type { StepDefinition } from "@/lib/engine/step";

/**
 * Step registry. `loadSteps()` registers the built-in steps (idempotent, so a
 * test may `clearSteps()` and re-run without losing them). Feature tests can
 * also `registerStep()` their own fixtures.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const STEPS = new Map<string, StepDefinition<any, any>>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerStep(step: StepDefinition<any, any>): void {
  STEPS.set(step.type, step);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getStep(type: string): StepDefinition<any, any> | undefined {
  return STEPS.get(type);
}

export function listStepTypes(): string[] {
  return [...STEPS.keys()];
}

/** Test helper: forget every registered step. */
export function clearSteps(): void {
  STEPS.clear();
}

/** Registers every built-in step. Safe to call repeatedly. */
export function loadSteps(): void {
  for (const step of ALL_STEPS) STEPS.set(step.type, step);
}
