import { z } from "zod";

import { apiError, ok, withUser, type UserRouteHandler } from "@/lib/api/http";
import {
  listAssets,
  registerUploadedAsset,
  type AssetError,
} from "@/lib/assets/service";
import { assetRateLimitPerMin, isAssetsEnabled } from "@/lib/env";
import type { AssetKind } from "@/lib/db/schema";

/**
 * Asset library (Phase 6).
 *
 * `POST` registers a file the browser uploaded **directly** to storage (see
 * `/api/v1/assets/upload-ticket`); `GET` lists. Bytes never transit the
 * function, storage is probed for the authoritative size/type, and identical
 * content dedupes on the per-user content hash.
 */

const ERROR_MESSAGES: Record<AssetError, string> = {
  disabled: "Assets are disabled.",
  storage_unconfigured: "Asset storage is not configured.",
  too_large: "That file is too large.",
  unsupported_type: "That file type isn't allowed.",
  empty: "The file is empty.",
  invalid: "That upload could not be verified.",
};

const ERROR_STATUS: Record<AssetError, number> = {
  disabled: 403,
  storage_unconfigured: 503,
  too_large: 413,
  unsupported_type: 400,
  empty: 400,
  invalid: 400,
};

export const runtime = "nodejs";

export const GET = withUser(async (userId, request) => {
  const kindParam = request.nextUrl.searchParams.get("kind");
  const kind: AssetKind | undefined =
    kindParam === "image" || kindParam === "file" ? kindParam : undefined;
  const assets = await listAssets({ userId, ...(kind ? { kind } : {}) });
  return ok({
    assets: assets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      filename: asset.filename,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      altText: asset.altText,
      createdAt: asset.createdAt.toISOString(),
    })),
    enabled: isAssetsEnabled(),
  });
});

const finalizeSchema = z.object({
  key: z.string().min(1).max(1024),
  filename: z.string().min(1).max(240),
  mimeType: z.string().min(3).max(120),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  altText: z.string().max(500).nullable().optional(),
  width: z.number().int().min(0).max(100_000).nullable().optional(),
  height: z.number().int().min(0).max(100_000).nullable().optional(),
});

const handleFinalize: UserRouteHandler = async (userId, request) => {
  if (!isAssetsEnabled()) {
    return apiError("disabled", ERROR_MESSAGES.disabled, ERROR_STATUS.disabled);
  }

  const parsed = finalizeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("bad_request", "Invalid asset metadata.", 400);
  }

  const { key: storageKey, ...rest } = parsed.data;
  const result = await registerUploadedAsset({ userId, storageKey, ...rest });
  if (!result.ok) {
    return apiError(
      result.error,
      ERROR_MESSAGES[result.error],
      ERROR_STATUS[result.error],
    );
  }

  const asset = result.asset;
  return ok({
    deduped: result.deduped,
    asset: {
      id: asset.id,
      kind: asset.kind,
      filename: asset.filename,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      altText: asset.altText,
      createdAt: asset.createdAt.toISOString(),
    },
  });
};

export const POST = withUser(
  {
    rateLimit: { limit: assetRateLimitPerMin(), scope: "assets" },
    maxBodyBytes: 64 * 1024,
  },
  handleFinalize,
);
