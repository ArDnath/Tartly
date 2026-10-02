import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db, pool } from "../../lib/db";
import { flowRuns, flows, jobQueue } from "../../lib/db/schema";
import { drainQueue } from "../../lib/email-operator/drain";
import {
  clearJobHandlers,
  getJobHandler,
  registerJobHandler,
} from "../../lib/email-operator/jobs";
import {
  buildInboundEmailGraph,
  evaluateCondition,
  nextNode,
  seedDefaultFlows,
  type FlowGraph,
} from "../../lib/engine/flow";
import { clearSteps, registerStep } from "../../lib/engine/registry";
import { runFlow } from "../../lib/engine/run";
import {
  claimJobs,
  completeJob,
  enqueueJob,
  failJob,
  reapExpiredJobs,
} from "../../lib/queue/queue";
import {
  assert,
  createTestUser,
  deleteTestUser,
  makeTestUserId,
  section,
} from "./harness";

async function clearQueue(userId: string) {
  await pool.query("delete from job_queue where user_id = $1", [userId]);
}

async function createRun(userId: string, graph: FlowGraph) {
  const [flow] = await db
    .insert(flows)
    .values({ id: `flow-${randomUUID()}`, userId, name: "test", graph: graph as unknown as Record<string, unknown> })
    .returning();
  const [run] = await db
    .insert(flowRuns)
    .values({ id: `run-${randomUUID()}`, userId, flowId: flow.id, triggerKind: "test" })
    .returning();
  return { flow, run };
}

export async function run(): Promise<void> {
  const userId = makeTestUserId("phase2");
  await createTestUser(userId);

  try {
    section("phase 2 — graph traversal");
    const graph = buildInboundEmailGraph();
    assert(graph.nodes.length === 16, "default inbound graph has 16 nodes");
    const applyRulesNode = graph.nodes.find(
      (node) => node.type === "apply-rules",
    )!;
    assert(
      nextNode(graph, applyRulesNode, { action: "none" })?.type === "log-trace",
      "action=none skips drafting straight to log-trace",
    );
    assert(
      nextNode(graph, applyRulesNode, { action: "draft" })?.type ===
        "extract-commitments",
      "action=draft runs commitment extraction",
    );
    const meetingNode = graph.nodes.find(
      (node) => node.type === "detect-meeting-intent",
    )!;
    assert(
      nextNode(graph, meetingNode, { isMeeting: true })?.type ===
        "find-free-slots",
      "meeting branch routes to find-free-slots",
    );
    assert(
      nextNode(graph, meetingNode, { isMeeting: false })?.type ===
        "draft-reply",
      "non-meeting branch routes to draft-reply",
    );
    assert(
      evaluateCondition({ field: "decision", equals: "send" }, { decision: "send" }),
      "equals condition matches",
    );
    assert(
      !evaluateCondition({ field: "decision", equals: "send" }, { decision: "draft" }),
      "equals condition rejects mismatch",
    );

    section("phase 2 — queue primitives");
    const { job: jobA, deduped: firstDedupe } = await enqueueJob(pool, userId, {
      kind: "test_kind",
      laneKey: "lane-1",
      sourceEventId: "evt-1",
    });
    assert(firstDedupe === false, "first enqueue is not deduped");

    const { job: jobADupe, deduped } = await enqueueJob(pool, userId, {
      kind: "test_kind",
      laneKey: "lane-1",
      sourceEventId: "evt-1",
    });
    assert(deduped === true, "duplicate sourceEventId is deduped");
    assert(jobADupe.id === jobA.id, "dedupe returns the same job row");

    const claimed = await claimJobs(pool, {
      workerId: "w1",
      maxConcurrency: 5,
      batchSize: 5,
    });
    const claimedA = claimed.find((job) => job.id === jobA.id);
    assert(Boolean(claimedA), "claim returns the pending job");
    assert(claimedA?.attempts === 1, "claim increments attempts");
    assert(claimedA?.status === "running", "claim marks the job running");

    const claimedAgain = await claimJobs(pool, {
      workerId: "w1",
      maxConcurrency: 5,
      batchSize: 5,
    });
    assert(
      claimedAgain.every((job) => job.id !== jobA.id),
      "a running job is not re-claimed",
    );

    await completeJob(pool, jobA.id, "w1", undefined, claimedA?.claimAcquiredAt);
    const doneRow = await pool.query("select status from job_queue where id = $1", [jobA.id]);
    assert(doneRow.rows[0].status === "done", "complete marks the job done");

    // Lane serialization: two pending jobs on one lane yield a single claim.
    await enqueueJob(pool, userId, { kind: "test_kind", laneKey: "lane-2" });
    await enqueueJob(pool, userId, { kind: "test_kind", laneKey: "lane-2" });
    const laneClaim = await claimJobs(pool, {
      workerId: "w1",
      maxConcurrency: 5,
      batchSize: 5,
    });
    const laneJobs = laneClaim.filter((job) => job.laneKey === "lane-2");
    assert(laneJobs.length === 1, "one running job per lane");

    // Failure backs off and returns the job to pending (not re-claimable now).
    const failed = await failJob(
      pool,
      laneJobs[0].id,
      "w1",
      new Error("transient"),
      laneJobs[0].claimAcquiredAt,
    );
    assert(failed?.status === "pending", "failed job returns to pending");
    assert(
      failed !== null && failed.runAfter.getTime() > Date.now(),
      "failed job backs off before retrying",
    );

    section("phase 2 — dead-letter + reaper");
    const { job: doomed } = await enqueueJob(pool, userId, {
      kind: "test_kind",
      laneKey: "lane-3",
      maxAttempts: 1,
    });
    const doomedClaim = await claimJobs(pool, {
      workerId: "w2",
      maxConcurrency: 5,
      batchSize: 5,
    });
    const doomedJob = doomedClaim.find((job) => job.id === doomed.id);
    assert(Boolean(doomedJob), "doomed job claimed");
    const dead = await failJob(
      pool,
      doomed.id,
      "w2",
      new Error("fatal"),
      doomedJob?.claimAcquiredAt,
    );
    assert(dead?.status === "dead", "exhausted job is marked dead");

    const { job: stale } = await enqueueJob(pool, userId, {
      kind: "test_kind",
      laneKey: "lane-4",
    });
    const staleClaim = await claimJobs(pool, {
      workerId: "w3",
      maxConcurrency: 5,
      batchSize: 5,
    });
    const staleJob = staleClaim.find((job) => job.id === stale.id);
    assert(Boolean(staleJob), "stale job claimed");
    await pool.query(
      "update job_queue set locked_at = now() - interval '1 hour' where id = $1",
      [stale.id],
    );
    const reaped = await reapExpiredJobs(pool, { visibilityTimeoutMs: 60_000 });
    assert(reaped.revived >= 1, "reaper revives a stale running job");

    section("phase 2 — engine policies");
    clearSteps();
    registerStep({
      type: "emit",
      configSchema: z.object({ key: z.string(), value: z.unknown() }),
      run: async ({ input }) => ({ [input.key]: input.value }),
    });
    registerStep({
      type: "boom",
      configSchema: z.object({}),
      run: async () => {
        throw new Error("kaboom");
      },
    });
    registerStep({
      type: "soft-fail",
      configSchema: z.object({}),
      policy: "best_effort",
      run: async () => {
        throw new Error("soft");
      },
    });

    const criticalGraph: FlowGraph = {
      nodes: [
        { id: "a", type: "emit", config: { key: "isMeeting", value: true } },
        { id: "b", type: "boom" },
      ],
      edges: [{ from: "a", to: "b" }],
    };
    const { run: criticalRun } = await createRun(userId, criticalGraph);
    const critical = await runFlow({
      runId: criticalRun.id,
      userId,
      graph: criticalGraph,
    });
    assert(critical.status === "failed", "critical step failure fails the run");
    assert(
      critical.trace.at(-1)?.status === "error",
      "failed run records the error in the trace",
    );
    const criticalRow = await db
      .select()
      .from(flowRuns)
      .where(eq(flowRuns.id, criticalRun.id));
    assert(criticalRow[0].status === "failed", "failed run persisted");

    const bestEffortGraph: FlowGraph = {
      nodes: [
        { id: "a", type: "soft-fail" },
        { id: "b", type: "emit", config: { key: "done", value: true } },
      ],
      edges: [{ from: "a", to: "b" }],
    };
    const { run: softRun } = await createRun(userId, bestEffortGraph);
    const soft = await runFlow({
      runId: softRun.id,
      userId,
      graph: bestEffortGraph,
    });
    assert(soft.status === "completed", "best-effort failure does not fail the run");
    assert(
      soft.trace.some((entry) => entry.status === "error"),
      "best-effort error is still recorded",
    );
    assert(
      soft.trace.at(-1)?.status === "ok",
      "run continues after a best-effort error",
    );

    const branchGraph: FlowGraph = {
      nodes: [
        { id: "a", type: "emit", config: { key: "decision", value: "send" } },
        { id: "x", type: "emit", config: { key: "sent", value: true } },
        { id: "d", type: "emit", config: { key: "drafted", value: true } },
      ],
      edges: [
        { from: "a", to: "x", when: { field: "decision", equals: "send" } },
        { from: "a", to: "d", when: { field: "decision", equals: "draft" } },
      ],
    };
    const { run: branchRun } = await createRun(userId, branchGraph);
    const branch = await runFlow({ runId: branchRun.id, userId, graph: branchGraph });
    assert(branch.status === "completed", "conditional graph completes");
    assert(
      branch.trace.map((entry) => entry.nodeId).join(",") === "a,x",
      "conditional edge selects the matching branch",
    );

    section("phase 2 — drain + default flow seed");
    const seeded = await seedDefaultFlows(userId);
    assert(seeded.name === "inbound-email", "default flow seeded");
    const seededAgain = await seedDefaultFlows(userId);
    assert(seededAgain.id === seeded.id, "seed is idempotent");

    clearJobHandlers();
    let handled = 0;
    registerJobHandler("test_kind", async () => {
      handled += 1;
    });
    await clearQueue(userId);
    await enqueueJob(pool, userId, { kind: "test_kind", laneKey: "drain-1" });
    await enqueueJob(pool, userId, { kind: "test_kind", laneKey: "drain-2" });

    const drained = await drainQueue({ workerId: "drain-test", batchSize: 5 });
    assert(handled >= 2, "drain runs each claimed handler");
    assert(drained.completed >= 2, "drain reports completions");
    assert(
      getJobHandler("test_kind") !== undefined,
      "handler registry resolves the kind",
    );

    const remaining = await db
      .select()
      .from(jobQueue)
      .where(and(eq(jobQueue.userId, userId), inArray(jobQueue.status, ["pending", "running"])));
    assert(remaining.length === 0, "drained jobs leave nothing pending");
  } finally {
    await clearQueue(userId);
    await db.delete(flows).where(eq(flows.userId, userId));
    await deleteTestUser(userId);
  }
}
