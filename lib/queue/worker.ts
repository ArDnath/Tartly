/**
 * Long-lived queue worker loop (Phase D1/D2).
 *
 * On serverless the queue is drained opportunistically (`after()` on the Gmail
 * webhook, the daily cron). A self-hosted / container deployment can instead
 * run this loop as a dedicated process so throughput is decoupled from the
 * request lifecycle.
 *
 * This module is deliberately free of database/Redis imports: the drain
 * function and the next-job delay are injected, which keeps the control logic
 * (backoff, stop semantics, in-flight drain) pure and unit-testable. The
 * concrete wiring lives in `scripts/worker.ts`.
 */

export type DrainOutcome = {
  claimed: number;
  completed: number;
  failed: number;
};

export type DrainFn = (options: {
  workerId: string;
  batchSize: number;
  maxConcurrency: number;
  visibilityTimeoutMs: number;
}) => Promise<DrainOutcome>;

export type QueueWorkerOptions = {
  workerId: string;
  drain: DrainFn;
  /** Milliseconds until the next claimable job, or null when none is pending. */
  nextDelayMs: () => Promise<number | null>;
  batchSize: number;
  maxConcurrency: number;
  visibilityTimeoutMs: number;
  /** Upper bound on the idle sleep, so the loop still wakes to poll. */
  maxIdleMs?: number;
  /** Delay after a drain throws, before retrying. */
  errorBackoffMs?: number;
  /** Injectable clock, for tests. */
  sleep?: (ms: number) => Promise<void>;
  onError?: (error: unknown) => void;
};

export type QueueWorkerStats = {
  ticks: number;
  claimed: number;
  completed: number;
  failed: number;
  errors: number;
};

export type QueueWorker = {
  start: () => void;
  stop: () => Promise<void>;
  isRunning: () => boolean;
  stats: () => QueueWorkerStats;
};

const DEFAULT_MAX_IDLE_MS = 5_000;
const DEFAULT_ERROR_BACKOFF_MS = 1_000;

/**
 * Creates a worker. `start()` is idempotent; `stop()` resolves once the current
 * drain has finished and the loop has exited, so the caller can then close the
 * database pool in the correct order.
 */
export function createQueueWorker(options: QueueWorkerOptions): QueueWorker {
  const {
    workerId,
    drain,
    nextDelayMs,
    batchSize,
    maxConcurrency,
    visibilityTimeoutMs,
    maxIdleMs = DEFAULT_MAX_IDLE_MS,
    errorBackoffMs = DEFAULT_ERROR_BACKOFF_MS,
    sleep,
    onError,
  } = options;

  const stats: QueueWorkerStats = {
    ticks: 0,
    claimed: 0,
    completed: 0,
    failed: 0,
    errors: 0,
  };

  let running = false;
  let stopRequested = false;
  let loop: Promise<void> | null = null;

  // Recreated per `start()` so a stop signal from a previous run cannot make a
  // restarted loop spin (the sleep would resolve immediately forever).
  let stopSignal: Promise<void> = Promise.resolve();
  let signalStop: () => void = () => {};

  function armStopSignal(): void {
    stopSignal = new Promise<void>((resolve) => {
      signalStop = resolve;
    });
  }
  armStopSignal();

  function reportError(error: unknown): void {
    stats.errors += 1;
    if (onError) onError(error);
  }

  function defaultSleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      void stopSignal.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  const wait = sleep ?? defaultSleep;

  /** Runs one drain and returns how long to wait before the next one. */
  async function tick(): Promise<number> {
    const result = await drain({
      workerId,
      batchSize,
      maxConcurrency,
      visibilityTimeoutMs,
    });
    stats.ticks += 1;
    stats.claimed += result.claimed;
    stats.completed += result.completed;
    stats.failed += result.failed;

    // A full batch implies more work is likely waiting: drain again at once.
    if (result.claimed >= batchSize) return 0;

    const delay = await nextDelayMs();
    if (delay === null) return maxIdleMs;
    return Math.min(Math.max(delay, 0), maxIdleMs);
  }

  async function run(): Promise<void> {
    while (!stopRequested) {
      let delay: number;
      try {
        delay = await tick();
      } catch (error) {
        reportError(error);
        delay = errorBackoffMs;
      }
      if (stopRequested) break;
      if (delay > 0) await wait(delay);
    }
    running = false;
  }

  return {
    start(): void {
      if (running) return;
      running = true;
      stopRequested = false;
      armStopSignal();
      loop = run();
    },
    async stop(): Promise<void> {
      stopRequested = true;
      signalStop();
      await loop;
    },
    isRunning(): boolean {
      return running;
    },
    stats(): QueueWorkerStats {
      return { ...stats };
    },
  };
}
