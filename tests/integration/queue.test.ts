import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  claimJobs,
  completeJob,
  countDeadJobs,
  enqueueJob,
  failJob,
  msUntilNextJob,
  reapExpiredJobs,
} from "@/lib/queue/queue";

/**
 * The durable queue talks raw SQL (`FOR UPDATE SKIP LOCKED`, partial unique
 * indexes, advisory locks) that only a real Postgres can validate. This suite
 * boots an ephemeral Postgres, applies the production migrations, and drives
 * the real primitives through their lifecycle.
 */
let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  pool = new Pool({ connectionString: container.getConnectionUri(), max: 5 });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

beforeEach(async () => {
  await pool.query("truncate job_queue");
  // `job_queue.user_id` is a real FK (matrix #11), so seed the owners first.
  await pool.query(
    `insert into "user" (id, name, email)
     values ('user-1','User One','user-1@test.local'),
            ('user-2','User Two','user-2@test.local')
     on conflict (id) do nothing`,
  );
});

describe("enqueueJob", () => {
  it("inserts a pending job with a collision-safe id", async () => {
    const { job, deduped } = await enqueueJob(pool, "user-1", {
      kind: "send_email",
      laneKey: "thread-1",
      payload: { draftId: "d1" },
    });
    expect(deduped).toBe(false);
    expect(job.id).toMatch(/^job_[0-9a-f-]{36}$/);
    expect(job).toMatchObject({
      userId: "user-1",
      kind: "send_email",
      laneKey: "thread-1",
      status: "pending",
      attempts: 0,
      payload: { draftId: "d1" },
    });
  });

  it("dedupes an event→job redelivery on source_event_id", async () => {
    const first = await enqueueJob(pool, "user-1", {
      kind: "sync",
      sourceEventId: "evt-1",
    });
    const second = await enqueueJob(pool, "user-1", {
      kind: "sync",
      sourceEventId: "evt-1",
    });
    expect(second.deduped).toBe(true);
    expect(second.job.id).toBe(first.job.id);
  });
});

describe("claim / complete lifecycle", () => {
  it("claims a due job, increments attempts, then completes it", async () => {
    const { job } = await enqueueJob(pool, "user-1", { kind: "send_email" });
    const claimed = await claimJobs(pool, { workerId: "w1", maxConcurrency: 5 });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ id: job.id, status: "running", attempts: 1 });

    await completeJob(pool, job.id, "w1");
    const { rows } = await pool.query("select status from job_queue where id = $1", [
      job.id,
    ]);
    expect(rows[0].status).toBe("done");
  });

  it("honours the global running cap", async () => {
    await enqueueJob(pool, "user-1", { kind: "k" });
    await enqueueJob(pool, "user-2", { kind: "k" });
    const first = await claimJobs(pool, { workerId: "w1", maxConcurrency: 1 });
    expect(first).toHaveLength(1);
    // The one running job saturates the cap; a second drain gets nothing.
    const second = await claimJobs(pool, { workerId: "w2", maxConcurrency: 1 });
    expect(second).toHaveLength(0);
  });

  it("refuses to complete a job whose lease belongs to another worker", async () => {
    await enqueueJob(pool, "user-1", { kind: "k" });
    const [claimed] = await claimJobs(pool, { workerId: "w1", maxConcurrency: 5 });
    await expect(completeJob(pool, claimed!.id, "someone-else")).rejects.toThrow(
      /lease/i,
    );
  });

  it("allows only one running job per lane", async () => {
    await enqueueJob(pool, "user-1", { kind: "k", laneKey: "lane-a" });
    await enqueueJob(pool, "user-1", { kind: "k", laneKey: "lane-a" });
    const claimed = await claimJobs(pool, {
      workerId: "w1",
      maxConcurrency: 5,
      batchSize: 5,
    });
    expect(claimed).toHaveLength(1);
  });
});

describe("failJob", () => {
  it("backs off, then dead-letters once attempts are exhausted", async () => {
    const { job } = await enqueueJob(pool, "user-1", {
      kind: "k",
      maxAttempts: 2,
    });

    const [first] = await claimJobs(pool, { workerId: "w1", maxConcurrency: 5 });
    const retried = await failJob(pool, first!.id, "w1", new Error("boom"));
    expect(retried?.status).toBe("pending");
    expect(retried!.runAfter.getTime()).toBeGreaterThan(Date.now());

    // Simulate the backoff elapsing so the job is claimable again.
    await pool.query("update job_queue set run_after = now() where id = $1", [job.id]);
    const [second] = await claimJobs(pool, { workerId: "w1", maxConcurrency: 5 });
    expect(second!.attempts).toBe(2);

    const dead = await failJob(pool, second!.id, "w1", new Error("boom again"));
    expect(dead?.status).toBe("dead");
    expect(dead?.lastError).toContain("boom again");
  });
});

describe("reapExpiredJobs", () => {
  it("revives a job whose worker died past the visibility timeout", async () => {
    const { job } = await enqueueJob(pool, "user-1", { kind: "k" });
    const [claimed] = await claimJobs(pool, { workerId: "w1", maxConcurrency: 5 });
    await pool.query(
      "update job_queue set locked_at = now() - interval '10 minutes' where id = $1",
      [claimed!.id],
    );

    const result = await reapExpiredJobs(pool, { visibilityTimeoutMs: 60_000 });
    expect(result).toMatchObject({ revived: 1, dead: 0 });

    const { rows } = await pool.query(
      "select status, locked_by from job_queue where id = $1",
      [job.id],
    );
    expect(rows[0]).toMatchObject({ status: "pending", locked_by: null });
  });
});

describe("msUntilNextJob", () => {
  it("returns null when nothing is pending and a delay otherwise", async () => {
    expect(await msUntilNextJob(pool)).toBeNull();

    await enqueueJob(pool, "user-1", {
      kind: "k",
      runAfter: new Date(Date.now() + 30_000),
    });
    const ms = await msUntilNextJob(pool);
    expect(ms).not.toBeNull();
    expect(ms!).toBeGreaterThan(0);
  });
});

describe("countDeadJobs", () => {
  it("counts only this owner's dead-letter jobs", async () => {
    const { job } = await enqueueJob(pool, "user-1", {
      kind: "k",
      maxAttempts: 1,
    });
    await pool.query(
      "update job_queue set status = 'dead' where id = $1",
      [job.id],
    );
    await enqueueJob(pool, "user-2", { kind: "k" });

    expect(await countDeadJobs(pool, "user-1")).toBe(1);
    expect(await countDeadJobs(pool, "user-2")).toBe(0);
  });
});
