import { afterEach, describe, expect, it } from "vitest";

import {
  beginShutdown,
  isShuttingDown,
  resetLifecycleForTests,
  shutdownStartedAt,
} from "@/lib/lifecycle";

describe("lifecycle shutdown state", () => {
  afterEach(() => resetLifecycleForTests());

  it("starts out running", () => {
    expect(isShuttingDown()).toBe(false);
    expect(shutdownStartedAt()).toBeNull();
  });

  it("flips to draining on the first signal and records the time", () => {
    const before = Date.now();
    beginShutdown();
    expect(isShuttingDown()).toBe(true);
    expect(shutdownStartedAt()).toBeGreaterThanOrEqual(before);
  });

  it("is idempotent: a second signal keeps the first timestamp", () => {
    beginShutdown();
    const first = shutdownStartedAt();
    beginShutdown();
    expect(shutdownStartedAt()).toBe(first);
  });
});
