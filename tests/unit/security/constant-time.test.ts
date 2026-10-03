import { describe, expect, it } from "vitest";

import { constantTimeEqual } from "@/lib/security/constant-time";

describe("constantTimeEqual", () => {
  it("returns true for identical secrets", () => {
    expect(constantTimeEqual("s3cr3t-value", "s3cr3t-value")).toBe(true);
  });

  it("returns false for equal-length but different secrets", () => {
    expect(constantTimeEqual("s3cr3t-value", "s3cr3t-valuf")).toBe(false);
  });

  it("returns false for different-length secrets without throwing", () => {
    expect(() => constantTimeEqual("short", "a-much-longer-secret")).not.toThrow();
    expect(constantTimeEqual("short", "a-much-longer-secret")).toBe(false);
  });

  it("handles empty strings", () => {
    expect(constantTimeEqual("", "")).toBe(true);
    expect(constantTimeEqual("", "x")).toBe(false);
  });

  it("compares by UTF-8 bytes, not UTF-16 code units", () => {
    // "é" is two UTF-8 bytes; a naive length check on code units would agree
    // with "e" here and let a mismatch slip through the timing-safe compare.
    expect(constantTimeEqual("café", "cafe")).toBe(false);
    expect(constantTimeEqual("café", "café")).toBe(true);
  });
});
