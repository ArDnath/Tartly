#!/usr/bin/env node
/**
 * Verify the Cloudflare R2 wiring against the real buckets.
 *
 *   npm run verify:r2
 *
 * Reads the assets credentials from the root `.env` (S3_*) and, when the
 * backup rclone variables are present, the `tartly-backups` credentials too.
 * Prints status only — never a key or secret.
 *
 * Checks, per bucket: PUT -> HEAD -> GET (byte compare) -> DELETE.
 * For assets it additionally exercises the browser path: a CORS preflight from
 * the public origin and a presigned PUT signed the way lib/assets/storage.ts
 * signs it (content-length + content-type + host).
 */

import { createHash, createHmac, randomUUID } from "node:crypto";

const ENDPOINT = (process.env.S3_ENDPOINT ?? "").replace(/\/+$/, "");
const REGION = process.env.S3_REGION ?? "auto";
const ASSETS_BUCKET = process.env.S3_BUCKET ?? "tartly-assets";
const ASSETS_AK = process.env.S3_ACCESS_KEY_ID ?? "";
const ASSETS_SK = process.env.S3_SECRET_ACCESS_KEY ?? "";
const BACKUP_BUCKET = process.env.RCLONE_BUCKET ?? "tartly-backups";
const BACKUP_AK = process.env.RCLONE_CONFIG_R2_ACCESS_KEY_ID ?? "";
const BACKUP_SK = process.env.RCLONE_CONFIG_R2_SECRET_ACCESS_KEY ?? "";
const ORIGIN = process.env.VERIFY_ORIGIN ?? "https://tartly.in";

if (!ENDPOINT) {
  console.error("✖ S3_ENDPOINT is not set. Run with `npm run verify:r2` (loads .env).");
  process.exit(1);
}

const sha256Hex = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

function objectUrl(bucket, key) {
  const base = new URL(ENDPOINT);
  const path = key.split("/").map(encodeURIComponent).join("/");
  return {
    host: base.host,
    origin: base.origin,
    canonicalUri: `${base.pathname.replace(/\/$/, "")}/${bucket}/${path}`,
  };
}

/** SigV4 for a live request (PUT/HEAD/GET/DELETE). */
function signRequest({ method, bucket, key, ak, sk, body = Buffer.alloc(0), contentType }) {
  const { host, origin, canonicalUri } = objectUrl(bucket, key);
  const payloadHash = sha256Hex(body);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const scope = `${amzDate.slice(0, 8)}/${REGION}/s3/aws4_request`;

  const headers = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(Buffer.from(canonicalRequest)),
  ].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${sk}`, amzDate.slice(0, 8)), REGION), "s3"), "aws4_request");
  const signature = hmac(signingKey, stringToSign).toString("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `${origin}${canonicalUri}`,
    headers: { ...headers, authorization },
    ...(method === "PUT" ? { body } : {}),
  };
}

/** Presigned PUT mirroring lib/assets/storage.ts (content-length is signed). */
function presignPut({ bucket, key, ak, sk, contentType, contentLength, expiresSeconds = 300 }) {
  const { host, origin, canonicalUri } = objectUrl(bucket, key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const scope = `${amzDate.slice(0, 8)}/${REGION}/s3/aws4_request`;
  const signedHeaders = "content-length;content-type;host";
  const canonicalHeaders =
    `content-length:${contentLength}\n` + `content-type:${contentType}\n` + `host:${host}\n`;
  const query = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${ak}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresSeconds)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ]
    .map(([n, v]) => `${encodeURIComponent(n)}=${encodeURIComponent(v)}`)
    .join("&");
  const canonicalRequest = ["PUT", canonicalUri, query, canonicalHeaders, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(Buffer.from(canonicalRequest)),
  ].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${sk}`, amzDate.slice(0, 8)), REGION), "s3"), "aws4_request");
  const signature = hmac(signingKey, stringToSign).toString("hex");
  return `${origin}${canonicalUri}?${query}&X-Amz-Signature=${signature}`;
}

const failures = [];
function check(label, ok, detail = "") {
  console.log(`${ok ? "✓" : "✖"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

async function roundTrip(label, bucket, ak, sk) {
  const key = `assets/__verify__/r2-${randomUUID()}.txt`;
  const bytes = Buffer.from(`tartly r2 verify ${new Date().toISOString()}\n`);
  const base = { bucket, key, ak, sk };

  const putSigned = signRequest({ ...base, method: "PUT", body: bytes, contentType: "text/plain" });
  let res = await fetch(putSigned.url, { method: "PUT", headers: putSigned.headers, body: putSigned.body });
  check(`${label}: PUT`, res.ok, `HTTP ${res.status}`);

  const headSigned = signRequest({ ...base, method: "HEAD" });
  res = await fetch(headSigned.url, { method: "HEAD", headers: headSigned.headers });
  check(
    `${label}: HEAD`,
    res.ok && Number(res.headers.get("content-length")) === bytes.length,
    `HTTP ${res.status}, ${res.headers.get("content-length") ?? "?"} bytes`,
  );

  const getSigned = signRequest({ ...base, method: "GET" });
  res = await fetch(getSigned.url, { method: "GET", headers: getSigned.headers });
  const got = res.ok ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0);
  check(`${label}: GET`, res.ok && got.equals(bytes), `HTTP ${res.status}, bytes match=${got.equals(bytes)}`);

  const delSigned = signRequest({ ...base, method: "DELETE" });
  res = await fetch(delSigned.url, { method: "DELETE", headers: delSigned.headers });
  check(`${label}: DELETE`, res.ok, `HTTP ${res.status}`);
}

async function main() {
  if (!ASSETS_AK || !ASSETS_SK) {
    console.error("✖ S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are not set.");
    process.exit(1);
  }

  console.log(`endpoint  ${ENDPOINT} (region ${REGION})`);
  await roundTrip(`assets/${ASSETS_BUCKET}`, ASSETS_BUCKET, ASSETS_AK, ASSETS_SK);

  // Browser CORS preflight, exactly as fetch() sends it before an upload.
  const pre = await fetch(`${ENDPOINT}/${ASSETS_BUCKET}/assets/__verify__/cors.txt`, {
    method: "OPTIONS",
    headers: {
      Origin: ORIGIN,
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  check(
    "assets: CORS preflight",
    pre.ok && pre.headers.get("access-control-allow-origin") === ORIGIN,
    `HTTP ${pre.status}, allow-origin=${pre.headers.get("access-control-allow-origin") ?? "-"}`,
  );

  const body = Buffer.from("presigned put verify\n");
  const putUrl = presignPut({
    bucket: ASSETS_BUCKET,
    key: "assets/__verify__/presigned.txt",
    ak: ASSETS_AK,
    sk: ASSETS_SK,
    contentType: "text/plain",
    contentLength: body.length,
  });
  // `content-length` is set by fetch from the body; the URL signs that value,
  // which is what the browser does for a Blob upload.
  const put = await fetch(putUrl, { method: "PUT", headers: { "content-type": "text/plain" }, body });
  check("assets: presigned PUT", put.ok, `HTTP ${put.status}`);
  const cleanup = signRequest({
    method: "DELETE",
    bucket: ASSETS_BUCKET,
    key: "assets/__verify__/presigned.txt",
    ak: ASSETS_AK,
    sk: ASSETS_SK,
  });
  await fetch(cleanup.url, { method: "DELETE", headers: cleanup.headers });

  if (BACKUP_AK && BACKUP_SK) {
    await roundTrip(`backups/${BACKUP_BUCKET}`, BACKUP_BUCKET, BACKUP_AK, BACKUP_SK);
  } else {
    console.log("• backups: skipped (set RCLONE_CONFIG_R2_* to include the backup bucket)");
  }

  if (failures.length) {
    console.error(`\n✖ ${failures.length} R2 check(s) failed: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("\n✓ R2 wiring verified");
}

await main();
