import { apiError, withUser } from "@/lib/api/http";
import { readAssetBytes } from "@/lib/assets/service";
import { isAssetsEnabled } from "@/lib/env";

/**
 * Authenticated byte proxy (Phase 6). The bucket is never exposed to the
 * browser; images render from here (`/api/v1/assets/<id>/raw`) under the user's
 * session, and only the owner can read.
 */

export const runtime = "nodejs";

export const GET = withUser<{ params: Promise<{ id: string }> }>(
  async (userId, _request, context) => {
    if (!isAssetsEnabled()) return apiError("disabled", "Assets are disabled.", 403);
    const { id } = await context.params;
    const resolved = await readAssetBytes({ userId, id });
    if (!resolved) return apiError("not_found", "Asset not found", 404);

    const { asset, body } = resolved;
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": asset.mimeType,
        "Content-Length": String(body.length),
        // Private + immutable-ish: bytes are content-addressed.
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="${asset.filename.replace(/"/g, "'")}"`,
      },
    });
  },
);
