import "server-only";

import { executeFlow } from "@tartly/flow-runtime";

import { db as defaultDb, type Database } from "@/lib/db";
import { type TraceEntry } from "@/lib/db/schema";
import { DatabaseCheckpointStore } from "@/lib/engine/checkpoint-store";
import { type FlowGraph } from "@/lib/engine/flow";
import { loadSteps } from "@/lib/engine/registry";
import { createDatabaseStepResolver } from "@/lib/engine/runtime-adapter";
import { EnginePersistenceRepository } from "@/lib/repositories/engine-persistence";

export type RunFlowResult = {
  status: "completed" | "failed";
  trace: TraceEntry[];
  error?: { message: string; nodeId: string; code?: string };
};

/**
 * Application entry point for the flow runtime.
 *
 * The loop, graph validation, routing, journaling, resume/replay and safety
 * guards live in `@tartly/flow-runtime`. This module supplies the two host
 * ports (Postgres journal + registered steps), owns the run-row lifecycle, and
 * maps the runtime's result onto the app's trace shape.
 *
 * `resume` defaults to true: re-invoking an existing runId continues from its
 * last durable checkpoint instead of repeating completed side effects.
 */
export async function runFlow({
  runId,
  userId,
  graph,
  trigger,
  resume = true,
  maxSteps,
  database = defaultDb,
}: {
  runId: string;
  userId: string;
  graph: FlowGraph;
  trigger?: unknown;
  resume?: boolean;
  maxSteps?: number;
  database?: Database;
}): Promise<RunFlowResult> {
  loadSteps();

  const result = await executeFlow({
    runId,
    graph,
    initialState: { trigger },
    store: new DatabaseCheckpointStore(database),
    resolveStep: createDatabaseStepResolver(database, userId),
    resume,
    maxSteps,
    log: (event, data) => {
      console.log(`[engine] run=${runId} ${event}`, data ?? "");
    },
  });

  await new EnginePersistenceRepository(database).finishRun({
    runId,
    status: result.status,
    state: result.state,
    trace: result.trace,
    error: result.error
      ? {
          message: result.error.message,
          nodeId: result.error.nodeId,
          code: result.error.code,
        }
      : null,
    finishedAt: new Date(),
  });

  return {
    status: result.status,
    trace: result.trace,
    ...(result.error
      ? {
          error: {
            message: result.error.message,
            nodeId: result.error.nodeId,
            code: result.error.code,
          },
        }
      : {}),
  };
}
