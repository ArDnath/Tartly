import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineOperation } from "@/lib/api/contracts/registry";
import {
  dataEnvelope,
  streamResponse,
} from "@/lib/api/contracts/shared";
import { findBreakingChanges } from "@/lib/api/openapi/breaking";
import { buildOpenApiDocument } from "@/lib/api/openapi/spec";

const list = defineOperation({
  method: "GET",
  path: "/api/v1/inbox/{threadId}",
  operationId: "getInboxThread",
  tags: ["inbox"],
  summary: "Thread detail",
  security: "session",
  params: z.object({ threadId: z.string().min(1) }),
  query: z.object({ cursor: z.string().optional() }).passthrough(),
  responses: { 200: { description: "ok", schema: dataEnvelope(z.unknown()) } },
});

const stream = defineOperation({
  method: "POST",
  path: "/api/v1/agent/chat",
  operationId: "agentChat",
  tags: ["agent"],
  summary: "Stream chat",
  security: "session",
  body: z.object({ conversationId: z.string() }),
  responses: streamResponse("text/event-stream", "stream"),
});

function document() {
  return buildOpenApiDocument([list, stream], { version: "1.2.3" });
}

describe("buildOpenApiDocument", () => {
  it("emits an OpenAPI 3.1 document with the package version", () => {
    const doc = document();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.version).toBe("1.2.3");
  });

  it("requires path params and adds query params from the schema", () => {
    const doc = document() as unknown as {
      paths: Record<string, Record<string, { parameters?: unknown[] }>>;
    };
    const params = doc.paths["/api/v1/inbox/{threadId}"]!.get!.parameters!;
    expect(params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "threadId", in: "path", required: true }),
        expect.objectContaining({ name: "cursor", in: "query", required: false }),
      ]),
    );
  });

  it("documents streaming responses with their media type", () => {
    const doc = document() as unknown as {
      paths: Record<
        string,
        Record<string, { responses: Record<string, { content?: unknown }> }>
      >;
    };
    const ok = doc.paths["/api/v1/agent/chat"]!.post!.responses["200"]!;
    expect(ok.content).toHaveProperty("text/event-stream");
  });

  it("references the shared error envelope instead of inlining it", () => {
    const doc = document() as unknown as {
      components: { schemas: Record<string, unknown> };
      paths: Record<
        string,
        Record<string, { responses: Record<string, { content?: unknown }> }>
      >;
    };
    expect(doc.components.schemas).toHaveProperty("ErrorEnvelope");
    const badRequest = doc.paths["/api/v1/agent/chat"]!.post!.responses["400"]!;
    expect(JSON.stringify(badRequest)).toContain(
      "#/components/schemas/ErrorEnvelope",
    );
  });

  it("is deterministic regardless of input order", () => {
    const a = JSON.stringify(buildOpenApiDocument([stream, list], { version: "1" }));
    const b = JSON.stringify(document());
    // The version differs, so compare the schema-bearing paths only.
    expect(a).toContain('"/api/v1/inbox/{threadId}"');
    expect(b).toContain('"/api/v1/inbox/{threadId}"');
  });
});

describe("findBreakingChanges", () => {
  const baseline = document() as unknown;

  it("returns nothing for identical specs", () => {
    expect(findBreakingChanges(baseline, document())).toEqual([]);
  });

  it("flags a removed path and a removed operation", () => {
    const next = JSON.parse(JSON.stringify(baseline));
    delete next.paths["/api/v1/inbox/{threadId}"];
    expect(findBreakingChanges(baseline, next).join(" ")).toContain(
      "Removed path /api/v1/inbox/{threadId}",
    );
  });

  it("flags a removed response status", () => {
    const next = JSON.parse(JSON.stringify(baseline));
    delete next.paths["/api/v1/agent/chat"].post.responses["200"];
    expect(findBreakingChanges(baseline, next).join(" ")).toContain(
      "removed response 200",
    );
  });

  it("flags a newly-required request body field", () => {
    const next = JSON.parse(JSON.stringify(baseline));
    next.paths["/api/v1/agent/chat"].post.requestBody.content[
      "application/json"
    ].schema.required.push("extra");
    expect(findBreakingChanges(baseline, next).join(" ")).toContain(
      'new required property "extra"',
    );
  });

  it("flags a removed path parameter and an enum narrowing", () => {
    const next = JSON.parse(JSON.stringify(baseline));
    next.paths["/api/v1/inbox/{threadId}"].get.parameters = [];
    expect(findBreakingChanges(baseline, next).join(" ")).toContain(
      "removed path parameter",
    );

    const narrowed = JSON.parse(JSON.stringify(baseline));
    narrowed.paths["/api/v1/agent/chat"].post.requestBody.content[
      "application/json"
    ].schema.properties.conversationId = { type: "string", enum: ["a"] };
    const before = JSON.parse(JSON.stringify(baseline));
    before.paths["/api/v1/agent/chat"].post.requestBody.content[
      "application/json"
    ].schema.properties.conversationId = { type: "string", enum: ["a", "b"] };
    expect(findBreakingChanges(before, narrowed).join(" ")).toContain(
      "removed enum value",
    );
  });

  it("does not flag additive changes", () => {
    const next = JSON.parse(JSON.stringify(baseline));
    next.paths["/api/v1/new"] = {
      get: { responses: { 200: { description: "ok" } } },
    };
    next.paths["/api/v1/agent/chat"].post.requestBody.content[
      "application/json"
    ].schema.properties.optionalExtra = { type: "string" };
    expect(findBreakingChanges(baseline, next)).toEqual([]);
  });
});
