import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The contract middleware runs inside `withUser`; stub the session/rate-limit/
// idempotency edges so only the contract path is under test.
vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "user-1" } })),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
}));
vi.mock("@/lib/api/idempotency", () => ({
  beginIdempotent: vi.fn(async () => ({
    kind: "run" as const,
    finish: async () => {},
  })),
  MAX_IDEMPOTENCY_KEY_LENGTH: 64,
}));

import { withUser } from "@/lib/api/http";

function jsonHandler() {
  return withUser(async () => {
    return Response.json({ data: { ok: true } });
  });
}

function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("withUser contract enforcement", () => {
  beforeEach(() => {
    // Enforce mode is the default outside production.
    delete process.env.API_CONTRACT_VALIDATION;
  });

  it("rejects an unknown action status with 400 + issues", async () => {
    const response = await jsonHandler()(
      jsonRequest("/api/v1/agent/actions?status=NOPE", "GET"),
      {},
    );
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      error: { code: string; details?: unknown };
    };
    expect(payload.error.code).toBe("validation");
    expect(payload.error.details).toBeDefined();
  });

  it("rejects an invalid body before the handler runs", async () => {
    let called = false;
    const handler = withUser(async () => {
      called = true;
      return Response.json({ data: { ok: true } });
    });
    const response = await handler(
      jsonRequest("/api/v1/agent/chat", "POST", {}),
      {},
    );
    expect(response.status).toBe(400);
    expect(called).toBe(false);
  });

  it("runs the handler for a conforming request", async () => {
    const response = await jsonHandler()(
      jsonRequest("/api/v1/agent/chat", "POST", {
        conversationId: "c1",
        text: "hello",
      }),
      {},
    );
    expect(response.status).toBe(200);
  });

  it("does not validate when the mode is off", async () => {
    process.env.API_CONTRACT_VALIDATION = "off";
    const response = await jsonHandler()(
      jsonRequest("/api/v1/agent/actions?status=NOPE", "GET"),
      {},
    );
    expect(response.status).toBe(200);
    delete process.env.API_CONTRACT_VALIDATION;
  });

  it("warns but continues in warn mode", async () => {
    process.env.API_CONTRACT_VALIDATION = "warn";
    const response = await jsonHandler()(
      jsonRequest("/api/v1/agent/actions?status=NOPE", "GET"),
      {},
    );
    expect(response.status).toBe(200);
    delete process.env.API_CONTRACT_VALIDATION;
  });

  it("propagates an inbound W3C traceparent into the log trace_id", async () => {
    const lines: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk) => {
        lines.push(String(chunk));
        return true;
      });

    const traceparent =
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    const response = await jsonHandler()(
      new NextRequest("http://localhost/api/v1/agent/chat", {
        method: "GET",
        headers: { traceparent },
      }),
      {},
    );
    spy.mockRestore();

    expect(response.status).toBe(200);
    const completed = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((record) => record.message === "request.completed");
    expect(completed?.trace_id).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(completed?.request_id).not.toBe(completed?.trace_id);
    expect(completed?.parent_span_id).toBe("00f067aa0ba902b7");
  });
});
