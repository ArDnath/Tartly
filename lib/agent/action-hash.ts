import { createHash } from "node:crypto";

/**
 * Deterministic hashing for pending actions.
 *
 * `arguments` are stored as `jsonb`, and Postgres does not preserve object key
 * order. Every hash is therefore taken over a *canonical* serialization (keys
 * sorted recursively) so the value computed at creation and the value computed
 * at confirmation agree regardless of how the row round-trips.
 *
 * Pure module (no `server-only`) so it can be unit-tested directly.
 */

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    // `JSON.stringify` gives stable output for primitives; `undefined` becomes
    // `null` because a value that cannot be serialized must not vanish and
    // change the surrounding object's shape.
    return JSON.stringify(value ?? null);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

/** Stable string form of arbitrary JSON, used as the hash input. */
export function canonicalize(value: unknown): string {
  return canonical(value ?? null);
}

/** sha256 of the canonical arguments — the tamper check verified at confirm. */
export function hashArguments(args: unknown): string {
  return createHash("sha256").update(canonicalize(args)).digest("hex");
}
