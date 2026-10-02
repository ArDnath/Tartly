import { z } from "zod";
import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

import { apiError, withUser } from "@/lib/api/http";
import { AuthorizationError, ValidationError } from "@/lib/agent/errors";
import { assetStorageKeyForSha } from "@/lib/assets/storage";
import { mimeAllowed } from "@/lib/assets/service";
import {
  assetAllowedMime,
  assetMaxBytes,
  assetRateLimitPerMin,
  assetStorageDriver,
  env,
  isAssetsEnabled,
} from "@/lib/env";

/**
 * Vercel Blob client-upload token endpoint (Phase B). The browser's
 * `upload()` call fetches a short-lived token here, then streams bytes straight
 * to Blob. We validate the pathname (content-addressed, under the user's prefix)
 * and the declared MIME/size before minting the token.
 *
 * The actual row is written by `POST /api/v1/assets` after the upload resolves,
 * so a token is never enough on its own to publish an asset.
 */

export const runtime = "nodejs";

const clientPayloadSchema = z.object({
  filename: z.string().min(1).max(240),
  mimeType: z.string().min(3).max(120),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
});

export const POST = withUser(
  {
    rateLimit: { limit: assetRateLimitPerMin(), scope: "assets" },
    maxBodyBytes: 64 * 1024,
  },
  async (userId, request) => {
    if (!isAssetsEnabled()) {
      return apiError("disabled", "Assets are disabled.", 403);
    }
    if (assetStorageDriver() !== "vercel-blob") {
      return apiError(
        "unsupported",
        "Client uploads are only available for the Vercel Blob driver.",
        400,
      );
    }

    const body = (await request.json().catch(() => null)) as HandleUploadBody | null;
    if (!body) return apiError("bad_request", "Invalid upload request.", 400);

    const result = await handleUpload({
      token: env.BLOB_READ_WRITE_TOKEN,
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let payload: z.infer<typeof clientPayloadSchema>;
        try {
          payload = clientPayloadSchema.parse(JSON.parse(clientPayload ?? "null"));
        } catch {
          throw new ValidationError("Invalid upload metadata.");
        }

        if (pathname !== assetStorageKeyForSha(userId, payload.sha256.toLowerCase())) {
          throw new AuthorizationError("That upload path is not yours.");
        }
        if (!mimeAllowed(payload.mimeType)) {
          throw new ValidationError("That file type isn't allowed.");
        }
        if (payload.sizeBytes > assetMaxBytes()) {
          throw new ValidationError("That file is too large.");
        }

        return {
          allowedContentTypes: assetAllowedMime(),
          maximumSizeInBytes: assetMaxBytes(),
          addRandomSuffix: false,
          allowOverwrite: true,
          tokenPayload: clientPayload,
        };
      },
    });

    return NextResponse.json(result);
  },
);
