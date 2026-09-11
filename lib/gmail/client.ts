import "server-only";

import { and, eq } from "drizzle-orm";
import { cache } from "react";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { account } from "@/lib/db/schema";

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
    const rows = await db
      .select({ id: account.id })
      .from(account)
      .where(
        and(eq(account.userId, userId), eq(account.providerId, "google")),
      )
      .limit(1);

    return rows[0]?.id ?? null;
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

/** Transport seam so tests can run the send path without hitting Google. */
export type GmailTransport = (
  userId: string,
  path: string,
  init?: RequestInit,
) => Promise<Response>;

/** Every Gmail call is bounded; a hung socket must never stall a request. */
export const GMAIL_REQUEST_TIMEOUT_MS = 20_000;

export const defaultGmailTransport: GmailTransport = async (
  userId,
  path,
  init,
) => {
  const token = await getGoogleAccessToken(userId);
  const response = await fetch(`${GMAIL_API_BASE}${path}`, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(GMAIL_REQUEST_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new GmailAuthError(
      `Gmail authorization failed (${response.status}); reconnect Google.`,
    );
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
