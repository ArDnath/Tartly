import { z } from "zod";

import { apiError, ok, withUser } from "@/lib/api/http";
import {
  deleteAsset,
  getAsset,
  updateAssetAltText,
} from "@/lib/assets/service";

/** One asset's metadata; PATCH alt text; DELETE soft-removes it. */

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function serialize(asset: {
  id: string;
  kind: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  createdAt: Date;
}) {
  return {
    id: asset.id,
    kind: asset.kind,
    filename: asset.filename,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    altText: asset.altText,
    createdAt: asset.createdAt.toISOString(),
  };
}

export const GET = withUser<Ctx>(async (userId, _request, context) => {
  const { id } = await context.params;
  const asset = await getAsset({ userId, id });
  if (!asset) return apiError("not_found", "Asset not found", 404);
  return ok({ asset: serialize(asset) });
});

const patchSchema = z.object({ altText: z.string().max(500).nullable() });

export const PATCH = withUser<Ctx>(async (userId, request, context) => {
  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("bad_request", "Invalid request", 400);

  const asset = await updateAssetAltText({
    userId,
    id,
    altText: parsed.data.altText,
  });
  if (!asset) return apiError("not_found", "Asset not found", 404);
  return ok({ asset: serialize(asset) });
});

export const DELETE = withUser<Ctx>(async (userId, _request, context) => {
  const { id } = await context.params;
  const deleted = await deleteAsset({ userId, id });
  if (!deleted) return apiError("not_found", "Asset not found", 404);
  return ok({ deleted: true });
});
