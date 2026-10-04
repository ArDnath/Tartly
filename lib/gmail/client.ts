import "server-only";

import { cache } from "react";

import { auth } from "@/lib/auth";
import { gmailQuotaUnits, runWithGoogleGuard } from "@/lib/google/quota";
import { googleAccountRepository } from "@/lib/repositories/google-account";

/**
 * Thin Gmail REST client.
 *
 * Access tokens are never stored by us: Better Auth's `account` row holds the
 * OAuth grant and `auth.api.getAccessToken` returns (and refreshes) a valid
 * token on demand. A 401/403 means the grant is gone or lacks a scope — the
 * caller surfaces that as a reconnect signal.
 */

export const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailAuthError";
  }
}

export class GmailApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GmailApiError";
    this.status = status;
  }
}

/**
 * Resolves Better Auth's local `account` row id for a user's linked Google
 * account, if any.
 *
 * Note: this is the *Better Auth account id* (the primary key of the `account`
 * table), not the provider's subject id (`account.accountId`, Google's `sub`).
 * `auth.api.getAccessToken` looks accounts up by this local id, so passing the
 * provider id fails with `ACCOUNT_NOT_FOUND`.
 *
 * Cached per request: a single mailbox page fans out to dozens of Gmail calls,
 * and without this each one would repeat the same `account` lookup.
 */
export const getGoogleAuthAccountId = cache(
  async (userId: string): Promise<string | null> => {
    const id = await googleAccountRepository.findIdByUserAndProvider({
      userId,
      providerId: "google",
    });

    return id ?? null;
  },
);

/**
 * Short-lived, process-wide access-token cache.
 *
 * Gmail tokens are valid for ~an hour; caching one for a few minutes removes
 * the per-request `auth.api.getAccessToken` round trip (account lookup +
 * possible refresh check) from the hot path of every Gmail call, while keeping
 * revocation/refresh detection within a tight window.
 */
const ACCESS_TOKEN_TTL_MS = 5 * 60 * 1000;
const accessTokenCache = new Map<
  string,
  { token: string; expiresAt: number }
>();

export async function getGoogleAccessToken(userId: string): Promise<string> {
  const accountId = await getGoogleAuthAccountId(userId);
  if (!accountId) {
    throw new GmailAuthError("No linked Google account for this user.");
  }

  const cached = accessTokenCache.get(accountId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  try {
    const result = await auth.api.getAccessToken({
      body: { accountId, userId },
    });
    if (!result?.accessToken) {
      throw new GmailAuthError("Google returned no access token.");
    }
    accessTokenCache.set(accountId, {
      token: result.accessToken,
      expiresAt: Date.now() + ACCESS_TOKEN_TTL_MS,
    });
    return result.accessToken;
  } catch (error) {
    accessTokenCache.delete(accountId);
    if (error instanceof GmailAuthError) throw error;
    throw new GmailAuthError(
      `Failed to obtain a Google access token: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** Drop every cached access token (called when a grant is revoked). */
export function invalidateGoogleAccessToken(): void {
  // The cache is keyed by account id; clearing the whole map on revoke is
  // cheap and rare, and the next call repopulates it.
  accessTokenCache.clear();
}

/**
 * Drop one user's cached access token.
 *
 * Called when Google rejects the token with a 401/403: the cached entry is
 * demonstrably unusable, and because re-linking updates the *same* account row
 * (same cache key), leaving it in place would keep serving the bad token for the
 * rest of its TTL — so a reconnect would look like it did nothing.
 */
export async function forgetGoogleAccessToken(userId: string): Promise<void> {
  const accountId = await getGoogleAuthAccountId(userId);
  if (accountId) accessTokenCache.delete(accountId);
}

/** Transport seam so tests can run the send path without hitting Google. */
export type GmailTransport = (
  userId: string,
  path: string,
  init?: RequestInit,
) => Promise<Response>;

/** Every Gmail call is bounded; a hung socket must never stall a request. */
export const GMAIL_REQUEST_TIMEOUT_MS = 20_000;

/**
 * Google reasons that mean the grant is unusable (a reconnect fixes them).
 * Anything not on the non-auth list below is treated as one of these.
 */
const NON_AUTH_GOOGLE_REASONS = new Set([
  "accessNotConfigured",
  "SERVICE_DISABLED",
  "API_DISABLED",
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "RESOURCE_EXHAUSTED",
]);

/** Google's machine-readable error reason(s) from a response body, if any. */
async function googleErrorReasons(response: Response): Promise<string[]> {
  try {
    const body = (await response.clone().json()) as {
      error?: {
        errors?: Array<{ reason?: string }>;
        details?: Array<{ reason?: string }>;
      };
    };
    return [
      ...(body.error?.errors ?? []).map((entry) => entry.reason),
      ...(body.error?.details ?? []).map((entry) => entry.reason),
    ].filter((reason): reason is string => Boolean(reason));
  } catch {
    return [];
  }
}

/**
 * Whether a Google 401/403 is a grant problem (reconnect helps) rather than a
 * Cloud-project/quota problem (reconnect does not). A 401 is always the former;
 * an unrecognized 403 is treated as the former too, so a real scope failure
 * never strands the user behind a message that tells them to do nothing.
 */
function shouldReconnectGoogle(status: number, reasons: string[]): boolean {
  if (status === 401) return true;
  return !reasons.some((reason) => NON_AUTH_GOOGLE_REASONS.has(reason));
}

/**
 * Convert a Google 401/403 into the right error and evict the bad token.
 *
 * A 403 is ambiguous: Google uses it both for "the grant lacks the required
 * scope" (reconnect fixes it) and for "the API is disabled in this project" or
 * an exhausted quota (reconnect does not). Reading the reason keeps the advice
 * honest instead of always saying "reconnect Google". Never returns.
 */
export async function googleAuthFailure(
  response: Response,
  apiLabel: string,
  userId: string,
): Promise<never> {
  const reasons = await googleErrorReasons(response);
  if (shouldReconnectGoogle(response.status, reasons)) {
    // Evict before throwing so the next attempt after a reconnect re-reads the
    // stored tokens instead of replaying the rejected one.
    await forgetGoogleAccessToken(userId).catch(() => {});
    throw new GmailAuthError(
      `${apiLabel} authorization failed (${response.status}); reconnect Google.`,
    );
  }
  throw new GmailApiError(
    response.status,
    `${apiLabel} request failed (${response.status}${
      reasons[0] ? `, ${reasons[0]}` : ""
    }).`,
  );
}

/**
 * The stable identity of a user's Google connection, used to key the shared
 * quota/semaphore/circuit state. Falls back to the user id when no Better Auth
 * account row exists (the token call above would already have failed).
 */
export async function getGoogleConnectionId(userId: string): Promise<string> {
  return (await getGoogleAuthAccountId(userId)) ?? `user:${userId}`;
}

export const defaultGmailTransport: GmailTransport = async (
  userId,
  path,
  init,
) => {
  const token = await getGoogleAccessToken(userId);
  const method = init?.method ?? "GET";
  const connectionId = await getGoogleConnectionId(userId);
  const route = path.split("?")[0] ?? path;

  // Every call is rate-limited per connection + project, bounded by a
  // concurrency semaphore, retried with jitter on 429/5xx, and short-circuited
  // when a connection is repeatedly failing.
  const response = await runWithGoogleGuard({
    api: "gmail",
    connectionId,
    units: gmailQuotaUnits(path, method),
    label: `Gmail ${method} ${route}`,
    run: () =>
      fetch(`${GMAIL_API_BASE}${path}`, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(GMAIL_REQUEST_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
      }),
  });

  if (response.status === 401 || response.status === 403) {
    return googleAuthFailure(response, "Gmail", userId);
  }

  return response;
};

export async function gmailJson<T>(
  userId: string,
  path: string,
  init?: RequestInit,
  transport: GmailTransport = defaultGmailTransport,
): Promise<T> {
  const response = await transport(userId, path, init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new GmailApiError(response.status, `Gmail API ${response.status}: ${body.slice(0, 300)}`);
  }
  // `messages.batchModify` (and friends) answer 204 with no body; parsing that
  // as JSON throws on a successful call.
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
