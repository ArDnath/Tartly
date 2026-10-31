import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createMemoryCheckpointStore,
  entryNodes,
  evaluateCondition,
  executeFlow,
  validateGraph,
  type CheckpointStore,
  type FlowCheckpointRecord,
  type FlowGraph,
  type StepAdapter,
  type StepPolicy,
  type StepResolver,
} from "@tartly/flow-runtime";

/**
 * The runtime is pure, so every guarantee is exercised in memory:
 * deterministic routing, validation, journal ordering, resume/replay,
 * critical vs best-effort failures, and the termination guards.
 */

function step(
  type: string,
  execute: StepAdapter["execute"],
  policy?: StepPolicy,
): StepAdapter {
  return {
    type,
    policy,
    parseConfig: (config) => config,
    execute,
  };
}

function resolver(...steps: StepAdapter[]): StepResolver {
  const byType = new Map(steps.map((definition) => [definition.type, definition]));
  return (type) => byType.get(type);
}

function emit(key: string, value: unknown, type = "emit"): StepAdapter {
  return step(type, async () => ({ [key]: value }));
}

describe("graph guards", () => {
  it("keeps the core free of application and infrastructure imports", () => {
    const sourceDir = join(process.cwd(), "packages/flow-runtime/src");
    const files = readdirSync(sourceDir).filter((file) => file.endsWith(".ts"));
    const forbidden =
      /from\s+["'](?:@\/|next(?:\/|["'])|react|drizzle-orm|pg["']|@upstash|server-only|client-only)/;

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(join(sourceDir, file), "utf8");
      expect(source, `${file} must not import app infrastructure`).not.toMatch(
        forbidden,
      );
    }

    const manifest = JSON.parse(
      readFileSync(
        join(process.cwd(), "packages/flow-runtime/package.json"),
        "utf8",
      ),
    ) as { dependencies?: Record<string, string> };
    expect(manifest.dependencies).toBeUndefined();
  });

  it("evaluates every predicate and treats a missing field as undefined", () => {
    expect(evaluateCondition(undefined, {})).toBe(true);
    expect(
      evaluateCondition({ field: "decision", equals: "send" }, { decision: "send" }),
    ).toBe(true);
    expect(
      evaluateCondition({ field: "decision", equals: "send" }, { decision: "draft" }),
    ).toBe(false);
    expect(
      evaluateCondition({ field: "missing", notEquals: "none" }, {}),
    ).toBe(true);
    expect(
      evaluateCondition({ field: "action", notEquals: "none" }, { action: "none" }),
    ).toBe(false);
    expect(evaluateCondition({ field: "isMeeting", truthy: true }, { isMeeting: 1 })).toBe(
      true,
    );
    expect(evaluateCondition({ field: "isMeeting", truthy: false }, {})).toBe(true);
    expect(
      evaluateCondition(
        { field: "action", notEquals: "none", truthy: true },
        { action: "reply" },
      ),
    ).toBe(true);
  });

  it("rejects duplicate ids, missing endpoints and malformed guards", () => {
    expect(validateGraph({ nodes: [], edges: [] })).toEqual({ valid: true });

    expect(
      validateGraph({
        nodes: [
          { id: "a", type: "emit" },
          { id: "a", type: "emit" },
        ],
        edges: [],
      }),
    ).toMatchObject({ valid: false });

    expect(
      validateGraph({
        nodes: [{ id: "a", type: "emit" }],
        edges: [{ from: "a", to: "missing" }],
      }),
    ).toMatchObject({ valid: false });

    expect(
      validateGraph({
        nodes: [{ id: "a", type: "emit" }],
        edges: [{ from: "a", to: "a", when: { field: "" } }],
      }),
    ).toMatchObject({ valid: false });

    expect(
      validateGraph({
        nodes: [{ id: "a", type: "emit", config: [] as unknown as Record<string, unknown> }],
        edges: [],
      }),
    ).toMatchObject({ valid: false });

    expect(
      validateGraph({
        nodes: null,
        edges: [],
      } as unknown as FlowGraph),
    ).toMatchObject({ valid: false });

    expect(
      validateGraph({
        nodes: [{ id: "a", type: "emit" }],
        edges: [
          null,
          { from: "a", to: "a", when: "always" },
        ] as unknown as FlowGraph["edges"],
      }),
    ).toMatchObject({ valid: false });
  });

  it("lists entry nodes and exposes a resettable in-memory journal", async () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "a", type: "emit" },
        { id: "b", type: "emit" },
        { id: "c", type: "emit" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    };

    expect(entryNodes(graph).map((node) => node.id)).toEqual(["a"]);

    const store = createMemoryCheckpointStore({
      "run-memory": [{ nodeId: "a", status: "ok", output: { seeded: true } }],
    });
    expect(store.records("run-memory")).toHaveLength(1);

    const record: FlowCheckpointRecord = {
      format: "tartly.flow-runtime/1",
      seq: 2,
      nodeId: "b",
      nodeType: "emit",
      status: "ok",
      ms: 1,
      at: "2026-01-01T00:00:00.000Z",
      output: { appended: true },
      state: { seeded: true, appended: true },
      nextNodeId: null,
      continued: true,
    };
    await store.append("run-memory", record);
    expect(store.records("run-memory")).toHaveLength(2);

    store.reset("run-memory");
    expect(store.records("run-memory")).toHaveLength(0);

    await store.append("run-other", record);
    store.reset();
    expect(store.records("run-other")).toHaveLength(0);
  });
});

describe("executeFlow", () => {
  it("runs the first matching edge and merges object outputs", async () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "start", type: "emit", config: { decision: "send" } },
        { id: "send", type: "emit", config: { sent: true } },
        { id: "draft", type: "emit", config: { drafted: true } },
      ],
      edges: [
        { from: "start", to: "draft", when: { field: "decision", equals: "draft" } },
        { from: "start", to: "send", when: { field: "decision", equals: "send" } },
      ],
    };

    const result = await executeFlow({
      runId: "run-branch",
      graph,
      store: createMemoryCheckpointStore(),
      resolveStep: resolver(
        step("emit", async ({ input }) => input as Record<string, unknown>),
      ),
    });

    expect(result.status).toBe("completed");
    expect(result.trace.map((entry) => entry.nodeId)).toEqual(["start", "send"]);
    expect(result.state).toMatchObject({ decision: "send", sent: true });
    expect(result.checkpoints.map((record) => record.seq)).toEqual([1, 2]);
  });

  it("leaves state unchanged when a step returns a non-object", async () => {
    const result = await executeFlow({
      runId: "run-scalar",
      graph: {
        nodes: [
          { id: "a", type: "scalar" },
          { id: "b", type: "emit", config: { done: true } },
        ],
        edges: [{ from: "a", to: "b" }],
      },
      initialState: { trigger: "t" },
      store: createMemoryCheckpointStore(),
      resolveStep: resolver(
        step("scalar", async () => 42),
        emit("done", true),
      ),
    });

    expect(result.status).toBe("completed");
    expect(result.state).toEqual({ trigger: "t", done: true });
  });

  it("stops a critical failure and resumes by retrying only that node", async () => {
    let firstCalls = 0;
    let failingCalls = 0;
    let finalCalls = 0;
    const callsBeforeFailure: string[] = [];

    const graph: FlowGraph = {
      nodes: [
        { id: "first", type: "first" },
        { id: "flaky", type: "flaky" },
        { id: "final", type: "final" },
      ],
      edges: [
        { from: "first", to: "flaky" },
        { from: "flaky", to: "final" },
      ],
    };

    const failing = resolver(
      step("first", async () => {
        firstCalls += 1;
        callsBeforeFailure.push("first");
        return { ready: true };
      }),
      step("flaky", async () => {
        failingCalls += 1;
        throw new Error("temporary failure");
      }),
      step("final", async () => {
        finalCalls += 1;
        return { done: true };
      }),
    );

    const store = createMemoryCheckpointStore();
    const first = await executeFlow({
      runId: "run-resume",
      graph,
      store,
      resolveStep: failing,
    });

    expect(first.status).toBe("failed");
    expect(first.error).toMatchObject({ nodeId: "flaky", code: "step_failed" });
    expect(first.trace.map((entry) => entry.status)).toEqual(["ok", "error"]);
    expect(first.checkpoints.at(-1)).toMatchObject({
      nodeId: "flaky",
      status: "error",
      continued: false,
    });
    expect(callsBeforeFailure).toEqual(["first"]);

    const recovered = resolver(
      step("first", async () => {
        firstCalls += 1;
        return { ready: true };
      }),
      step("flaky", async () => {
        failingCalls += 1;
        return { recovered: true };
      }),
      step("final", async () => {
        finalCalls += 1;
        return { done: true };
      }),
    );

    const resumed = await executeFlow({
      runId: "run-resume",
      graph,
      store,
      resolveStep: recovered,
    });

    expect(resumed.status).toBe("completed");
    expect(firstCalls).toBe(1);
    expect(failingCalls).toBe(2);
    expect(finalCalls).toBe(1);
    expect(resumed.trace.map((entry) => `${entry.nodeId}:${entry.status}`)).toEqual([
      "first:ok",
      "flaky:error",
      "flaky:ok",
      "final:ok",
    ]);
    expect(resumed.state).toMatchObject({ ready: true, recovered: true, done: true });
    expect(resumed.checkpoints.map((record) => record.seq)).toEqual([1, 2, 3, 4]);
  });

  it("resumes at the in-flight node after a crash without replaying completed nodes", async () => {
    const calls: string[] = [];
    const graph: FlowGraph = {
      nodes: [
        { id: "a", type: "a" },
        { id: "b", type: "b" },
        { id: "c", type: "c" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    };

    const result = await executeFlow({
      runId: "run-crash",
      graph,
      store: createMemoryCheckpointStore({
        "run-crash": [
          {
            seq: 1,
            nodeId: "a",
            nodeType: "a",
            status: "ok",
            ms: 4,
            at: "2026-01-01T00:00:00.000Z",
            output: { ready: true },
            state: { ready: true },
            nextNodeId: "b",
            continued: true,
          },
        ],
      }),
      resolveStep: resolver(
        step("a", async () => {
          calls.push("a");
          return { ready: true };
        }),
        step("b", async () => {
          calls.push("b");
          return { middle: true };
        }),
        step("c", async () => {
          calls.push("c");
          return { done: true };
        }),
      ),
    });

    expect(result.status).toBe("completed");
    expect(calls).toEqual(["b", "c"]);
    expect(result.trace.map((entry) => entry.nodeId)).toEqual(["a", "b", "c"]);
    expect(result.state).toEqual({ ready: true, middle: true, done: true });
  });

  it("orders journal entries by seq even when the store returns them out of order", async () => {
    const result = await executeFlow({
      runId: "run-order",
      graph: {
        nodes: [
          { id: "a", type: "emit" },
          { id: "b", type: "emit" },
        ],
        edges: [{ from: "a", to: "b" }],
      },
      store: createMemoryCheckpointStore({
        "run-order": [
          {
            seq: 2,
            nodeId: "b",
            nodeType: "emit",
            status: "ok",
            output: { b: true },
            state: { a: true, b: true },
            nextNodeId: null,
            continued: true,
          },
          {
            seq: 1,
            nodeId: "a",
            nodeType: "emit",
            status: "ok",
            output: { a: true },
            state: { a: true },
            nextNodeId: "b",
            continued: true,
          },
        ],
      }),
      resolveStep: resolver(step("emit", async () => ({}))),
    });

    expect(result.status).toBe("completed");
    expect(result.trace.map((entry) => entry.nodeId)).toEqual(["a", "b"]);
    expect(result.state).toEqual({ a: true, b: true });
  });

  it("continues after a best-effort failure and does not re-run a completed resume", async () => {
    let softCalls = 0;
    let doneCalls = 0;

    const graph: FlowGraph = {
      nodes: [
        { id: "soft", type: "soft" },
        { id: "done", type: "done" },
      ],
      edges: [{ from: "soft", to: "done" }],
    };

    const steps = () =>
      resolver(
        step(
          "soft",
          async () => {
            softCalls += 1;
            throw new Error("tolerated");
          },
          "best_effort",
        ),
        step("done", async () => {
          doneCalls += 1;
          return { done: true };
        }),
      );

    const store = createMemoryCheckpointStore();
    const first = await executeFlow({
      runId: "run-soft",
      graph,
      store,
      resolveStep: steps(),
    });

    expect(first.status).toBe("completed");
    expect(first.trace.map((entry) => entry.status)).toEqual(["error", "ok"]);
    expect(first.state).toEqual({ done: true });
    expect(first.checkpoints[0]).toMatchObject({
      nodeId: "soft",
      status: "error",
      continued: true,
      nextNodeId: "done",
    });

    const resumed = await executeFlow({
      runId: "run-soft",
      graph,
      store,
      resolveStep: steps(),
    });

    expect(resumed.status).toBe("completed");
    expect(softCalls).toBe(1);
    expect(doneCalls).toBe(1);
    expect(resumed.trace.map((entry) => entry.nodeId)).toEqual(["soft", "done"]);
  });

  it("treats a config parse failure according to the step policy", async () => {
    const broken: StepAdapter = {
      type: "broken",
      parseConfig: () => {
        throw new Error("bad config");
      },
      execute: async () => ({}),
    };

    const critical = await executeFlow({
      runId: "run-config",
      graph: { nodes: [{ id: "a", type: "broken" }], edges: [] },
      store: createMemoryCheckpointStore(),
      resolveStep: resolver(broken),
    });
    expect(critical.status).toBe("failed");
    expect(critical.error?.code).toBe("step_failed");

    const tolerated = await executeFlow({
      runId: "run-config-soft",
      graph: {
        nodes: [
          { id: "a", type: "broken" },
          { id: "b", type: "emit", config: { ok: true } },
        ],
        edges: [{ from: "a", to: "b" }],
      },
      store: createMemoryCheckpointStore(),
      resolveStep: resolver({ ...broken, policy: "best_effort" }, emit("ok", true)),
    });
    expect(tolerated.status).toBe("completed");
    expect(tolerated.trace.map((entry) => entry.status)).toEqual(["error", "ok"]);
  });

  it("supports intentional loops that terminate through a guarded exit", async () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "increment", type: "increment" },
        { id: "done", type: "emit", config: { done: true } },
      ],
      edges: [
        { from: "increment", to: "increment", when: { field: "round", notEquals: 2 } },
        { from: "increment", to: "done", when: { field: "round", equals: 2 } },
      ],
    };

    const result = await executeFlow({
      runId: "run-bounded-loop",
      graph,
      store: createMemoryCheckpointStore(),
      cyclePolicy: "allow",
      resolveStep: resolver(
        step("increment", async ({ state }) => ({
          round: Number(state.round ?? 0) + 1,
        })),
        emit("done", true),
      ),
    });

    expect(result.status).toBe("completed");
    expect(result.trace.map((entry) => entry.nodeId)).toEqual([
      "increment",
      "increment",
      "done",
    ]);
    expect(result.state).toMatchObject({ round: 2, done: true });
  });

  it("ignores an existing journal when resume is disabled", async () => {
    let calls = 0;
    const result = await executeFlow({
      runId: "run-fresh",
      graph: {
        nodes: [{ id: "a", type: "emit", config: { fresh: true } }],
        edges: [],
      },
      store: createMemoryCheckpointStore({
        "run-fresh": [{ nodeId: "a", status: "ok", output: { stale: true } }],
      }),
      resume: false,
      resolveStep: resolver(
        step("emit", async ({ input }) => {
          calls += 1;
          return input as Record<string, unknown>;
        }),
      ),
    });

    expect(result.status).toBe("completed");
    expect(calls).toBe(1);
    expect(result.state).toEqual({ fresh: true });
    expect(result.trace).toHaveLength(1);
  });

  it("rejects a journal whose recorded edge points at a missing node", async () => {
    const result = await executeFlow({
      runId: "run-ghost-edge",
      graph: {
        nodes: [{ id: "a", type: "emit" }],
        edges: [],
      },
      store: createMemoryCheckpointStore({
        "run-ghost-edge": [
          {
            seq: 1,
            nodeId: "a",
            nodeType: "emit",
            status: "ok",
            output: {},
            state: {},
            nextNodeId: "ghost",
            continued: true,
          },
        ],
      }),
      resolveStep: resolver(step("emit", async () => ({}))),
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("resume_conflict");
  });

  it("fails deterministically on a cycle unless loops are allowed", async () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "a", type: "emit", config: { a: true } },
        { id: "b", type: "emit", config: { b: true } },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    };
    const steps = resolver(
      step("emit", async ({ input }) => input as Record<string, unknown>),
    );

    const cycled = await executeFlow({
      runId: "run-cycle",
      graph,
      store: createMemoryCheckpointStore(),
      resolveStep: steps,
    });
    expect(cycled.status).toBe("failed");
    expect(cycled.error?.code).toBe("cycle_detected");
    expect(cycled.trace.map((entry) => entry.nodeId)).toEqual(["a", "b"]);

    const bounded = await executeFlow({
      runId: "run-loop",
      graph,
      store: createMemoryCheckpointStore(),
      resolveStep: steps,
      cyclePolicy: "allow",
      maxSteps: 3,
    });
    expect(bounded.status).toBe("failed");
    expect(bounded.error?.code).toBe("max_steps");
    expect(bounded.trace).toHaveLength(3);
  });

  it("reports unknown steps and invalid graphs before executing", async () => {
    const unknown = await executeFlow({
      runId: "run-unknown",
      graph: { nodes: [{ id: "a", type: "nope" }], edges: [] },
      store: createMemoryCheckpointStore(),
      resolveStep: resolver(),
    });
    expect(unknown.status).toBe("failed");
    expect(unknown.error?.code).toBe("unknown_step");

    let executed = 0;
    const invalid = await executeFlow({
      runId: "run-invalid",
      graph: {
        nodes: [{ id: "a", type: "emit" }],
        edges: [{ from: "a", to: "ghost" }],
      },
      store: createMemoryCheckpointStore(),
      resolveStep: resolver(
        step("emit", async () => {
          executed += 1;
          return {};
        }),
      ),
    });
    expect(invalid.status).toBe("failed");
    expect(invalid.error?.code).toBe("invalid_graph");
    expect(executed).toBe(0);
  });

  it("replays legacy journals and fails on a missing node", async () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "start", type: "emit" },
        { id: "send", type: "emit" },
      ],
      edges: [{ from: "start", to: "send" }],
    };

    const legacy = createMemoryCheckpointStore({
      "run-legacy": [
        { nodeId: "start", status: "ok", output: { step: 1 } },
        { nodeId: "send", status: "ok", output: { step: 2 } },
      ],
    });
    let calls = 0;
    const completed = await executeFlow({
      runId: "run-legacy",
      graph,
      store: legacy,
      resolveStep: resolver(
        step("emit", async () => {
          calls += 1;
          return {};
        }),
      ),
    });

    expect(completed.status).toBe("completed");
    expect(completed.state).toEqual({ step: 2 });
    expect(completed.trace.map((entry) => entry.nodeId)).toEqual(["start", "send"]);
    expect(calls).toBe(0);

    const conflict = await executeFlow({
      runId: "run-conflict",
      graph,
      store: createMemoryCheckpointStore({
        "run-conflict": [{ nodeId: "removed", status: "ok", output: {} }],
      }),
      resolveStep: resolver(),
    });
    expect(conflict.status).toBe("failed");
    expect(conflict.error?.code).toBe("resume_conflict");
  });

  it("surfaces journal load and append failures as checkpoint errors", async () => {
    const graph: FlowGraph = { nodes: [{ id: "a", type: "emit" }], edges: [] };
    const steps = resolver(step("emit", async () => ({ ok: true })));

    const loadFailure: CheckpointStore = {
      load: async () => {
        throw new Error("journal offline");
      },
      append: async () => {},
    };
    const failedLoad = await executeFlow({
      runId: "run-load",
      graph,
      store: loadFailure,
      resolveStep: steps,
    });
    expect(failedLoad.status).toBe("failed");
    expect(failedLoad.error).toMatchObject({ code: "checkpoint_failed" });

    const appendFailure: CheckpointStore = {
      load: async () => [],
      append: async () => {
        throw new Error("disk full");
      },
    };
    const failedAppend = await executeFlow({
      runId: "run-append",
      graph,
      store: appendFailure,
      resolveStep: steps,
    });
    expect(failedAppend.status).toBe("failed");
    expect(failedAppend.error?.message).toContain("disk full");
  });

  it("treats a tolerated terminal failure as a completed run", async () => {
    let calls = 0;
    const graph: FlowGraph = { nodes: [{ id: "soft", type: "soft" }], edges: [] };
    const steps = () =>
      resolver(
        step(
          "soft",
          async () => {
            calls += 1;
            throw new Error("tolerated at the edge");
          },
          "best_effort",
        ),
      );

    const store = createMemoryCheckpointStore();
    const first = await executeFlow({
      runId: "run-terminal-soft",
      graph,
      store,
      resolveStep: steps(),
    });
    expect(first.status).toBe("completed");
    expect(first.checkpoints.at(-1)).toMatchObject({
      status: "error",
      continued: true,
      nextNodeId: null,
    });

    const resumed = await executeFlow({
      runId: "run-terminal-soft",
      graph,
      store,
      resolveStep: steps(),
    });
    expect(resumed.status).toBe("completed");
    expect(calls).toBe(1);
  });

  it("continues a legacy error journal at the next node", async () => {
    const result = await executeFlow({
      runId: "run-legacy-error",
      graph: {
        nodes: [
          { id: "a", type: "emit" },
          { id: "b", type: "emit", config: { done: true } },
        ],
        edges: [{ from: "a", to: "b" }],
      },
      store: createMemoryCheckpointStore({
        "run-legacy-error": [
          { nodeId: "a", status: "error", output: { message: "soft" } },
        ],
      }),
      resolveStep: resolver(
        step("emit", async ({ input }) => input as Record<string, unknown>),
      ),
    });

    expect(result.status).toBe("completed");
    expect(result.trace.map((entry) => `${entry.nodeId}:${entry.status}`)).toEqual([
      "a:error",
      "b:ok",
    ]);
    expect(result.state).toEqual({ done: true });
  });

  it("is deterministic across independent runs and records a stable clock", async () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "a", type: "emit", config: { decision: "draft" } },
        { id: "b", type: "emit", config: { draft: true } },
        { id: "c", type: "emit", config: { send: true } },
      ],
      edges: [
        { from: "a", to: "c", when: { field: "decision", equals: "send" } },
        { from: "a", to: "b", when: { field: "decision", equals: "draft" } },
      ],
    };
    const steps = resolver(
      step("emit", async ({ input }) => input as Record<string, unknown>),
    );

    const orders: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      let tick = 0;
      const result = await executeFlow({
        runId: `run-deterministic-${index}`,
        graph,
        store: createMemoryCheckpointStore(),
        resolveStep: steps,
        now: () => {
          tick += 5;
          return tick;
        },
      });
      expect(result.status).toBe("completed");
      orders.push(result.trace.map((entry) => entry.nodeId).join(","));
      expect(result.trace.every((entry) => entry.ms === 5)).toBe(true);
      expect(result.checkpoints.map((record) => record.seq)).toEqual([1, 2]);
    }

    expect(orders).toEqual(["a,b", "a,b", "a,b"]);
  });
});
