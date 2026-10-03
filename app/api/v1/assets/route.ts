import { apiError, created, ok, withUser, type UserRouteHandler } from "@/lib/api/http";
import { assetFinalizeBody as finalizeSchema } from "@/lib/api/contracts/assets";
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
  const payload = {
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
  };
  // A re-upload of identical bytes dedupes to the existing row: that is a 200,
  // not a new creation. A fresh row is 201 + Location (SKILL §2.3).
  return result.deduped
    ? ok(payload)
    : created(payload, { location: `/api/v1/assets/${asset.id}` });
};

export const POST = withUser(
  {
    rateLimit: { limit: assetRateLimitPerMin(), scope: "assets" },
    maxBodyBytes: 64 * 1024,
  },
  handleFinalize,
);
