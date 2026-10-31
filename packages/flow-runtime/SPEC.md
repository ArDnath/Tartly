# Flow Runtime Specification

## 1. Model

A **graph** is `{ nodes, edges }`. Node order is authored; the run starts at
`nodes[0]`. An empty graph completes immediately with the initial state.

A **node** is `{ id, type, config? }`. `id` is unique and stable; `type`
resolves a step adapter; `config` is parsed by the adapter before execution.

An **edge** is `{ from, to, when? }`. `when` is a guard:

- `equals`: state value must be strictly equal;
- `notEquals`: state value must not be strictly equal;
- `truthy`: `Boolean(state[field])` must equal the flag.

All declared predicates must pass. A missing field is `undefined`, so
`{ notEquals: "none" }` matches an absent field. An edge without `when` always
matches.

**Routing is deterministic.** After a node, the runtime scans `edges` in array
order and takes the first edge whose `from` equals the node id and whose guard
passes. No other ordering or randomness is involved.

## 2. State

Initial state is supplied by the host (typically `{ trigger }`).

After a successful node:

```ts
nextState = isPlainObject(output) ? { ...state, ...output } : state;
```

A failed node never merges output. State is copied at every merge and stored in
the checkpoint, so later mutation of a step's return object cannot rewrite
history.

## 3. Journal

The journal is a small durable-execution protocol: a versioned, self-describing
record that any store can persist and any replay implementation can consume.
Every node outcome appends one `FlowCheckpointRecord`:

```ts
{
  format: "tartly.flow-runtime/1",
  seq: number,                 // monotonic within the run
  nodeId: string,
  nodeType: string,
  status: "ok" | "error",
  ms: number,
  at: string,                  // ISO timestamp
  output: unknown,             // raw step output
  state: Record<string, unknown>, // post-node state
  nextNodeId: string | null,   // recorded routing decision
  continued: boolean           // false only for a terminal critical failure
}
```

The record is appended **before** the next node begins. A crash can therefore
lose at most the node in flight; every completed node is durable.

`nextNodeId` is recorded rather than recomputed because routing is part of the
run's history. If the graph changes after the run started, resume still follows
the branch the original run chose.

## 4. Resume and replay

`executeFlow` resumes by default. It loads the journal, sorts by `seq`, and
replays:

- trace entries are rebuilt from `nodeId`, `nodeType`, `status`, `ms`, `output`;
- state comes from the record's stored `state`;
- the cursor comes from `nextNodeId`;
- step adapters are **not** invoked during replay.

Legacy records without `state`/`nextNodeId` are reconstructed by merging
successful plain-object outputs and re-evaluating the graph from the node id.
Legacy error records are treated as tolerated (best-effort) failures, matching
the only failures earlier versions checkpointed.

Terminal cases:

| Last record | Resume behaviour |
| --- | --- |
| none | start at `nodes[0]` |
| `continued: true`, `nextNodeId: null` | run is complete; no-op |
| `continued: true`, `nextNodeId: X` | continue at X |
| `continued: false` | retry the failed node |

If a record references a node or edge target that no longer exists, the runtime
fails with `resume_conflict` rather than silently skipping history.

## 5. Failure policy

- **`critical`** (default): record the failure, set `continued: false`, stop,
  return `status: "failed"`.
- **`best_effort`**: record the failure, keep state unchanged, set
  `continued: true`, compute the normal edge from the unchanged state, continue.

Unknown step types are critical failures (`unknown_step`). Invalid node config
is a step failure (`step_failed`) because parsing happens inside the node guard.

## 6. Guards

- **Step ceiling** (`maxSteps`, default 256): counts replayed journal entries
  plus nodes executed in this invocation. Exceeding it fails with `max_steps`.
- **Cycle guard** (`cyclePolicy`, default `fail`): a node id visited twice in one
  invocation fails with `cycle_detected`. Set `allow` for intentional loops; the
  step ceiling still bounds them.

Both guards fire *before* executing the offending node, so they never leave a
half-recorded step.

## 7. Failure codes

| Code | Meaning |
| --- | --- |
| `invalid_graph` | Structural validation failed before execution |
| `unknown_step` | No adapter resolved for `node.type` |
| `step_failed` | Config parse or step execution threw on a critical step |
| `max_steps` | Step ceiling reached |
| `cycle_detected` | Node revisited while the cycle guard is enabled |
| `checkpoint_failed` | The journal could not be loaded or appended |
| `resume_conflict` | Journal references a node/edge absent from the graph |

## 8. Ports

```ts
interface CheckpointStore {
  load(runId: string): Promise<readonly StoredCheckpoint[]>;
  append(runId: string, checkpoint: FlowCheckpointRecord): Promise<void>;
}

interface StepAdapter<I, O> {
  type: string;
  policy?: "critical" | "best_effort";
  parseConfig(config: Record<string, unknown>): I;
  execute(ctx: {
    runId: string;
    nodeId: string;
    state: Readonly<Record<string, unknown>>;
    input: I;
    log: (event: string, data?: unknown) => void;
  }): Promise<O>;
}
```

`append` must be durable before it resolves. `load` may return records in any
order if every record has `seq`; otherwise it must preserve execution order.
