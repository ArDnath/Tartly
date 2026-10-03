import { afterEach, describe, expect, it, vi } from "vitest";

import {
  runWithRequestContext,
  setRequestUserId,
} from "@/lib/observability/context";
import { logger, redact } from "@/lib/observability/logger";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("redact", () => {
  it("masks sensitive keys at the top level", () => {
    expect(
      redact({
        password: "hunter2",
        authorization: "Bearer abc",
        cookie: "session=1",
        api_key: "k",
        apiKey: "k2",
        accessKey: "k3",
        card_number: "4111",
        ssn: "000-00-0000",
        token: "t",
      }),
    ).toEqual({
      password: "[REDACTED]",
      authorization: "[REDACTED]",
      cookie: "[REDACTED]",
      api_key: "[REDACTED]",
      apiKey: "[REDACTED]",
      accessKey: "[REDACTED]",
      card_number: "[REDACTED]",
      ssn: "[REDACTED]",
      token: "[REDACTED]",
    });
  });

  it("masks nested objects and arrays while preserving structure", () => {
    expect(
      redact({
        user: { id: "u1", refreshToken: "r" },
        items: [{ ok: true }, { secret: "s" }],
      }),
    ).toEqual({
      user: { id: "u1", refreshToken: "[REDACTED]" },
      items: [{ ok: true }, { secret: "[REDACTED]" }],
    });
  });

  it("leaves non-sensitive keys untouched", () => {
    expect(redact({ monkey: "business", count: 3, ok: true })).toEqual({
      monkey: "business",
      count: 3,
      ok: true,
    });
  });

  it("serializes Errors to name + message only", () => {
    const error = new TypeError("boom");
    expect(redact({ error })).toEqual({
      error: { name: "TypeError", message: "boom" },
    });
  });

  it("preserves null and undefined", () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });

  it("truncates beyond the maximum depth", () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: "too deep" } } } } } } } };
    expect(redact(deep)).toEqual({
      a: { b: { c: { d: { e: { f: { g: "[Truncated]" } } } } } },
    });
  });
});

describe("logger emission", () => {
  function capture(): { stdout: string[]; stderr: string[] } {
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
    return { stdout, stderr };
  }

  it("writes one JSON line with mandatory fields, trace context and redaction", async () => {
    const { stdout } = capture();
    await runWithRequestContext(
      {
        requestId: "trace-abc",
        method: "POST",
        path: "/api/v1/agent/chat",
        startedAt: Date.now(),
      },
      async () => {
        setRequestUserId("user-1");
        logger.info("request.completed", {
          status_code: 200,
          latency_ms: 12,
          token: "must-not-leak",
        });
      },
    );

    expect(stdout).toHaveLength(1);
    const record = JSON.parse(stdout[0]!);
    expect(record).toMatchObject({
      level: "info",
      message: "request.completed",
      trace_id: "trace-abc",
      request_id: "trace-abc",
      user_id: "user-1",
      method: "POST",
      path: "/api/v1/agent/chat",
      status_code: 200,
      latency_ms: 12,
      token: "[REDACTED]",
    });
    expect(typeof record.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(record.timestamp))).toBe(false);
  });

  it("routes error and fatal to stderr and omits absent context", () => {
    const { stdout, stderr } = capture();
    logger.error("boom");
    logger.fatal("worse");
    expect(stderr).toHaveLength(2);
    expect(stdout).toHaveLength(0);
    expect(JSON.parse(stderr[0]!)).toMatchObject({ level: "error", message: "boom" });
    expect(JSON.parse(stderr[0]!)).not.toHaveProperty("trace_id");
  });

  it("reaches every level helper", () => {
    capture();
    expect(() => {
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");
      logger.fatal("f");
    }).not.toThrow();
  });
});

