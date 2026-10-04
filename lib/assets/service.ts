import "server-only";

import { nanoid } from "nanoid";

import { assets, type AssetKind } from "@/lib/db/schema";
import { assetRepository } from "@/lib/repositories/assets";
import {
  assetAllowedMime,
  assetMaxBytes,
  assetScanMode,
  isAssetExtractionEnabled,
  isAssetsEnabled,
} from "@/lib/env";

import { extractAndStoreAsset } from "./pipeline";
import {
  scanAsset,
  scanBlocked,
  type ScanResult,
} from "./scan";
import {
  assetStorageKey,
  assetStorageKeyForSha,
  deleteAssetObject,
  getAssetObject,
  headAssetObject,
  isAssetStorageConfigured,
  putAssetObject,
  sha256Hex,
} from "./storage";

/**
 * Asset library service (Phase 6).
 *
 * Validates and stores a user's images/files, content-addressed so identical
 * uploads dedupe. Every read is scoped `(userId, id)`. Deletes are soft — the
 * bytes stay so a resend of the same file is free, and delivered mail is
 * unaffected in any case.
 */

export type AssetRecord = typeof assets.$inferSelect;

export type AssetError =
  | "disabled"
  | "storage_unconfigured"
  | "too_large"
  | "unsupported_type"
  | "empty"
  | "invalid"
  /** A malware scan failed or found a threat under `enforce` mode. */
  | "infected";

export function mimeAllowed(mimeType: string): boolean {
  const mime = mimeType.toLowerCase();
  return assetAllowedMime().some((pattern) =>
    pattern.endsWith("/*") ? mime.startsWith(pattern.slice(0, -1)) : mime === pattern,
  );
}

export function isImageMime(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("image/");
}

/**
 * Whether an asset may be attached to an outgoing message. Under `enforce` scan
 * mode only a `clean` verdict is sendable; `off`/`warn` never block sending.
 * This is the second half of the scan gate: uploads that slipped through before
 * enforcement (or `warn` mode) cannot be mailed out while enforcement is on.
 */
export function assetSendable(asset: Pick<AssetRecord, "scanStatus">): boolean {
  if (assetScanMode() !== "enforce") return true;
  return asset.scanStatus === "clean";
}

/**
 * Best-effort intrinsic dimensions from the file header (PNG/JPEG/GIF). Returns
 * nulls rather than guessing; unknown formats stay null.
 */
export function imageDimensions(
  bytes: Buffer,
  mimeType: string,
): { width: number | null; height: number | null } {
  const mime = mimeType.toLowerCase();
  try {
    if (mime === "image/png" && bytes.length >= 24) {
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (mime === "image/gif" && bytes.length >= 10) {
      return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
    }
    if (mime === "image/jpeg") {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = bytes[offset + 1]!;
        const length = bytes.readUInt16BE(offset + 2);
        // SOF0..SOF15, excluding DHT/DAC/RST.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8) {
          return {
            height: bytes.readUInt16BE(offset + 5),
            width: bytes.readUInt16BE(offset + 7),
          };
        }
        offset += 2 + length;
      }
    }
  } catch {
    // fall through to nulls
  }
  return { width: null, height: null };
}

export type CreateAssetResult =
  | { ok: true; asset: AssetRecord; deduped: boolean; scan: ScanResult }
  | { ok: false; error: AssetError; scan?: ScanResult };

/** Terminal scan columns for an asset row, derived from a {@link ScanResult}. */
function scanColumns(scan: ScanResult): {
  scanStatus: AssetRecord["scanStatus"];
  scanSignature: string | null;
  scannedAt: Date;
} {
  return {
    scanStatus: scan.verdict === "skipped" ? "skipped" : scan.verdict,
    scanSignature: scan.signature,
    scannedAt: new Date(),
  };
}

/** Validate, dedupe and store a new asset. */
export async function createAsset({
  userId,
  filename,
  mimeType,
  bytes,
  altText,
}: {
  userId: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  altText?: string | null;
}): Promise<CreateAssetResult> {
  if (!isAssetsEnabled()) return { ok: false, error: "disabled" };
  // Validate input before touching storage, so bad requests never reach the bucket.
  if (bytes.length === 0) return { ok: false, error: "empty" };
  if (bytes.length > assetMaxBytes()) return { ok: false, error: "too_large" };
  if (!mimeAllowed(mimeType)) return { ok: false, error: "unsupported_type" };
  if (!isAssetStorageConfigured()) return { ok: false, error: "storage_unconfigured" };

  // Malware scan runs before anything is written. In `enforce` mode a threat
  // (or an unscannable file) is rejected outright, so infected bytes never land
  // in the bucket.
  const scan = await scanAsset({ bytes, filename, mimeType });
  if (scanBlocked(scan)) return { ok: false, error: "infected", scan };
  const scanFields = scanColumns(scan);

  const sha = sha256Hex(bytes);
  const kind: AssetKind = isImageMime(mimeType) ? "image" : "file";
  const dimensions = kind === "image" ? imageDimensions(bytes, mimeType) : { width: null, height: null };

  const existing = await assetRepository.findByUserAndSha(userId, sha);
  if (existing && !existing.deletedAt) {
    // Dedupe to the existing row, but refresh its scan verdict (a file uploaded
    // while scanning was off should not stay "skipped" forever).
    const refreshed = await assetRepository.upsert({
      row: { ...existing, ...scanFields },
      altTextProvided: false,
    });
    return { ok: true, asset: refreshed, deduped: true, scan };
  }

  const storageKey = assetStorageKey(userId, bytes);
  await putAssetObject({ key: storageKey, body: bytes, contentType: mimeType });

  const row = {
    id: existing?.id ?? nanoid(),
    userId,
    kind,
    filename: filename.slice(0, 240) || "file",
    mimeType,
    sizeBytes: bytes.length,
    width: dimensions.width,
    height: dimensions.height,
    storageKey,
    sha256: sha,
    altText: altText?.slice(0, 500) ?? null,
    deletedAt: null,
    ...scanFields,
  };

  const asset = await assetRepository.upsert({
    row,
    altTextProvided: altText !== undefined,
  });

  // Best-effort encrypted text extraction; never fails the upload.
  await extractAndStoreAsset({
    userId,
    assetId: asset.id,
    bytes,
    mimeType,
  }).catch(() => undefined);

  return { ok: true, asset, deduped: false, scan };
}

/** Clamp a client-reported image dimension; `null` when implausible. */
function clampDimension(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.trunc(value);
  return rounded > 0 && rounded <= 100_000 ? rounded : null;
}

/**
 * Register an asset whose bytes the browser sent **directly** to storage. The
 * object already exists at `storageKey`; we only probe its metadata (never
 * download it), reject a size/type that violates policy, then upsert the row.
 * Content-addressing keeps the key tied to the client-computed digest, so a
 * mismatched `sha256`/`key` pair is rejected.
 */
export async function registerUploadedAsset({
  userId,
  storageKey,
  filename,
  mimeType,
  sizeBytes,
  sha256,
  altText,
  width,
  height,
}: {
  userId: string;
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  altText?: string | null;
  width?: number | null;
  height?: number | null;
}): Promise<CreateAssetResult> {
  if (!isAssetsEnabled()) return { ok: false, error: "disabled" };
  if (!isAssetStorageConfigured()) return { ok: false, error: "storage_unconfigured" };

  const digest = sha256.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) return { ok: false, error: "invalid" };
  if (storageKey !== assetStorageKeyForSha(userId, digest)) {
    return { ok: false, error: "invalid" };
  }
  if (!mimeAllowed(mimeType)) return { ok: false, error: "unsupported_type" };

  const head = await headAssetObject(storageKey);
  if (!head) return { ok: false, error: "invalid" };
  if (head.size <= 0) return { ok: false, error: "empty" };
  if (head.size > assetMaxBytes()) return { ok: false, error: "too_large" };
  if (sizeBytes !== head.size) return { ok: false, error: "invalid" };

  const effectiveMime =
    head.contentType && mimeAllowed(head.contentType) ? head.contentType : mimeType;
  if (!mimeAllowed(effectiveMime)) return { ok: false, error: "unsupported_type" };

  const kind: AssetKind = isImageMime(effectiveMime) ? "image" : "file";
  const dimensions =
    kind === "image"
      ? { width: clampDimension(width), height: clampDimension(height) }
      : { width: null, height: null };

  // Scanning (and extraction) require the bytes, which a direct upload otherwise
  // never pulls through the function. Only pay that cost when it is needed.
  const mode = assetScanMode();
  const needsBytes = mode !== "off" || isAssetExtractionEnabled();
  let scannedBytes: Buffer | null = null;
  let scan: ScanResult = {
    verdict: "skipped",
    signature: null,
    scanner: "none",
    detail: null,
  };

  if (needsBytes) {
    const object = await getAssetObject(storageKey);
    if (!object) return { ok: false, error: "invalid" };
    if (object.body.length !== head.size) return { ok: false, error: "invalid" };
    scannedBytes = object.body;
    scan = await scanAsset({
      bytes: scannedBytes,
      filename,
      mimeType: effectiveMime,
      mode,
    });
    if (scanBlocked(scan, mode)) {
      // Never leave an infected object in the bucket.
      await deleteAssetObject(storageKey).catch(() => undefined);
      return { ok: false, error: "infected", scan };
    }
  }
  const scanFields = scanColumns(scan);

  const existing = await assetRepository.findByUserAndSha(userId, digest);
  if (existing && !existing.deletedAt) {
    const refreshed = await assetRepository.upsert({
      row: { ...existing, ...scanFields },
      altTextProvided: false,
    });
    return { ok: true, asset: refreshed, deduped: true, scan };
  }

  const row = {
    id: existing?.id ?? nanoid(),
    userId,
    kind,
    filename: filename.slice(0, 240) || "file",
    mimeType: effectiveMime,
    sizeBytes: head.size,
    width: dimensions.width,
    height: dimensions.height,
    storageKey,
    sha256: digest,
    altText: altText?.slice(0, 500) ?? null,
    deletedAt: null,
    ...scanFields,
  };

  const asset = await assetRepository.upsert({
    row,
    altTextProvided: altText !== undefined,
  });

  if (scannedBytes) {
    await extractAndStoreAsset({
      userId,
      assetId: asset.id,
      bytes: scannedBytes,
      mimeType: effectiveMime,
    }).catch(() => undefined);
  }

  return { ok: true, asset, deduped: false, scan };
}

export async function listAssets({
  userId,
  kind,
  limit = 100,
}: {
  userId: string;
  kind?: AssetKind;
  limit?: number;
}): Promise<AssetRecord[]> {
  return assetRepository.listActive({
    userId,
    kind,
    limit: Math.min(limit, 200),
  });
}

export async function getAsset({
  userId,
  id,
}: {
  userId: string;
  id: string;
}): Promise<AssetRecord | null> {
  return (await assetRepository.findActiveByIdForUser(userId, id)) ?? null;
}

/** Read bytes by id, scoped to the owner. Used by the proxy route and MIME. */
export async function readAssetBytes({
  userId,
  id,
}: {
  userId: string;
  id: string;
}): Promise<{ asset: AssetRecord; body: Buffer } | null> {
  const asset = await getAsset({ userId, id });
  if (!asset) return null;
  const object = await getAssetObject(asset.storageKey);
  if (!object) return null;
  return { asset, body: object.body };
}

export async function updateAssetAltText({
  userId,
  id,
  altText,
}: {
  userId: string;
  id: string;
  altText: string | null;
}): Promise<AssetRecord | null> {
  return assetRepository.updateAltText({
    userId,
    id,
    altText: altText?.slice(0, 500) ?? null,
    now: new Date(),
  });
}

export async function deleteAsset({
  userId,
  id,
}: {
  userId: string;
  id: string;
}): Promise<boolean> {
  const now = new Date();
  return assetRepository.softDelete({ userId, id, now });
}

/** Hard-remove bytes for assets soft-deleted long ago (best-effort cleanup). */
export async function purgeAssetBytes({
  userId,
  id,
}: {
  userId: string;
  id: string;
}): Promise<boolean> {
  const asset = await assetRepository.findByIdForUser(userId, id);
  if (!asset) return false;
  await deleteAssetObject(asset.storageKey).catch(() => undefined);
  await assetRepository.hardDelete(asset.id);
  return true;
}
