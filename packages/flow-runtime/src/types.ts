/**
 * Public contracts for the Tartly Flow Runtime.
 *
 * The runtime is deliberately framework-free: it knows nothing about Next.js,
 * Postgres, Zod, mail, or authentication. Adapters supply those concerns. That
 * boundary is what makes the engine replayable and testable in isolation.
 */

/** A node is one step invocation plus its JSON config. */
export type FlowNode = {
  id: string;
  type: string;
  config?: Record<string, unknown>;
};

/** A guard evaluated against the accumulated run state. */
export type EdgeCondition = {
  field: string;
  equals?: unknown;
  notEquals?: unknown;
  truthy?: boolean;
};

/** A directed edge. The first matching edge from a node wins. */
export type FlowEdge = {
  from: string;
  to: string;
  when?: EdgeCondition;
};

/** A workflow graph. Array order is part of the contract. */
export type FlowGraph = {
  nodes: FlowNode[];
  edges: FlowEdge[];
};

/**
 * `critical` aborts the run on failure (the default).
 * `best_effort` records the failure and continues along the normal edge.
 */
export type StepPolicy = "critical" | "best_effort";

export type RuntimeLog = (event: string, data?: unknown) => void;

export type StepExecution<I = unknown> = {
  runId: string;
  nodeId: string;
  /** State accumulated before this node. Treat it as read-only. */
  state: Readonly<Record<string, unknown>>;
  input: I;
  log: RuntimeLog;
};

/**
 * The runtime's view of a step. The host application adapts its own step
 * definitions (Zod schemas, database handles, auth) to this port.
 */
export interface StepAdapter<I = unknown, O = unknown> {
  type: string;
  policy?: StepPolicy;
  /** Throws when the node config is invalid; the runtime treats that as a step failure. */
  parseConfig(config: Record<string, unknown>): I;
  execute(execution: StepExecution<I>): Promise<O>;
}

export type StepResolver = (
  type: string,
) => StepAdapter<unknown, unknown> | undefined;

export type TraceEntry = {
  nodeId: string;
  type: string;
  status: "ok" | "error";
  ms: number;
  output?: unknown;
};

/** Version tag stored with every checkpoint so old journals stay readable. */
export const CHECKPOINT_FORMAT = "tartly.flow-runtime/1";

/**
 * One journal entry per node outcome. The stored `state` and `nextNodeId` let a
 * resumed run continue from the exact position it reached, without replaying
 * side effects or guessing which branch the graph took.
 */
export type FlowCheckpointRecord = {
  format: typeof CHECKPOINT_FORMAT;
  /** Monotonic per-run sequence number (1-based). */
  seq: number;
  nodeId: string;
  nodeType: string;
  status: "ok" | "error";
  ms: number;
  at: string;
  /** Raw step output (unwrapped; the host decides how to persist it). */
  output: unknown;
  /** Full run state after this node. Unchanged when the node failed. */
  state: Record<string, unknown>;
  /** Edge chosen after this node, or null when the run stops here. */
  nextNodeId: string | null;
  /**
   * False only for a critical failure that terminated the run. A resumed run
   * retries that node instead of trusting `nextNodeId`.
   */
  continued: boolean;
};

/**
 * What a store returns. New records carry every field; journals written before
 * the runtime existed may only have `nodeId`, `status`, and `output`, so resume
 * replays those by merging outputs and re-evaluating the graph.
 */
export type StoredCheckpoint = {
  seq?: number;
  nodeId: string;
  nodeType?: string;
  status: "ok" | "error";
  ms?: number;
  at?: string;
  output: unknown;
  state?: Record<string, unknown>;
  nextNodeId?: string | null;
  continued?: boolean;
};

/**
 * A normalized journal entry as returned by a run. Legacy records gain the
 * defaulted fields during replay; `state`/`nextNodeId` stay optional so the
 * runtime knows whether it must reconstruct them from the graph.
 */
export type RunJournalEntry = StoredCheckpoint & {
  seq: number;
  nodeType: string;
  ms: number;
  at: string;
  continued: boolean;
};

/**
 * Durable journal port. Implementations must return records in execution order
 * (or with `seq`, which the runtime sorts on) and append before resolving.
 */
export interface CheckpointStore {
  load(runId: string): Promise<readonly StoredCheckpoint[]>;
  append(runId: string, checkpoint: FlowCheckpointRecord): Promise<void>;
}

export type FlowErrorCode =
  | "invalid_graph"
  | "unknown_step"
  | "step_failed"
  | "max_steps"
  | "cycle_detected"
  | "checkpoint_failed"
  | "resume_conflict";

export type FlowError = {
  message: string;
  nodeId: string;
  code: FlowErrorCode;
};

export type FlowResult = {
  status: "completed" | "failed";
  state: Record<string, unknown>;
  trace: TraceEntry[];
  /** Journal entries replayed plus entries appended during this invocation. */
  checkpoints: RunJournalEntry[];
  error?: FlowError;
};

export type ExecuteFlowOptions = {
  runId: string;
  graph: FlowGraph;
  /** State before the first node (usually `{ trigger }`). */
  initialState?: Record<string, unknown>;
  store: CheckpointStore;
  resolveStep: StepResolver;
  /** Default true: a run with journal entries resumes instead of restarting. */
  resume?: boolean;
  /** Total node executions allowed for the run, including replayed entries. */
  maxSteps?: number;
  /** Default `fail`: revisiting a node in one invocation aborts the run. */
  cyclePolicy?: "fail" | "allow";
  log?: RuntimeLog;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
};

/** A conservative ceiling well above the deepest shipped graph. */
export const DEFAULT_MAX_STEPS = 256;

export type GraphValidation =
  | { valid: true }
  | { valid: false; errors: string[] };
