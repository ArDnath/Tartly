import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `googleAuthFailure` must (1) evict the cached access token when the grant is
 * the problem, so a reconnect takes effect immediately, and (2) not tell the
 * user to reconnect when Google refused for a non-auth reason (disabled API,
 * quota), which reconnecting cannot fix.
 */

const { getAccessToken } = vi.hoisted(() => ({ getAccessToken: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getAccessToken: (...args: unknown[]) => getAccessToken(...args),
    },
  },
}));

vi.mock("@/lib/repositories/google-account", () => ({
  googleAccountRepository: {
    findIdByUserAndProvider: vi.fn(async () => "acct-1"),
  },
}));

import {
  getGoogleAccessToken,
  googleAuthFailure,
  invalidateGoogleAccessToken,
  GmailApiError,
  GmailAuthError,
} from "@/lib/gmail/client";

const USER_ID = "user-1";

function googleError(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Warm the cache with one token so eviction is observable. */
async function seedToken(token = "token-1"): Promise<void> {
  getAccessToken.mockResolvedValueOnce({ accessToken: token });
  expect(await getGoogleAccessToken(USER_ID)).toBe(token);
  expect(getAccessToken).toHaveBeenCalledTimes(1);
}

beforeEach(() => {
  invalidateGoogleAccessToken();
  getAccessToken.mockReset();
});

describe("googleAuthFailure", () => {
  it("evicts the cached token and asks for a reconnect on 401", async () => {
    await seedToken("stale");

    await expect(
      googleAuthFailure(
        googleError(401, { error: { status: "UNAUTHENTICATED" } }),
        "Gmail",
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(GmailAuthError);

    getAccessToken.mockResolvedValueOnce({ accessToken: "fresh" });
    expect(await getGoogleAccessToken(USER_ID)).toBe("fresh");
    expect(getAccessToken).toHaveBeenCalledTimes(2);
  });

  it("treats a 403 insufficientPermissions as a reconnect and evicts", async () => {
    await seedToken("stale");

    await expect(
      googleAuthFailure(
        googleError(403, {
          error: {
            status: "PERMISSION_DENIED",
            errors: [{ reason: "insufficientPermissions" }],
          },
        }),
        "Gmail",
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(GmailAuthError);

    getAccessToken.mockResolvedValueOnce({ accessToken: "fresh" });
    expect(await getGoogleAccessToken(USER_ID)).toBe("fresh");
    expect(getAccessToken).toHaveBeenCalledTimes(2);
  });

  it("defaults an unrecognized 403 to a reconnect", async () => {
    await seedToken("stale");

    await expect(
      googleAuthFailure(googleError(403, {}), "Gmail", USER_ID),
    ).rejects.toBeInstanceOf(GmailAuthError);

    getAccessToken.mockResolvedValueOnce({ accessToken: "fresh" });
    expect(await getGoogleAccessToken(USER_ID)).toBe("fresh");
    expect(getAccessToken).toHaveBeenCalledTimes(2);
  });

  it("does not evict and reports a non-auth error when the API is disabled", async () => {
    await seedToken("valid");

    await expect(
      googleAuthFailure(
        googleError(403, {
          error: {
            status: "PERMISSION_DENIED",
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                reason: "SERVICE_DISABLED",
              },
            ],
          },
        }),
        "Gmail",
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(GmailApiError);

    // Still served from cache: no wasted token fetch after a config failure.
    expect(await getGoogleAccessToken(USER_ID)).toBe("valid");
    expect(getAccessToken).toHaveBeenCalledTimes(1);
  });
});
