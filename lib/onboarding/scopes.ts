/**
 * OAuth scope helpers shared by the onboarding routes.
 *
 * Google returns the granted scopes as a comma-joined string on the Better Auth
 * `account` row. A grant can omit individual toggles from the consent screen,
 * so callers verify instead of trusting the redirect.
 */

/** Splits the stored comma-joined scope string into a set of scope values. */
export function parseGrantedScopes(scope: string | null): Set<string> {
  return new Set(
    (scope ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

/**
 * Whether a stored scope string covers every required scope.
 * An empty `required` list is vacuously true.
 */
export function hasGrantedScopes(
  scope: string | null,
  required: readonly string[],
): boolean {
  const granted = parseGrantedScopes(scope);
  return required.every((value) => granted.has(value));
}
