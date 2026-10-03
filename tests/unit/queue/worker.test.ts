import { describe, expect, it, vi } from "vitest";

import {
  createQueueWorker,
  type DrainFn,
} from "@/lib/queue/worker";

/**
 * The worker loop is pure: drain, next-delay and sleep are injected, so every
 * branch (full batch, idle backoff, error backoff, graceful stop) is exercised
 * without Postgres or timers.
 */

function outcome(claimed: number) {
  return { claimed, completed: claimed, failed: 0 };
}

describe("createQueueWorker", () => {
  it("drains, backs off to the next-job delay and stops cleanly", async () => {
    const sleeps: number[] = [];
    let calls = 0;

    const worker = createQueueWorker({
      workerId: "w",
      drain: async () => {
        calls += 1;
        if (calls === 2) void worker.stop();
        return outcome(0);
      },
      nextDelayMs: async () => 250,
      batchSize: 5,
      maxConcurrency: 5,
      visibilityTimeoutMs: 1_000,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    worker.start();
    await vi.waitFor(() => expect(worker.isRunning()).toBe(false));
    await worker.stop();

    expect(worker.isRunning()).toBe(false);
    expect(worker.stats()).toMatchObject({ ticks: 2, claimed: 0 });
    expect(sleeps).toEqual([250]);
  });

  it("re-drains immediately after a full batch without sleeping", async () => {
    const sleeps: number[] = [];
    let calls = 0;

    const worker = createQueueWorker({
      workerId: "w",
      drain: async () => {
        calls += 1;
        if (calls === 3) void worker.stop();
        return outcome(5);
      },
      nextDelayMs: async () => 10_000,
      batchSize: 5,
      maxConcurrency: 5,
      visibilityTimeoutMs: 1_000,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    worker.start();
    await vi.waitFor(() => expect(worker.isRunning()).toBe(false));
    await worker.stop();

    expect(worker.stats().ticks).toBe(3);
    expect(sleeps).toEqual([]);
  });

  it("caps an idle wait at maxIdleMs", async () => {
    const sleeps: number[] = [];
    let calls = 0;

    const worker = createQueueWorker({
      workerId: "w",
      drain: async () => {
        calls += 1;
        if (calls === 2) void worker.stop();
        return outcome(0);
      },
      // No pending job at all → the loop should still wake within maxIdleMs.
      nextDelayMs: async () => null,
      batchSize: 5,
      maxConcurrency: 5,
      visibilityTimeoutMs: 1_000,
      maxIdleMs: 2_000,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    worker.start();
    await vi.waitFor(() => expect(worker.isRunning()).toBe(false));
    await worker.stop();
    expect(sleeps).toEqual([2_000]);
  });

  it("backs off after a drain error instead of crashing", async () => {
    const sleeps: number[] = [];
    let calls = 0;

    const worker = createQueueWorker({
      workerId: "w",
      drain: async () => {
        calls += 1;
        if (calls === 1) throw new Error("db down");
        if (calls === 2) void worker.stop();
        return outcome(0);
      },
      nextDelayMs: async () => 50,
      batchSize: 5,
      maxConcurrency: 5,
      visibilityTimeoutMs: 1_000,
      errorBackoffMs: 1_234,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    worker.start();
    await vi.waitFor(() => expect(worker.isRunning()).toBe(false));
    await worker.stop();

    expect(worker.stats().errors).toBe(1);
    // The error backoff is slept; the second tick's delay is not, because the
    // drain triggered the stop first.
    expect(sleeps).toEqual([1_234]);
  });

  it("reports errors through the injected hook", async () => {
    const onError = vi.fn();
    let calls = 0;

    const worker = createQueueWorker({
      workerId: "w",
      drain: async () => {
        calls += 1;
        if (calls === 1) throw new Error("boom");
        void worker.stop();
        return outcome(0);
      },
      nextDelayMs: async () => null,
      batchSize: 5,
      maxConcurrency: 5,
      visibilityTimeoutMs: 1_000,
      onError,
      sleep: async () => {},
    });

    worker.start();
    await vi.waitFor(() => expect(worker.isRunning()).toBe(false));
    await worker.stop();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("stop() waits for the in-flight drain to finish", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = false;

    const worker = createQueueWorker({
      workerId: "w",
      drain: async () => {
        started = true;
        await gate;
        return outcome(0);
      },
      nextDelayMs: async () => null,
      batchSize: 5,
      maxConcurrency: 5,
      visibilityTimeoutMs: 1_000,
    });

    worker.start();
    await vi.waitFor(() => expect(started).toBe(true));

    let stopped = false;
    const stopPromise = worker.stop().then(() => {
      stopped = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(stopped).toBe(false);

    release();
    await stopPromise;
    expect(stopped).toBe(true);
  });

  it("start() is idempotent", async () => {
    let calls = 0;

    const worker = createQueueWorker({
      workerId: "w",
      drain: async () => {
        calls += 1;
        void worker.stop();
        return outcome(0);
      },
      nextDelayMs: async () => null,
      batchSize: 5,
      maxConcurrency: 5,
      visibilityTimeoutMs: 1_000,
      sleep: async () => {},
    });

    worker.start();
    worker.start();
    await vi.waitFor(() => expect(worker.isRunning()).toBe(false));
    await worker.stop();
    expect(calls).toBe(1);
  });
});

// A compile-time guard that the exported DrainFn matches drainQueue's shape.
const _drainType: DrainFn = async () => outcome(0);
void _drainType;
