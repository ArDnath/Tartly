/**
 * Postgres error inspection helpers.
 *
 * Drizzle wraps driver errors in a `DrizzleQueryError` whose `cause` holds the
 * original `pg` error, so a naive `error.code === "23505"` check silently
 * misses every constraint violation and turns a recoverable `409` into a
 * `500`. These helpers walk the `cause` chain (bounded, so a cyclic cause can
 * never loop forever) before matching libpq SQLSTATE codes.
 */

const MAX_CAUSE_DEPTH = 5;

/** True when the error (or one of its causes) carries the given SQLSTATE. */
export function hasPgCode(error: unknown, code: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    if ((current as { code?: unknown }).code === code) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** SQLSTATE `23505`: a unique constraint (or unique index) was violated. */
export function isUniqueViolation(error: unknown): boolean {
  return hasPgCode(error, "23505");
}

/** SQLSTATE `23503`: a foreign-key constraint was violated. */
export function isForeignKeyViolation(error: unknown): boolean {
  return hasPgCode(error, "23503");
}
