/**
 * Process-wide lifecycle state (Phase D2 — graceful shutdown).
 *
 * The moment an OS signal arrives the process is no longer a valid traffic
 * target, even though it still has in-flight work to finish. The readiness
 * probe reads this flag so a load balancer drains the instance before the
 * listener closes, while the queue worker stops claiming new jobs.
 *
 * State is per process, which is exactly the scope a shutdown signal has.
 */

let shuttingDown = false;
let shutdownStartedAtMs: number | null = null;

/** Marks the process as draining. Idempotent; the first signal wins. */
export function beginShutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  shutdownStartedAtMs = Date.now();
}

/** True once a shutdown signal has been received. */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

/** Epoch millis of the first shutdown signal, or null before one arrives. */
export function shutdownStartedAt(): number | null {
  return shutdownStartedAtMs;
}

/** Test-only reset so suites do not leak shutdown state between cases. */
export function resetLifecycleForTests(): void {
  shuttingDown = false;
  shutdownStartedAtMs = null;
}
