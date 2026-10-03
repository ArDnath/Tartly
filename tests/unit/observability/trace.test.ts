import { describe, expect, it } from "vitest";

import { formatTraceparent, parseTraceparent } from "@/lib/observability/trace";

const VALID = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

describe("parseTraceparent", () => {
  it("parses a well-formed header", () => {
    expect(parseTraceparent(VALID)).toEqual({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      parentId: "00f067aa0ba902b7",
      flags: 1,
    });
  });

  it("normalizes case and surrounding whitespace", () => {
    const parsed = parseTraceparent(`  ${VALID.toUpperCase()}  `);
    expect(parsed?.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("rejects malformed and absent headers", () => {
    expect(parseTraceparent(null)).toBeNull();
    expect(parseTraceparent("")).toBeNull();
    expect(parseTraceparent("not-a-trace")).toBeNull();
    expect(parseTraceparent("00-too-short-00f067aa0ba902b7-01")).toBeNull();
  });

  it("rejects the spec's all-zero ids", () => {
    expect(
      parseTraceparent(`00-${"0".repeat(32)}-00f067aa0ba902b7-01`),
    ).toBeNull();
    expect(
      parseTraceparent(`00-4bf92f3577b34da6a3ce929d0e0e4736-${"0".repeat(16)}-01`),
    ).toBeNull();
  });
});

describe("formatTraceparent", () => {
  it("round-trips through parse", () => {
    const header = formatTraceparent({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      flags: 1,
    });
    expect(header).toBe(VALID);
    expect(parseTraceparent(header)).not.toBeNull();
  });

  it("defaults the sampled flag to 1", () => {
    const header = formatTraceparent({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
    });
    expect(header.endsWith("-01")).toBe(true);
  });
});
