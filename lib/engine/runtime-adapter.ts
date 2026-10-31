import "server-only";

import {
  type StepAdapter,
  type StepResolver,
} from "@tartly/flow-runtime";

import type { Database } from "@/lib/db";
import { getStep } from "@/lib/engine/registry";

/**
 * Adapts the application's Zod-validated step registry to the runtime port.
 * The database/user are captured per run; the runtime stays stateless.
 */
export function createDatabaseStepResolver(
  database: Database,
  userId: string,
): StepResolver {
  return (type: string): StepAdapter | undefined => {
    const step = getStep(type);
    if (!step) return undefined;

    return {
      type: step.type,
      policy: step.policy,
      parseConfig: (config) => step.configSchema.parse(config),
      execute: ({ runId, state, input, log }) =>
        step.run({
          db: database,
          userId,
          runId,
          state: { ...state },
          log,
          input,
        }),
    };
  };
}
