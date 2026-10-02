import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/lib/db";
import { assets, type AssetKind } from "@/lib/db/schema";
import {
  assetAllowedMime,
  assetMaxBytes,
  isAssetsEnabled,
} from "@/lib/env";

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
  | "invalid";

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
  | { ok: true; asset: AssetRecord; deduped: boolean }
  | { ok: false; error: AssetError };

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

  const sha = sha256Hex(bytes);
  const kind: AssetKind = isImageMime(mimeType) ? "image" : "file";
  const dimensions = kind === "image" ? imageDimensions(bytes, mimeType) : { width: null, height: null };

  const existing = await db
    .select()
    .from(assets)
    .where(and(eq(assets.userId, userId), eq(assets.sha256, sha)))
    .limit(1);
  if (existing[0] && !existing[0].deletedAt) {
    return { ok: true, asset: existing[0], deduped: true };
  }

  const storageKey = assetStorageKey(userId, bytes);
  await putAssetObject({ key: storageKey, body: bytes, contentType: mimeType });

  const row = {
    id: existing[0]?.id ?? nanoid(),
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
  };

  const inserted = await db
    .insert(assets)
    .values(row)
    .onConflictDoUpdate({
      target: [assets.userId, assets.sha256],
      set: {
        filename: row.filename,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        width: row.width,
        height: row.height,
        storageKey: row.storageKey,
        deletedAt: null,
        ...(altText !== undefined ? { altText: row.altText } : {}),
      },
    })
    .returning();

  return { ok: true, asset: inserted[0]!, deduped: false };
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

  const existing = await db
    .select()
    .from(assets)
    .where(and(eq(assets.userId, userId), eq(assets.sha256, digest)))
    .limit(1);
  if (existing[0] && !existing[0].deletedAt) {
    return { ok: true, asset: existing[0], deduped: true };
  }

  const row = {
    id: existing[0]?.id ?? nanoid(),
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
  };

  const inserted = await db
    .insert(assets)
    .values(row)
    .onConflictDoUpdate({
      target: [assets.userId, assets.sha256],
      set: {
        filename: row.filename,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        width: row.width,
        height: row.height,
        storageKey: row.storageKey,
        deletedAt: null,
        ...(altText !== undefined ? { altText: row.altText } : {}),
      },
    })
    .returning();

  return { ok: true, asset: inserted[0]!, deduped: false };
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
  const conditions = [eq(assets.userId, userId), isNull(assets.deletedAt)];
  if (kind) conditions.push(eq(assets.kind, kind));
  return db
    .select()
    .from(assets)
    .where(and(...conditions))
    .orderBy(desc(assets.createdAt))
    .limit(Math.min(limit, 200));
}

export async function getAsset({
  userId,
  id,
}: {
  userId: string;
  id: string;
}): Promise<AssetRecord | null> {
  const rows = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, id), eq(assets.userId, userId), isNull(assets.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
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
  const updated = await db
    .update(assets)
    .set({ altText: altText?.slice(0, 500) ?? null, updatedAt: new Date() })
    .where(and(eq(assets.id, id), eq(assets.userId, userId)))
    .returning();
  return updated[0] ?? null;
}

export async function deleteAsset({
  userId,
  id,
}: {
  userId: string;
  id: string;
}): Promise<boolean> {
  const updated = await db
    .update(assets)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(assets.id, id), eq(assets.userId, userId)))
    .returning({ id: assets.id });
  return updated.length > 0;
}

/** Hard-remove bytes for assets soft-deleted long ago (best-effort cleanup). */
export async function purgeAssetBytes({
  userId,
  id,
}: {
  userId: string;
  id: string;
}): Promise<boolean> {
  const rows = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, id), eq(assets.userId, userId)))
    .limit(1);
  const asset = rows[0];
  if (!asset) return false;
  await deleteAssetObject(asset.storageKey).catch(() => undefined);
  await db.delete(assets).where(eq(assets.id, asset.id));
  return true;
}
