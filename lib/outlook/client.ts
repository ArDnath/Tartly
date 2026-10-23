import "server-only";

import { cache } from "react";

import { auth } from "@/lib/auth";
import { googleAccountRepository } from "@/lib/repositories/google-account";

/**
 * Thin Microsoft Graph client for Outlook mail.
 *
 * Mirrors `lib/gmail/client.ts`: we never store tokens ourselves — Better Auth's
 * `account` row holds the OAuth grant and `auth.api.getAccessToken` returns (and
 * refreshes) a valid token on demand. A 401/403 means the grant is gone or
 * lacks a scope, which the caller surfaces as a reconnect signal.
 */

export const GRAPH_API_BASE = "https://graph.microsoft.com/v1.0";

export const MICROSOFT_PROVIDER_ID = "microsoft";

export class OutlookAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutlookAuthError";
  }
}

export class OutlookApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "OutlookApiError";
    this.status = status;
  }
}

/**
 * The Better Auth `account` row id for a user's linked Microsoft account. This
 * is the local row id — not the provider subject (`oid`) — because that is the
 * key `getAccessToken` expects. Cached per request: a mailbox page makes many
 * Graph calls and each would otherwise repeat the lookup.
 */
export const getMicrosoftAuthAccountId = cache(
  async (userId: string): Promise<string | null> => {
    const id = await googleAccountRepository.findIdByUserAndProvider({
      userId,
      providerId: MICROSOFT_PROVIDER_ID,
    });
    return id ?? null;
  },
);

/** Whether the user has linked a Microsoft account at all. */
export async function isOutlookConnected(userId: string): Promise<boolean> {
  return Boolean(await getMicrosoftAuthAccountId(userId));
}

/** Short-lived, process-wide access-token cache (Graph tokens last ~1h). */
const ACCESS_TOKEN_TTL_MS = 5 * 60 * 1000;
const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function getMicrosoftAccessToken(userId: string): Promise<string> {
  const accountId = await getMicrosoftAuthAccountId(userId);
  if (!accountId) {
    throw new OutlookAuthError("No linked Microsoft account for this user.");
  }

  const cached = accessTokenCache.get(accountId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  try {
    const result = await auth.api.getAccessToken({
      body: { accountId, userId },
    });
    if (!result?.accessToken) {
      throw new OutlookAuthError("Microsoft returned no access token.");
    }
    accessTokenCache.set(accountId, {
      token: result.accessToken,
      expiresAt: Date.now() + ACCESS_TOKEN_TTL_MS,
    });
    return result.accessToken;
  } catch (error) {
    accessTokenCache.delete(accountId);
    if (error instanceof OutlookAuthError) throw error;
    throw new OutlookAuthError(
      `Failed to obtain a Microsoft access token: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Drop one user's cached Graph token after a 401/403. Re-linking reuses the same
 * `account` row — and therefore the same cache key — so without this a reconnect
 * would keep serving the rejected token for the rest of its TTL.
 */
export async function forgetMicrosoftAccessToken(userId: string): Promise<void> {
  const accountId = await getMicrosoftAuthAccountId(userId);
  if (accountId) accessTokenCache.delete(accountId);
}

/** Transport seam so the mail layer can be exercised without hitting Graph. */
export type OutlookTransport = (
  userId: string,
  path: string,
  init?: RequestInit,
) => Promise<Response>;

export const GRAPH_REQUEST_TIMEOUT_MS = 20_000;

export const defaultOutlookTransport: OutlookTransport = async (
  userId,
  path,
  init,
) => {
  const token = await getMicrosoftAccessToken(userId);
  const response = await fetch(`${GRAPH_API_BASE}${path}`, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(GRAPH_REQUEST_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (response.status === 401 || response.status === 403) {
    // A 403 on Graph is almost always a missing/revoked scope; reconnect helps.
    await forgetMicrosoftAccessToken(userId).catch(() => {});
    throw new OutlookAuthError(
      `Microsoft Graph authorization failed (${response.status}); reconnect Outlook.`,
    );
  }

  return response;
};

export async function graphJson<T>(
  userId: string,
  path: string,
  init?: RequestInit,
  transport: OutlookTransport = defaultOutlookTransport,
): Promise<T> {
  const response = await transport(userId, path, init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new OutlookApiError(
      response.status,
      `Microsoft Graph ${response.status}: ${body.slice(0, 300)}`,
    );
  }
  // Move/PATCH answer 202/204 with no body.
  if (response.status === 202 || response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Follow Graph's `@odata.nextLink` when it is an absolute URL, otherwise treat
 * the value as a path relative to the API base.
 */
export function graphPath(nextLink: string): string {
  if (nextLink.startsWith(GRAPH_API_BASE)) {
    return nextLink.slice(GRAPH_API_BASE.length);
  }
  return nextLink;
}
