import { describe, expect, it } from "vitest";

import {
  buildPage,
  DEFAULT_PAGE_LIMIT,
  decodeCursor,
  encodeCursor,
  MAX_PAGE_LIMIT,
  parsePageLimit,
} from "@/lib/api/pagination";

describe("parsePageLimit", () => {
  it("uses the fallback for missing/invalid values", () => {
    expect(parsePageLimit(null)).toBe(DEFAULT_PAGE_LIMIT);
    expect(parsePageLimit(undefined)).toBe(DEFAULT_PAGE_LIMIT);
    expect(parsePageLimit("")).toBe(DEFAULT_PAGE_LIMIT);
    expect(parsePageLimit("abc")).toBe(DEFAULT_PAGE_LIMIT);
    expect(parsePageLimit("0")).toBe(DEFAULT_PAGE_LIMIT);
    expect(parsePageLimit("-5")).toBe(DEFAULT_PAGE_LIMIT);
  });

  it("parses valid values and clamps to the maximum", () => {
    expect(parsePageLimit("10")).toBe(10);
    expect(parsePageLimit("25", { fallback: 5 })).toBe(25);
    expect(parsePageLimit("1000")).toBe(MAX_PAGE_LIMIT);
    expect(parsePageLimit("1000", { max: 20 })).toBe(20);
  });
});

describe("cursor codec", () => {
  it("round-trips strings, numbers and nulls", () => {
    const encoded = encodeCursor("inbox", {
      p: 10,
      m: null,
      id: "t-1",
      extra: "x",
    });
    const decoded = decodeCursor(encoded, "inbox", ["p", "m", "id"]);
    expect(decoded).toEqual({ p: 10, m: null, id: "t-1" });
  });

  it("is opaque (does not leak the raw JSON)", () => {
    const encoded = encodeCursor("inbox", { id: "t-1" });
    expect(encoded).not.toContain("{");
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects a cursor minted for another scope", () => {
    const encoded = encodeCursor("followups", { c: "2026-01-01", id: "f-1" });
    expect(decodeCursor(encoded, "inbox", ["c", "id"])).toBeNull();
  });

  it("rejects missing keys and out-of-shape values", () => {
    const missing = encodeCursor("inbox", { p: 1 });
    expect(decodeCursor(missing, "inbox", ["p", "id"])).toBeNull();

    const badValue = encodeCursor("inbox", {
      // @ts-expect-error deliberately invalid cursor payload
      p: { nested: true },
      id: "t-1",
    });
    expect(decodeCursor(badValue, "inbox", ["p", "id"])).toBeNull();
  });

  it("returns null for absent or malformed input", () => {
    expect(decodeCursor(null, "inbox", ["id"])).toBeNull();
    expect(decodeCursor("not-base64!!", "inbox", ["id"])).toBeNull();
    expect(
      decodeCursor(btoa("not json"), "inbox", ["id"]),
    ).toBeNull();
    // Valid JSON that is not an object.
    expect(
      decodeCursor(
        btoa(JSON.stringify([1, 2, 3])).replace(/=+$/, ""),
        "inbox",
        ["id"],
      ),
    ).toBeNull();
  });
});

describe("buildPage", () => {
  const rows = [
    { id: "a", at: "2026-01-03T00:00:00.000Z" },
    { id: "b", at: "2026-01-02T00:00:00.000Z" },
    { id: "c", at: "2026-01-01T00:00:00.000Z" },
  ];
  const cursorOf = (row: (typeof rows)[number]) => ({ c: row.at, id: row.id });

  it("emits a next cursor only when an extra row proves there is more", () => {
    const page = buildPage({ rows, limit: 2, scope: "runs", cursorOf });
    expect(page.page.map((row) => row.id)).toEqual(["a", "b"]);
    expect(page.pagination).toMatchObject({ limit: 2, has_more: true });
    expect(
      decodeCursor(page.pagination.next_cursor, "runs", ["c", "id"]),
    ).toEqual({ c: rows[1]!.at, id: "b" });
  });

  it("does not emit a cursor when the page is exactly full but final", () => {
    const page = buildPage({ rows, limit: 3, scope: "runs", cursorOf });
    expect(page.pagination).toMatchObject({
      limit: 3,
      has_more: false,
      next_cursor: null,
    });
  });

  it("handles an empty result", () => {
    const page = buildPage({
      rows: [] as typeof rows,
      limit: 10,
      scope: "runs",
      cursorOf,
    });
    expect(page.page).toEqual([]);
    expect(page.pagination.next_cursor).toBeNull();
    expect(page.pagination.has_more).toBe(false);
  });
});
