import { firstNode, nextNode, validateGraph } from "./graph";
import {
  CHECKPOINT_FORMAT,
  DEFAULT_MAX_STEPS,
  type ExecuteFlowOptions,
  type FlowCheckpointRecord,
  type FlowError,
  type FlowGraph,
  type FlowNode,
  type FlowResult,
  type RunJournalEntry,
  type StoredCheckpoint,
  type TraceEntry,
} from "./types";

/**
 * The durable execution loop.
 *
 * Responsibilities:
 *   1. validate the graph before any side effect;
 *   2. replay the checkpoint journal to restore state, trace, and cursor;
 *   3. execute nodes, choosing exactly one guarded edge after each;
 *   4. append a journal record before moving on, so a crash loses at most the
 *      node currently in flight;
 *   5. stop on critical failure, cycle, or the step ceiling.
 *
 * The host owns persistence and step implementation through ports; this module
 * has no imports from the application.
 */

type JournalEntry = RunJournalEntry;

type ReplayResult = {
  state: Record<string, unknown>;
  trace: TraceEntry[];
  journal: JournalEntry[];
  next: FlowNode | null;
  completed: boolean;
  error?: FlowError;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeJournal(
  records: readonly StoredCheckpoint[],
): JournalEntry[] {
  return records
    .map((record, index) => ({
      ...record,
      seq:
        typeof record.seq === "number" && Number.isFinite(record.seq)
          ? record.seq
          : index + 1,
      nodeType:
        typeof record.nodeType === "string" ? record.nodeType : "unknown",
      ms: typeof record.ms === "number" ? record.ms : 0,
      at: typeof record.at === "string" ? record.at : "",
      // Journals written before this format only checkpointed tolerated
      // (best-effort) failures, so legacy errors continue by default.
      continued:
        typeof record.continued === "boolean" ? record.continued : true,
    }))
    .sort((left, right) => left.seq - right.seq);
}

/**
 * Rebuilds state and cursor from the journal. New records carry the exact
 * post-node state and chosen edge; legacy records are reconstructed by merging
 * successful outputs and re-evaluating the graph, never by re-running steps.
 */
function replayJournal({
  graph,
  initialState,
  records,
}: {
  graph: FlowGraph;
  initialState: Record<string, unknown>;
  records: readonly StoredCheckpoint[];
}): ReplayResult {
  const journal = normalizeJournal(records);
  let state = { ...initialState };
  const trace: TraceEntry[] = [];
  let next: FlowNode | null = firstNode(graph);
  let last: { entry: JournalEntry; node: FlowNode } | null = null;

  for (const entry of journal) {
    const node = graph.nodes.find((candidate) => candidate.id === entry.nodeId);
    if (!node) {
      return {
        state,
        trace,
        journal,
        next: null,
        completed: false,
        error: {
          message: `Checkpoint references node "${entry.nodeId}", which is not in this graph`,
          nodeId: entry.nodeId,
          code: "resume_conflict",
        },
      };
    }

    trace.push({
      nodeId: entry.nodeId,
      type: entry.nodeType === "unknown" ? node.type : entry.nodeType,
      status: entry.status,
      ms: entry.ms,
      output: entry.output,
    });

    if (entry.state) {
      state = { ...entry.state };
    } else if (entry.status === "ok" && isPlainObject(entry.output)) {
      state = { ...state, ...entry.output };
    }

    if (entry.nextNodeId !== undefined) {
      if (entry.nextNodeId === null) {
        next = null;
      } else {
        next =
          graph.nodes.find((candidate) => candidate.id === entry.nextNodeId) ??
          null;
        if (!next) {
          return {
            state,
            trace,
            journal,
            next: null,
            completed: false,
            error: {
              message: `Checkpoint at "${entry.nodeId}" points to missing node "${entry.nextNodeId}"`,
              nodeId: entry.nodeId,
              code: "resume_conflict",
            },
          };
        }
      }
    } else {
      next = nextNode(graph, node, state);
    }

    last = { entry, node };
  }

  if (!last) {
    return {
      state,
      trace,
      journal,
      next,
      completed: next === null,
    };
  }

  // A critical failure stopped the run at this node. Retry that node rather
  // than treating its null edge as a completed run.
  if (last.entry.continued === false) {
    return {
      state,
      trace,
      journal,
      next: last.node,
      completed: false,
    };
  }

  return {
    state,
    trace,
    journal,
    next,
    completed: next === null,
  };
}

function failed(
  state: Record<string, unknown>,
  trace: TraceEntry[],
  journal: JournalEntry[],
  error: FlowError,
): FlowResult {
  return {
    status: "failed",
    state,
    trace,
    checkpoints: journal,
    error,
  };
}

function recordFor({
  seq,
  node,
  status,
  ms,
  at,
  output,
  state,
  nextNodeId,
  continued,
}: {
  seq: number;
  node: FlowNode;
  status: "ok" | "error";
  ms: number;
  at: string;
  output: unknown;
  state: Record<string, unknown>;
  nextNodeId: string | null;
  continued: boolean;
}): FlowCheckpointRecord {
  return {
    format: CHECKPOINT_FORMAT,
    seq,
    nodeId: node.id,
    nodeType: node.type,
    status,
    ms,
    at,
    output,
    state: { ...state },
    nextNodeId,
    continued,
  };
}

function nextSeq(journal: readonly JournalEntry[]): number {
  return (journal.at(-1)?.seq ?? 0) + 1;
}

async function append(
  store: ExecuteFlowOptions["store"],
  runId: string,
  record: FlowCheckpointRecord,
): Promise<FlowError | null> {
  try {
    await store.append(runId, record);
    return null;
  } catch (error) {
    return {
      message: `Could not persist checkpoint: ${messageOf(error)}`,
      nodeId: record.nodeId,
      code: "checkpoint_failed",
    };
  }
}

/** Executes (or resumes) one run of a flow graph. */
export async function executeFlow(
  options: ExecuteFlowOptions,
): Promise<FlowResult> {
  const {
    runId,
    graph,
    store,
    resolveStep,
    log = () => {},
    now = Date.now,
  } = options;
  const initialState = isPlainObject(options.initialState)
    ? { ...options.initialState }
    : {};
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const cyclePolicy = options.cyclePolicy ?? "fail";
  const resume = options.resume ?? true;

  const validation = validateGraph(graph);
  if (!validation.valid) {
    return failed(initialState, [], [], {
      message: `Invalid flow graph: ${validation.errors.join("; ")}`,
      nodeId: "graph",
      code: "invalid_graph",
    });
  }

  let records: readonly StoredCheckpoint[] = [];
  if (resume) {
    try {
      records = await store.load(runId);
    } catch (error) {
      return failed(initialState, [], [], {
        message: `Could not load checkpoints: ${messageOf(error)}`,
        nodeId: "graph",
        code: "checkpoint_failed",
      });
    }
  }

  const replay = replayJournal({
    graph,
    initialState,
    records,
  });
  const journal = replay.journal;
  const trace = replay.trace;
  let state = replay.state;

  if (replay.error) {
    return failed(state, trace, journal, replay.error);
  }
  if (replay.completed) {
    return { status: "completed", state, trace, checkpoints: journal };
  }

  const replayedSteps = journal.length;
  let executed = 0;
  const visited = new Set<string>();
  let node = replay.next;

  while (node) {
    if (replayedSteps + executed >= maxSteps) {
      return failed(state, trace, journal, {
        message: `Flow exceeded the ${maxSteps}-step ceiling`,
        nodeId: node.id,
        code: "max_steps",
      });
    }
    if (cyclePolicy === "fail" && visited.has(node.id)) {
      return failed(state, trace, journal, {
        message: `Flow revisited node "${node.id}" (cycle detected)`,
        nodeId: node.id,
        code: "cycle_detected",
      });
    }

    visited.add(node.id);
    executed += 1;

    const adapter = resolveStep(node.type);
    const startedAt = now();
    let output: unknown;
    let failure: string | null = null;

    if (!adapter) {
      failure = `Unknown step type "${node.type}"`;
    } else {
      try {
        // Parse inside the guard: an invalid config is a node failure, not an
        // exception that escapes the runtime and strands the run.
        const input = adapter.parseConfig(node.config ?? {});
        output = await adapter.execute({
          runId,
          nodeId: node.id,
          state,
          input,
          log,
        });
      } catch (error) {
        failure = messageOf(error);
      }
    }

    const finishedAt = now();
    const ms = Math.max(0, finishedAt - startedAt);
    const at = new Date(finishedAt).toISOString();

    if (failure !== null) {
      const bestEffort = adapter?.policy === "best_effort";

      if (bestEffort) {
        const failureOutput = { message: failure };
        trace.push({
          nodeId: node.id,
          type: node.type,
          status: "error",
          ms,
          output: failureOutput,
        });
        const next = nextNode(graph, node, state);
        const record = recordFor({
          seq: nextSeq(journal),
          node,
          status: "error",
          ms,
          at,
          output: failureOutput,
          state,
          nextNodeId: next?.id ?? null,
          continued: true,
        });
        const checkpointError = await append(store, runId, record);
        if (checkpointError) return failed(state, trace, journal, checkpointError);
        journal.push(record);
        node = next;
        continue;
      }

      const failureOutput = { message: failure, nodeId: node.id };
      trace.push({
        nodeId: node.id,
        type: node.type,
        status: "error",
        ms,
        output: failureOutput,
      });
      const record = recordFor({
        seq: nextSeq(journal),
        node,
        status: "error",
        ms,
        at,
        output: failureOutput,
        state,
        nextNodeId: null,
        continued: false,
      });
      const checkpointError = await append(store, runId, record);
      if (checkpointError) return failed(state, trace, journal, checkpointError);
      journal.push(record);

      return failed(state, trace, journal, {
        message: failure,
        nodeId: node.id,
        code: adapter ? "step_failed" : "unknown_step",
      });
    }

    const nextState = isPlainObject(output) ? { ...state, ...output } : state;
    const next = nextNode(graph, node, nextState);

    trace.push({
      nodeId: node.id,
      type: node.type,
      status: "ok",
      ms,
      output,
    });

    const record = recordFor({
      seq: nextSeq(journal),
      node,
      status: "ok",
      ms,
      at,
      output,
      state: nextState,
      nextNodeId: next?.id ?? null,
      continued: true,
    });
    const checkpointError = await append(store, runId, record);
    if (checkpointError) return failed(state, trace, journal, checkpointError);
    journal.push(record);

    state = nextState;
    node = next;
  }

  return { status: "completed", state, trace, checkpoints: journal };
}
