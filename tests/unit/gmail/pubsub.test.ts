import { createSign, generateKeyPairSync } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  PubSubAuthError,
  verifyGoogleOidcToken,
  type PubSubClaims,
} from "@/lib/gmail/pubsub";

const NOW = new Date("2026-10-31T17:00:00.000Z");
const AUDIENCE = "https://tartly.test/api/webhooks/gmail";
const PUSH_SERVICE_ACCOUNT = "gmail-push@tartly-test.iam.gserviceaccount.com";
const KEY_ID = "pubsub-unit-test-key";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const publicJwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: KEY_ID,
  alg: "RS256",
  use: "sig",
};

const fetchMock = vi.fn(async () =>
  new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 }),
);

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signedToken(overrides: Partial<PubSubClaims> = {}): string {
  const header = encodeJson({ alg: "RS256", kid: KEY_ID, typ: "JWT" });
  const payload = encodeJson({
    iss: "https://accounts.google.com",
    aud: AUDIENCE,
    exp: Math.floor(NOW.getTime() / 1000) + 60,
    email: PUSH_SERVICE_ACCOUNT,
    email_verified: true,
    ...overrides,
  });
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${signer.sign(privateKey).toString("base64url")}`;
}

const verificationOptions = {
  audience: AUDIENCE,
  serviceAccountEmail: PUSH_SERVICE_ACCOUNT,
};

beforeAll(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("verifyGoogleOidcToken", () => {
  it("accepts a Google-signed token from the configured, verified push identity", async () => {
    const claims = await verifyGoogleOidcToken(
      signedToken(),
      verificationOptions,
      NOW,
    );

    expect(claims).toMatchObject({
      aud: AUDIENCE,
      email: PUSH_SERVICE_ACCOUNT,
      email_verified: true,
    });
  });

  it("accepts Google's tokeninfo string representation of a verified email", async () => {
    await expect(
      verifyGoogleOidcToken(
        signedToken({ email_verified: "true" }),
        {
          ...verificationOptions,
          serviceAccountEmail: PUSH_SERVICE_ACCOUNT.toUpperCase(),
        },
        NOW,
      ),
    ).resolves.toMatchObject({ email_verified: "true" });
  });

  it("rejects a valid Google token from another service account", async () => {
    await expect(
      verifyGoogleOidcToken(
        signedToken({ email: "another-push@tartly-test.iam.gserviceaccount.com" }),
        verificationOptions,
        NOW,
      ),
    ).rejects.toThrow("Unexpected OIDC push identity.");
  });

  it.each([false, "false", undefined])(
    "rejects an unverified email claim (%j)",
    async (email_verified) => {
      await expect(
        verifyGoogleOidcToken(
          signedToken({ email_verified }),
          verificationOptions,
          NOW,
        ),
      ).rejects.toThrow("OIDC push identity is not email-verified.");
    },
  );

  it("retains issuer, audience, and expiry validation before accepting the identity", async () => {
    await expect(
      verifyGoogleOidcToken(
        signedToken({ iss: "https://issuer.example" }),
        verificationOptions,
        NOW,
      ),
    ).rejects.toBeInstanceOf(PubSubAuthError);

    await expect(
      verifyGoogleOidcToken(
        signedToken({ aud: "https://other.example/webhook" }),
        verificationOptions,
        NOW,
      ),
    ).rejects.toBeInstanceOf(PubSubAuthError);

    await expect(
      verifyGoogleOidcToken(
        signedToken(),
        { ...verificationOptions, audience: "" },
        NOW,
      ),
    ).rejects.toThrow("OIDC audience mismatch.");

    await expect(
      verifyGoogleOidcToken(
        signedToken({ exp: Math.floor(NOW.getTime() / 1000) - 1 }),
        verificationOptions,
        NOW,
      ),
    ).rejects.toBeInstanceOf(PubSubAuthError);
  });
});
