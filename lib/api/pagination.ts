/**
 * Cursor (keyset) pagination primitives (Phase C5, SKILL §2.4).
 *
 * This module is deliberately **client-safe** (no `server-only`, no Next
 * imports) so the shapes can be shared by server handlers and client fetchers.
 * The cursor is an opaque, base64url-encoded JSON object carrying the ordering
 * key(s) of the last row plus a short scope tag. It is not a secret — it is
 * only validated, never trusted: {@link decodeCursor} rejects anything that
 * does not carry the expected scope/keys, so a cursor minted for one list
 * cannot be replayed against another.
 *
 * Keyset beats `OFFSET` for large, live lists: the query is an indexed range
 * scan (`WHERE (k, id) < ($1, $2)`) rather than a scan-and-discard, and it does
 * not skip/duplicate rows when the list mutates between pages.
 */

export type CursorPrimitive = string | number | null;
export type CursorValues = Record<string, CursorPrimitive>;

/** Standard pagination envelope sibling to `data` (SKILL §2.4). */
export type PaginationMeta = {
  limit: number;
  has_more: boolean;
  next_cursor: string | null;
};

/** A page payload paired with its cursor metadata. */
export type Paginated<T> = {
  data: T;
  pagination: PaginationMeta;
};

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

/** Parse and clamp a `?limit=` query value. Invalid values fall back cleanly. */
export function parsePageLimit(
  raw: string | null | undefined,
  {
    fallback = DEFAULT_PAGE_LIMIT,
    max = MAX_PAGE_LIMIT,
  }: { fallback?: number; max?: number } = {},
): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function base64UrlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Mint an opaque cursor for `scope` from the last row's ordering keys. */
export function encodeCursor(scope: string, values: CursorValues): string {
  return base64UrlEncode(JSON.stringify({ s: scope, ...values }));
}

/**
 * Decode and validate a cursor. Returns `null` for a missing/tampered/foreign
 * cursor so callers can treat it as "first page" rather than 400-ing an
 * otherwise valid request. `keys` is the exact set of ordering keys expected.
 */
export function decodeCursor(
  raw: string | null | undefined,
  scope: string,
  keys: readonly string[],
): CursorValues | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlDecode(raw));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (record.s !== scope) return null;

  const values: CursorValues = {};
  for (const key of keys) {
    const value = record[key];
    if (value !== null && typeof value !== "string" && typeof value !== "number") {
      return null;
    }
    values[key] = value as CursorPrimitive;
  }
  return values;
}

/**
 * Turn an over-fetched page (`limit + 1` rows) into a trimmed page plus its
 * `pagination` metadata. `next_cursor` is only emitted when another page exists.
 */
export function buildPage<T>(input: {
  rows: T[];
  limit: number;
  scope: string;
  cursorOf: (row: T) => CursorValues;
}): { page: T[]; pagination: PaginationMeta } {
  const { rows, limit, scope, cursorOf } = input;
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    page,
    pagination: {
      limit,
      has_more: hasMore,
      next_cursor: hasMore && last ? encodeCursor(scope, cursorOf(last)) : null,
    },
  };
}
