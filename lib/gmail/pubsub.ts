import "server-only";

import { createPublicKey, createVerify, type JsonWebKey } from "node:crypto";

/**
 * Google Pub/Sub push authentication + payload decoding.
 *
 * The push endpoint is public, so it fails closed: an OIDC token is verified
 * against Google's JWKS, with issuer/audience/expiry checks plus an exact,
 * verified push-service-account identity, before the payload is trusted.
 * Implemented with Node's crypto (RS256) so no extra dependency is needed.
 */

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const JWKS_TTL_MS = 60 * 60 * 1000;
/** Bound the JWKS fetch: the webhook must fail closed, not hang. */
const JWKS_TIMEOUT_MS = 10_000;

type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string };
type JwksCache = { keys: Jwk[]; fetchedAt: number };
/** Header of a Google RS256 JWT: must pin the algorithm and key id. */
type GoogleOidcHeader = { alg?: string; kid?: string };

let jwksCache: JwksCache | null = null;

export class PubSubAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PubSubAuthError";
  }
}

async function loadJwks(forceRefresh = false): Promise<Jwk[]> {
  if (
    !forceRefresh &&
    jwksCache &&
    Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS
  ) {
    return jwksCache.keys;
  }

  const response = await fetch(GOOGLE_JWKS_URL, {
    signal: AbortSignal.timeout(JWKS_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new PubSubAuthError(`Failed to fetch Google JWKS (${response.status}).`);
  }
  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  jwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

function decodeSegment(segment: string): Buffer {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function parseJsonSegment<T>(segment: string): T {
  return JSON.parse(decodeSegment(segment).toString("utf8")) as T;
}

export type PubSubClaims = {
  iss?: string;
  aud?: string;
  exp?: number;
  email?: string;
  /** Google emits this as a boolean in ID tokens and as a string in tokeninfo. */
  email_verified?: boolean | string;
  sub?: string;
};

export type GoogleOidcVerificationOptions = {
  audience: string;
  /** The exact service account configured on the Pub/Sub push subscription. */
  serviceAccountEmail: string;
};

/**
 * Verifies the OIDC token and returns its claims. Throws {@link PubSubAuthError}
 * when the token is malformed, expired, has the wrong audience/issuer or
 * push identity, lacks a verified email claim, or is not signed by a Google
 * key.
 */
export async function verifyGoogleOidcToken(
  token: string,
  { audience, serviceAccountEmail }: GoogleOidcVerificationOptions,
  now = new Date(),
): Promise<PubSubClaims> {
  const segments = token.split(".");
  if (segments.length !== 3) {
    throw new PubSubAuthError("Malformed OIDC token.");
  }
  const [headerSegment, payloadSegment, signatureSegment] = segments;

  const header = parseJsonSegment<GoogleOidcHeader>(headerSegment);
  if (header.alg !== "RS256" || !header.kid) {
    throw new PubSubAuthError("Unsupported OIDC token header.");
  }

  const claims = parseJsonSegment<PubSubClaims>(payloadSegment);

  if (!claims.iss || !GOOGLE_ISSUERS.has(claims.iss)) {
    throw new PubSubAuthError("Unexpected OIDC issuer.");
  }
  if (claims.aud !== audience) {
    throw new PubSubAuthError("OIDC audience mismatch.");
  }
  if (!claims.exp || claims.exp * 1000 <= now.getTime()) {
    throw new PubSubAuthError("OIDC token is expired.");
  }

  const signatureValid = (candidateKeys: Jwk[]) =>
    verifyGoogleSignature(header, headerSegment, payloadSegment, signatureSegment, candidateKeys);

  let keys = await loadJwks();
  if (!signatureValid(keys)) {
    // The signing key may have rotated; refresh once before rejecting.
    keys = await loadJwks(true);
    if (!signatureValid(keys)) {
      throw new PubSubAuthError("OIDC signature verification failed.");
    }
  }

  // Google verifies the signer, issuer, audience and expiry, but Pub/Sub's
  // own guidance requires the receiver to also pin the service account chosen
  // on the push subscription and to require a verified email claim. Without
  // this, another Google-signed identity with the same audience could invoke
  // the public webhook.
  if (!hasVerifiedEmail(claims.email_verified)) {
    throw new PubSubAuthError("OIDC push identity is not email-verified.");
  }
  if (!sameEmail(claims.email, serviceAccountEmail)) {
    throw new PubSubAuthError("Unexpected OIDC push identity.");
  }

  return claims;
}

function hasVerifiedEmail(value: PubSubClaims["email_verified"]): boolean {
  // `tokeninfo` renders this claim as the string "true", while an ID-token
  // payload normally carries a boolean. Both mean the same signed assertion.
  return value === true || value === "true";
}

function sameEmail(actual: string | undefined, expected: string): boolean {
  return (
    actual !== undefined &&
    actual.trim().toLowerCase() === expected.trim().toLowerCase()
  );
}

/**
 * Verifies the signature over `headerSegment.payloadSegment` with the key
 * whose `kid` matches the header. Returns false when the key is unknown or the
 * signature does not verify.
 */
function verifyGoogleSignature(
  header: GoogleOidcHeader,
  headerSegment: string,
  payloadSegment: string,
  signatureSegment: string,
  keys: Jwk[],
): boolean {
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) return false;
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerSegment}.${payloadSegment}`);
  verifier.end();
  return verifier.verify(publicKey, decodeSegment(signatureSegment));
}

export type GmailPushPayload = {
  emailAddress: string;
  historyId: string;
};

/** Decodes the Pub/Sub `message.data` envelope into the Gmail notification. */
export function decodeGmailPushData(data: string): GmailPushPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeSegment(data).toString("utf8"));
  } catch {
    throw new PubSubAuthError("Pub/Sub payload is not valid base64 JSON.");
  }

  const payload = parsed as Partial<GmailPushPayload>;
  if (!payload.emailAddress || !payload.historyId) {
    throw new PubSubAuthError("Pub/Sub payload is missing emailAddress/historyId.");
  }

  return {
    emailAddress: payload.emailAddress,
    historyId: String(payload.historyId),
  };
}
