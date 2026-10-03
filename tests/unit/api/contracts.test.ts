import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createOperationMatcher,
  defineOperation,
  type OperationContract,
} from "@/lib/api/contracts/registry";
import {
  buildQueryObject,
  validateInbound,
} from "@/lib/api/contracts/validate";

function operation(partial: Partial<OperationContract>): OperationContract {
  return {
    method: "GET",
    path: "/api/v1/things",
    operationId: "getThings",
    tags: ["things"],
    summary: "List things",
    security: "session",
    responses: { 200: { description: "ok" } },
    ...partial,
  };
}

describe("defineOperation", () => {
  it("rejects a relative path", () => {
    expect(() => defineOperation(operation({ path: "api/v1/things" }))).toThrow();
  });

  it("requires at least one tag", () => {
    expect(() => defineOperation(operation({ tags: [] }))).toThrow();
  });
});

describe("createOperationMatcher", () => {
  const matcher = createOperationMatcher([
    operation({
      method: "GET",
      path: "/api/v1/campaigns/{id}",
      operationId: "getCampaign",
    }),
    operation({
      method: "GET",
      path: "/api/v1/campaigns/suppression",
      operationId: "listSuppression",
    }),
    operation({
      method: "POST",
      path: "/api/v1/things",
      operationId: "createThing",
    }),
  ]);

  it("matches a literal path in preference to a dynamic one", () => {
    expect(matcher("GET", "/api/v1/campaigns/suppression")?.operation.operationId).toBe(
      "listSuppression",
    );
  });

  it("extracts and decodes path params", () => {
    const match = matcher("GET", "/api/v1/campaigns/a%2Fb");
    expect(match?.operation.operationId).toBe("getCampaign");
    expect(match?.params).toEqual({ id: "a/b" });
  });

  it("tolerates a trailing slash and ignores the wrong method", () => {
    expect(matcher("GET", "/api/v1/campaigns/abc/")?.operation.operationId).toBe(
      "getCampaign",
    );
    expect(matcher("DELETE", "/api/v1/campaigns/abc")).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(matcher("GET", "/api/v1/unknown")).toBeNull();
  });
});

describe("buildQueryObject", () => {
  it("keeps single values scalar and repeated keys as arrays", () => {
    const params = new URLSearchParams("a=1&b=2&b=3");
    expect(buildQueryObject(params)).toEqual({ a: "1", b: ["2", "3"] });
  });
});

describe("validateInbound", () => {
  const contract = operation({
    params: z.object({ id: z.string().min(1) }),
    query: z.object({ limit: z.string().optional() }).passthrough(),
    body: z.object({ name: z.string().min(1) }),
  });

  const base = {
    searchParams: new URLSearchParams(),
    params: { id: "abc" },
    body: { name: "ok" },
    hasBody: true,
  };

  it("passes a conforming request", () => {
    expect(validateInbound(contract, base)).toEqual([]);
  });

  it("reports params, query and body issues with their targets", () => {
    const issues = validateInbound(contract, {
      searchParams: new URLSearchParams(),
      params: { id: "" },
      body: {},
      hasBody: true,
    });
    const targets = issues.map((issue) => issue.target);
    expect(targets).toContain("params");
    expect(targets).toContain("body");
  });

  it("skips body validation when there is no body", () => {
    const issues = validateInbound(contract, {
      ...base,
      body: undefined,
      hasBody: false,
    });
    expect(issues).toEqual([]);
  });
});
