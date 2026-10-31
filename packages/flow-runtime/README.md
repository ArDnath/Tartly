# @tartly/flow-runtime

A **deterministic, checkpointed step-graph runtime**. It executes a graph of
typed steps, chooses exactly one guarded edge after each node, writes a journal
entry before continuing, and can resume or replay a run from that journal.

The runtime has **no application dependencies** — no Next.js, Postgres, Redis,
Zod, mail, or auth imports. A host supplies two ports:

```ts
type StepResolver = (type: string) => StepAdapter | undefined;
interface CheckpointStore {
  load(runId: string): Promise<readonly StoredCheckpoint[]>;
  append(runId: string, checkpoint: FlowCheckpointRecord): Promise<void>;
}
```

## Why it exists

Automation that touches the outside world must survive a process restart without
repeating a side effect or guessing where it stopped. A plain `while (node)`
loop cannot: its only record of progress is memory. This runtime treats the
**journal as the source of truth** and makes the next node part of the record.

## Guarantees

| Guarantee | Mechanism |
| --- | --- |
| Deterministic routing | First matching edge in array order; conditions are pure predicates over state |
| Validated graphs | Duplicate ids, missing endpoints, malformed configs and guards are rejected before any step runs |
| At-most-one in-flight node | A checkpoint is appended after every node outcome, before the next node starts |
| Resume without re-running | Journal stores the post-node state and chosen `nextNodeId`; replay restores them |
| Replay without side effects | Replay rebuilds state/trace from records only; steps are never re-invoked during replay |
| Tolerated failures | `best_effort` steps record an error and continue; `critical` steps stop and are retried on resume |
| No runaway graphs | Per-run step ceiling plus an optional repeated-node cycle guard |
| Host independence | Steps and persistence are injected ports; the core is pure TypeScript |

## Example

```ts
import { executeFlow, createMemoryCheckpointStore } from "@tartly/flow-runtime";

const store = createMemoryCheckpointStore();

const result = await executeFlow({
  runId: "run-1",
  graph: {
    nodes: [
      { id: "classify", type: "classify" },
      { id: "draft", type: "draft" },
      { id: "send", type: "send" },
    ],
    edges: [
      { from: "classify", to: "send", when: { field: "decision", equals: "send" } },
      { from: "classify", to: "draft", when: { field: "decision", equals: "draft" } },
      { from: "draft", to: "send" },
    ],
  },
  store,
  resolveStep: (type) => steps[type],
});
```

`executeFlow` runs to completion, or to a terminal failure, and returns
`{ status, state, trace, checkpoints, error? }`.

## Resume

Calling `executeFlow` again with the same `runId` and store resumes by default:

1. load and normalize the journal (legacy `{ nodeId, status, output }` records
   are still replayable);
2. rebuild state and trace;
3. continue at the recorded `nextNodeId`;
4. retry a node only when its record says a **critical** failure stopped there.

A completed run is a no-op: replay returns the same trace and state without
executing a step.

## Semantics

See [SPEC.md](./SPEC.md) for the full execution model, journal schema, and
failure codes.
