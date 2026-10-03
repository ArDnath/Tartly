import { describe, expect, it } from "vitest";

import {
  hasPgCode,
  isForeignKeyViolation,
  isUniqueViolation,
} from "@/lib/db/errors";

/**
 * The queue and the ORM report Postgres errors differently: raw `pg` throws the
 * driver error directly, while Drizzle wraps it in a `DrizzleQueryError` whose
 * `cause` carries the SQLSTATE. These helpers must see through the wrapper.
 */
describe("Postgres error helpers", () => {
  it("reads the code off a bare driver error", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isForeignKeyViolation({ code: "23503" })).toBe(true);
    expect(hasPgCode({ code: "42P01" }, "42P01")).toBe(true);
  });

  it("unwraps a Drizzle-style cause chain", () => {
    const wrapped = new Error("Failed query", {
      cause: { code: "23505", detail: "Key (user_id, title) already exists." },
    });
    expect(isUniqueViolation(wrapped)).toBe(true);
    expect(isForeignKeyViolation(wrapped)).toBe(false);
  });

  it("follows multiple nested causes", () => {
    const deeplyWrapped = new Error("outer", {
      cause: new Error("inner", { cause: { code: "23503" } }),
    });
    expect(isForeignKeyViolation(deeplyWrapped)).toBe(true);
  });

  it("returns false for non-matching codes, primitives and null", () => {
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation("boom")).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });

  it("does not loop forever on a cyclic cause", () => {
    const cyclic: { code?: string; cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(isUniqueViolation(cyclic)).toBe(false);
  });
});
