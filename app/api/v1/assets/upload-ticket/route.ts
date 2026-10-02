import { z } from "zod";

import { apiError, ok, withUser } from "@/lib/api/http";
import { mimeAllowed } from "@/lib/assets/service";
import {
  assetStorageKeyForSha,
  isAssetStorageConfigured,
  presignAssetPutUrl,
} from "@/lib/assets/storage";
import {
  assetBlobAccess,
  assetMaxBytes,
  assetRateLimitPerMin,
  assetStorageDriver,
  isAssetsEnabled,
} from "@/lib/env";

/**
 * Upload ticket (Phase B). The browser asks where to put a file, streams the
 * bytes straight to storage, then calls `POST /api/v1/assets` to register it.
 * The function never buffers the file.
 *
 * The ticket is scoped to the session user: the key is content-addressed under
 * `assets/<userId>/<sha256>`, so one user can never write into another's prefix.
 */

export const runtime = "nodejs";

const ticketSchema = z.object({
  filename: z.string().min(1).max(240),
  mimeType: z.string().min(3).max(120),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
});

export const POST = withUser(
  {
    rateLimit: { limit: assetRateLimitPerMin(), scope: "assets" },
    maxBodyBytes: 16 * 1024,
  },
  async (userId, request) => {
    if (!isAssetsEnabled()) {
      return apiError("disabled", "Assets are disabled.", 403);
    }
    if (!isAssetStorageConfigured()) {
      return apiError(
        "storage_unconfigured",
        "Asset storage is not configured.",
        503,
      );
    }

    const parsed = ticketSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError("bad_request", "Invalid upload request.", 400);
    }

    const { mimeType, sizeBytes, sha256 } = parsed.data;
    if (!mimeAllowed(mimeType)) {
      return apiError("unsupported_type", "That file type isn't allowed.", 400);
    }
    if (sizeBytes > assetMaxBytes()) {
      return apiError("too_large", "That file is too large.", 413);
    }

    const key = assetStorageKeyForSha(userId, sha256.toLowerCase());

    if (assetStorageDriver() === "s3") {
      const signed = presignAssetPutUrl({
        key,
        contentType: mimeType,
        contentLength: sizeBytes,
      });
      return ok({
        mode: "put",
        key,
        url: signed.url,
        headers: signed.headers,
      });
    }

    return ok({
      mode: "blob",
      key,
      handleUploadUrl: "/api/v1/assets/upload",
      access: assetBlobAccess(),
    });
  },
);
