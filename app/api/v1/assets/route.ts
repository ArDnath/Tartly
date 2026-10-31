import { apiError, created, ok, withUser, type UserRouteHandler } from "@/lib/api/http";
import { assetFinalizeBody as finalizeSchema } from "@/lib/api/contracts/assets";
import {
  ASSET_ERROR_MESSAGES,
  ASSET_ERROR_STATUS,
  assetErrorResponse,
} from "@/lib/assets/http";
import {
  listAssets,
  registerUploadedAsset,
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
    return apiError(
      "disabled",
      ASSET_ERROR_MESSAGES.disabled,
      ASSET_ERROR_STATUS.disabled,
    );
  }

  const parsed = finalizeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("bad_request", "Invalid asset metadata.", 400);
  }

  const { key: storageKey, ...rest } = parsed.data;
  const result = await registerUploadedAsset({ userId, storageKey, ...rest });
  if (!result.ok) return assetErrorResponse(result.error);

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
