import { hostname } from "node:os";

import { closeDatabasePools, pool } from "@/lib/db";
import {
  DRAIN_BATCH_SIZE,
  QUEUE_MAX_CONCURRENCY,
  QUEUE_VISIBILITY_TIMEOUT_MS,
  drainQueue,
} from "@/lib/email-operator/drain";
import { beginShutdown } from "@/lib/lifecycle";
import { logger } from "@/lib/observability/logger";
import { msUntilNextJob } from "@/lib/queue/queue";
import { createQueueWorker } from "@/lib/queue/worker";

/**
 * Dedicated queue worker entrypoint (Phase D1/D2).
 *
 * Runs the durable Postgres queue as a long-lived process instead of draining
 * inside a request `after()` or a cron. Intended for a container / VM; on
 * serverless use the `/api/v1/cron/drain` route instead.
 *
 * Shutdown order (SKILL §5.3): trap signal → readiness=false → stop claiming →
 * await the in-flight drain → close the pool → exit 0. A hard timeout bounds
 * the drain so a stuck job cannot hang the process forever.
 *
 *   npm run worker
 */

const SHUTDOWN_TIMEOUT_MS = Number(process.env.WORKER_SHUTDOWN_TIMEOUT_MS) || 30_000;

const workerId = `worker:${hostname()}:${process.pid}`;

const worker = createQueueWorker({
  workerId,
  drain: (options) => drainQueue(options),
  nextDelayMs: () => msUntilNextJob(pool),
  batchSize: DRAIN_BATCH_SIZE,
  maxConcurrency: QUEUE_MAX_CONCURRENCY,
  visibilityTimeoutMs: QUEUE_VISIBILITY_TIMEOUT_MS,
  onError: (error) => {
    logger.error("worker.drain_failed", {
      worker_id: workerId,
      error: error instanceof Error ? error.message : String(error),
    });
  },
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  // Step 1: the process is no longer a valid traffic/claim target.
  beginShutdown();
  logger.info("worker.shutdown_started", { worker_id: workerId, signal });

  const stopped = worker.stop();
  const timeout = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), SHUTDOWN_TIMEOUT_MS),
  );
  const outcome = await Promise.race([stopped.then(() => "drained" as const), timeout]);
  if (outcome === "timeout") {
    logger.warn("worker.shutdown_timeout", {
      worker_id: workerId,
      timeout_ms: SHUTDOWN_TIMEOUT_MS,
    });
  }

  // Step 2: close the database pool(s) last (reverse order of acquisition).
  try {
    await closeDatabasePools();
  } catch (error) {
    logger.error("worker.pool_close_failed", {
      worker_id: workerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info("worker.shutdown_complete", {
    worker_id: workerId,
    stats: worker.stats(),
  });
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

worker.start();
logger.info("worker.started", {
  worker_id: workerId,
  batch_size: DRAIN_BATCH_SIZE,
  max_concurrency: QUEUE_MAX_CONCURRENCY,
});
