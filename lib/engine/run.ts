import "server-only";

import { nanoid } from "nanoid";

import { db as defaultDb, type Database } from "@/lib/db";
import { type TraceEntry } from "@/lib/db/schema";
import { EnginePersistenceRepository } from "@/lib/repositories/engine-persistence";
import {
  firstNode,
  nextNode,
  type FlowGraph,
} from "@/lib/engine/flow";
import { getStep, loadSteps } from "@/lib/engine/registry";

export type RunFlowResult = {
  status: "completed" | "failed";
  trace: TraceEntry[];
  error?: { message: string; nodeId: string };
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function checkpoint({
  database,
  runId,
  nodeId,
  status,
  output,
}: {
  database: Database;
  runId: string;
  nodeId: string;
  status: "ok" | "error";
  output: unknown;
}): Promise<void> {
  await new EnginePersistenceRepository(database).insertCheckpoint({
    id: nanoid(),
    runId,
    nodeId,
    status,
    output: { value: output ?? null },
  });
}

async function finishRun({
  database,
  runId,
  status,
  state,
  trace,
  error,
}: {
  database: Database;
  runId: string;
  status: "completed" | "failed";
  state: Record<string, unknown>;
  trace: TraceEntry[];
  error?: { message: string; nodeId: string };
}): Promise<void> {
  await new EnginePersistenceRepository(database).finishRun({
    runId,
    status,
    state,
    trace,
    error: error ?? null,
    finishedAt: new Date(),
  });
}

/**
 * Executes a flow graph node by node, checkpointing every result.
 *
 * `critical` steps (the default) abort the run on error; `best_effort` steps
 * record the error and let the run continue. The run row's `trace` is the
 * source of truth for the run panel and evaluations.
 */
export async function runFlow({
  runId,
  userId,
  graph,
  trigger,
  database = defaultDb,
}: {
  runId: string;
  userId: string;
  graph: FlowGraph;
  trigger?: unknown;
  database?: Database;
}): Promise<RunFlowResult> {
  loadSteps();

  let state: Record<string, unknown> = { trigger };
  const trace: TraceEntry[] = [];
  let node = firstNode(graph);

  const log = (event: string, data?: unknown) => {
    console.log(`[engine] run=${runId} ${event}`, data ?? "");
  };

  while (node) {
    const step = getStep(node.type);
    if (!step) {
      const error = { message: `Unknown step type "${node.type}"`, nodeId: node.id };
      trace.push({
        nodeId: node.id,
        type: node.type,
        status: "error",
        ms: 0,
        output: error,
      });
      await finishRun({
        database,
        runId,
        status: "failed",
        state,
        trace,
        error,
      });
      return { status: "failed", trace, error };
    }

    const startedAt = Date.now();

    try {
      // Parse the node config *inside* the try so a bad schema marks the run
      // failed (or best_effort continues) instead of escaping `runFlow` and
      // leaving the run row stuck in "running" forever.
      const input = step.configSchema.parse(node.config ?? {});
      const output = await step.run({
        db: database,
        userId,
        runId,
        state,
        log,
        input,
      });
      const ms = Date.now() - startedAt;

      await checkpoint({
        database,
        runId,
        nodeId: node.id,
        status: "ok",
        output,
      });
      trace.push({
        nodeId: node.id,
        type: node.type,
        status: "ok",
        ms,
        output,
      });
      if (isPlainObject(output)) state = { ...state, ...output };
    } catch (error) {
      const ms = Date.now() - startedAt;
      const message =
        error instanceof Error ? error.message : String(error);

      if ((step.policy ?? "critical") === "best_effort") {
        await checkpoint({
          database,
          runId,
          nodeId: node.id,
          status: "error",
          output: { message },
        });
        trace.push({
          nodeId: node.id,
          type: node.type,
          status: "error",
          ms,
          output: { message },
        });
      } else {
        const failure = { message, nodeId: node.id };
        trace.push({
          nodeId: node.id,
          type: node.type,
          status: "error",
          ms,
          output: failure,
        });
        await finishRun({
          database,
          runId,
          status: "failed",
          state,
          trace,
          error: failure,
        });
        return { status: "failed", trace, error: failure };
      }
    }

    node = nextNode(graph, node, state);
  }

  await finishRun({ database, runId, status: "completed", state, trace });
  return { status: "completed", trace };
}
