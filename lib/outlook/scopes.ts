/**
 * Microsoft Graph scopes requested for the Outlook connection, plus tiny scope
 * helpers shared by the mail layer.
 *
 * Kept free of `server-only` so the better-auth provider config, the connect
 * API and the onboarding/settings clients all agree on one list.
 *
 * `offline_access` (a refresh token) and `User.Read` are added by better-auth's
 * Microsoft provider by default; only the mail permissions are listed here.
 */
export const MICROSOFT_MAIL_SCOPES = [
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/Mail.Send",
] as const;

/** The scope that proves Outlook mailbox (not just sign-in) access. */
export const MICROSOFT_MAIL_ACCESS_SCOPE = "Mail.ReadWrite";

/** The Google equivalent that proves Gmail mailbox (not just sign-in) access. */
export const GOOGLE_MAIL_ACCESS_SCOPE = "gmail.modify";

/**
 * Split a provider's stored scope string into individual scopes.
 *
 * Google stores a comma-joined list; Microsoft returns space-separated values.
 * Both may be full URIs (`https://…/Mail.ReadWrite`) or bare names; callers
 * match on the suffix.
 */
export function parseScopeList(scope: string | null | undefined): string[] {
  return (scope ?? "")
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Whether a stored scope string grants a scope, tolerating the full-URI form
 * (`https://graph.microsoft.com/Mail.ReadWrite` matches `Mail.ReadWrite`).
 */
export function hasScope(
  scope: string | null | undefined,
  required: string,
): boolean {
  return parseScopeList(scope).some(
    (value) => value === required || value.endsWith(`/${required}`),
  );
}
