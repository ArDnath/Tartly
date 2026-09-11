import "server-only";

import { db, pool } from "@/lib/db";
import { getJobHandler, loadJobHandlers } from "@/lib/email-operator/jobs";
import { redis } from "@/lib/redis";
import {
  claimJobs,
  completeJob as completeQueueJob,
  failJob,
  reapExpiredJobs,
} from "@/lib/queue/queue";

/**
 * Bounded drain of the durable queue.
 *
 * Hobby functions cap at 300s, so a drain processes a bounded batch (default
 * 5) and leaves the rest for the next trigger. The reaper revives anything a
 * killed invocation left `running`.
 */

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const DRAIN_BATCH_SIZE = numberFromEnv("QUEUE_DRAIN_BATCH_SIZE", 5);
export const QUEUE_MAX_CONCURRENCY = numberFromEnv("QUEUE_MAX_CONCURRENCY", 5);
export const QUEUE_VISIBILITY_TIMEOUT_MS = numberFromEnv(
  "QUEUE_VISIBILITY_TIMEOUT_MS",
  5 * 60 * 1000,
);

export type DrainResult = {
  claimed: number;
  completed: number;
  failed: number;
  reaped: { revived: number; dead: number };
};

export async function drainQueue({
  workerId,
  batchSize = DRAIN_BATCH_SIZE,
  maxConcurrency = QUEUE_MAX_CONCURRENCY,
  visibilityTimeoutMs = QUEUE_VISIBILITY_TIMEOUT_MS,
}: {
  workerId: string;
  batchSize?: number;
  maxConcurrency?: number;
  visibilityTimeoutMs?: number;
}): Promise<DrainResult> {
  loadJobHandlers();

  const reaped = await reapExpiredJobs(pool, { visibilityTimeoutMs });
  const jobs = await claimJobs(pool, { workerId, maxConcurrency, batchSize });

  let completed = 0;
  let failed = 0;

  for (const job of jobs) {
    const handler = getJobHandler(job.kind);
    if (!handler) {
      await failJob(
        pool,
        job.id,
        workerId,
        new Error(`No handler registered for job kind "${job.kind}"`),
        job.claimAcquiredAt,
      );
      failed += 1;
      continue;
    }

    try {
      await handler(job, { db, workerId });
      await completeQueueJob(pool, job.id, workerId, undefined, job.claimAcquiredAt);
      completed += 1;
    } catch (error) {
      console.error(`[drain] job ${job.id} (${job.kind}) failed`, error);
      await failJob(pool, job.id, workerId, error, job.claimAcquiredAt);
      failed += 1;
    }
  }

  return { claimed: jobs.length, completed, failed, reaped };
}

const DRAIN_LOCK_KEY = "email-operator:drain-lock";
const DRAIN_LOCK_TTL_SECONDS = 30;

/**
 * Opportunistic, activity-paced drain. Any authenticated request can kick it;
 * an Upstash lock keeps concurrent requests from stampeding. Best-effort: a
 * Redis outage must never break the caller, so the lock failing open still
 * drains (the queue's own lane constraints keep that safe).
 */
export async function kickDrain(reason: string): Promise<boolean> {
  try {
    const acquired = await redis.set(DRAIN_LOCK_KEY, Date.now(), {
      nx: true,
      ex: DRAIN_LOCK_TTL_SECONDS,
    });
    if (acquired !== "OK") return false;
  } catch (error) {
    console.warn("[drain] lock unavailable, draining anyway", error);
  }

  await drainQueue({ workerId: `kick:${reason}:${Date.now().toString(36)}` });
  return true;
}
