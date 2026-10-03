import { describe, expect, it } from "vitest";

import { canonicalize, hashArguments } from "@/lib/agent/action-hash";

describe("canonicalize", () => {
  it("sorts object keys recursively so jsonb round-trips agree", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    expect(canonicalize({ z: { y: 1, x: 2 }, a: 3 })).toBe(
      '{"a":3,"z":{"x":2,"y":1}}',
    );
  });

  it("preserves array order", () => {
    expect(canonicalize([1, { x: 2 }])).toBe('[1,{"x":2}]');
    expect(canonicalize([2, 1])).not.toBe(canonicalize([1, 2]));
  });

  it("normalizes undefined to null so keys cannot vanish", () => {
    expect(canonicalize(undefined)).toBe("null");
    expect(canonicalize({ a: undefined })).toBe('{"a":null}');
  });

  it("serializes primitives stably", () => {
    expect(canonicalize("s")).toBe('"s"');
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize(42)).toBe("42");
    expect(canonicalize(null)).toBe("null");
  });
});

describe("hashArguments", () => {
  it("is stable across object key order", () => {
    expect(hashArguments({ a: 1, b: { c: 2, d: 3 } })).toBe(
      hashArguments({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  it("changes when any value changes", () => {
    expect(hashArguments({ to: "a@x.com" })).not.toBe(
      hashArguments({ to: "b@x.com" }),
    );
  });

  it("produces a 64-char sha256 hex digest", () => {
    expect(hashArguments({ to: "a@x.com" })).toMatch(/^[0-9a-f]{64}$/);
  });
});
