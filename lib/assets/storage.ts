import "server-only";

import { createHash, createHmac } from "node:crypto";

import { env, assetBlobAccess, assetStorageDriver } from "@/lib/env";

/**
 * Asset storage (Phase 6).
 *
 * A tiny driver interface with a **Vercel Blob** default and an S3/R2 adapter.
 * Keys are content-addressed under a per-user prefix (`assets/<userId>/<sha>`),
 * so identical uploads dedupe and one user can never guess another's key. The
 * bucket is never exposed to the browser: reads are proxied through an
 * authenticated route, and inline email bytes are fetched server-side.
 */

export type AssetObject = {
  body: Buffer;
  contentType: string | null;
};

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Content-addressed, per-user storage key from a known digest. */
export function assetStorageKeyForSha(userId: string, sha256: string): string {
  return `assets/${userId}/${sha256}`;
}

export function assetStorageKey(userId: string, bytes: Buffer): string {
  return assetStorageKeyForSha(userId, sha256Hex(bytes));
}

/** Whether the configured driver has credentials to run. */
export function isAssetStorageConfigured(): boolean {
  if (assetStorageDriver() === "s3") {
    return Boolean(
      env.S3_BUCKET &&
        env.S3_REGION &&
        env.S3_ACCESS_KEY_ID &&
        env.S3_SECRET_ACCESS_KEY,
    );
  }
  return Boolean(env.BLOB_READ_WRITE_TOKEN);
}

export async function putAssetObject({
  key,
  body,
  contentType,
}: {
  key: string;
  body: Buffer;
  contentType: string | null;
}): Promise<void> {
  if (assetStorageDriver() === "s3") {
    await s3Request({ method: "PUT", key, body, contentType });
    return;
  }

  const { put } = await import("@vercel/blob");
  await put(key, body, {
    access: assetBlobAccess(),
    token: env.BLOB_READ_WRITE_TOKEN,
    contentType: contentType ?? "application/octet-stream",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export async function getAssetObject(key: string): Promise<AssetObject | null> {
  if (assetStorageDriver() === "s3") {
    const response = await s3Request({ method: "GET", key });
    if (!response.ok) return null;
    return {
      body: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type"),
    };
  }

  const { get } = await import("@vercel/blob");
  const result = await get(key, {
    access: assetBlobAccess(),
    token: env.BLOB_READ_WRITE_TOKEN,
  });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return {
    body: Buffer.from(await new Response(result.stream).arrayBuffer()),
    contentType: result.blob.contentType,
  };
}

/**
 * Metadata-only probe used to register a client-direct upload without pulling
 * its bytes through the function. Returns `null` when the object is missing.
 */
export async function headAssetObject(
  key: string,
): Promise<{ size: number; contentType: string | null } | null> {
  if (assetStorageDriver() === "s3") {
    const response = await s3Request({ method: "HEAD", key });
    if (!response.ok) return null;
    const size = Number(response.headers.get("content-length") ?? "0");
    return { size, contentType: response.headers.get("content-type") };
  }

  const { head } = await import("@vercel/blob");
  try {
    const meta = await head(key, { token: env.BLOB_READ_WRITE_TOKEN });
    return { size: meta.size, contentType: meta.contentType };
  } catch {
    return null;
  }
}

export async function deleteAssetObject(key: string): Promise<void> {
  if (assetStorageDriver() === "s3") {
    await s3Request({ method: "DELETE", key });
    return;
  }
  const { del } = await import("@vercel/blob");
  await del(key, { token: env.BLOB_READ_WRITE_TOKEN });
}

/* -------------------------------------------------------------------------- */
/*  S3 / R2 adapter — SigV4, no SDK                                            */
/* -------------------------------------------------------------------------- */

function s3Endpoint(): { origin: string; host: string; pathPrefix: string } {
  if (env.S3_ENDPOINT) {
    const url = new URL(env.S3_ENDPOINT);
    return {
      origin: url.origin,
      host: url.host,
      pathPrefix: `${url.pathname.replace(/\/$/, "")}/${env.S3_BUCKET}`,
    };
  }
  const host = `s3.${env.S3_REGION}.amazonaws.com`;
  return { origin: `https://${host}`, host, pathPrefix: `/${env.S3_BUCKET}` };
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodeKeyPath(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/** Minimal SigV4 client for the object verbs we need. */
async function s3Request({
  method,
  key,
  body,
  contentType,
}: {
  method: "PUT" | "GET" | "HEAD" | "DELETE";
  key: string;
  body?: Buffer;
  contentType?: string | null;
}): Promise<Response> {
  const secret = env.S3_SECRET_ACCESS_KEY;
  const accessKey = env.S3_ACCESS_KEY_ID;
  const region = env.S3_REGION;
  if (!secret || !accessKey || !region || !env.S3_BUCKET) {
    throw new Error("S3 asset storage is not configured.");
  }

  const { origin, host, pathPrefix } = s3Endpoint();
  const canonicalUri = `${pathPrefix}/${encodeKeyPath(key)}`;
  const payloadHash = sha256Hex(body ?? Buffer.alloc(0));

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...(contentType ? { "content-type": contentType } : {}),
  };

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${headers[name]!.trim()}\n`)
    .join("");
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(Buffer.from(canonicalRequest)),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), "s3"),
    "aws4_request",
  );
  const signature = hmac(signingKey, stringToSign).toString("hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(`${origin}${canonicalUri}`, {
    method,
    headers: { ...headers, authorization },
    ...(method === "PUT" && body ? { body: new Uint8Array(body) } : {}),
  });
}

/**
 * Issue a SigV4 presigned `PUT` so the browser streams bytes straight to S3/R2.
 * `content-type` and `content-length` are part of the signature, so the bucket
 * rejects a mismatched type or an oversized body at the policy boundary — the
 * function never buffers the file. `UNSIGNED-PAYLOAD` is correct for presigned
 * PUTs, which are not hashed end-to-end.
 */
export function presignAssetPutUrl({
  key,
  contentType,
  contentLength,
  expiresSeconds = 900,
}: {
  key: string;
  contentType: string;
  contentLength: number;
  expiresSeconds?: number;
}): { url: string; headers: Record<string, string> } {
  const secret = env.S3_SECRET_ACCESS_KEY;
  const accessKey = env.S3_ACCESS_KEY_ID;
  const region = env.S3_REGION;
  if (!secret || !accessKey || !region || !env.S3_BUCKET) {
    throw new Error("S3 asset storage is not configured.");
  }

  const { origin, host, pathPrefix } = s3Endpoint();
  const canonicalUri = `${pathPrefix}/${encodeKeyPath(key)}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/s3/aws4_request`;

  const signedHeaders = "content-length;content-type;host";
  const canonicalHeaders =
    `content-length:${contentLength}\n` +
    `content-type:${contentType}\n` +
    `host:${host}\n`;

  const query = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${accessKey}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresSeconds)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ]
    .map(([name, value]) => `${encodeURIComponent(name!)}=${encodeURIComponent(value!)}`)
    .join("&");

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    query,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(Buffer.from(canonicalRequest)),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), "s3"),
    "aws4_request",
  );
  const signature = hmac(signingKey, stringToSign).toString("hex");

  return {
    url: `${origin}${canonicalUri}?${query}&X-Amz-Signature=${signature}`,
    headers: { "Content-Type": contentType },
  };
}
