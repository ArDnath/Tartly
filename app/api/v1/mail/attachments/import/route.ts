import { apiError, created, ok } from "@/lib/api/http";
import { mailAttachmentImportBody as schema } from "@/lib/api/contracts/mail";
import { assetErrorResponse } from "@/lib/assets/http";
import { createAsset } from "@/lib/assets/service";
import { assetRateLimitPerMin, isAssetsEnabled } from "@/lib/env";
import { withMailUser } from "@/lib/mail/route";
import { getUnifiedAttachment } from "@/lib/mail/unified";

/**
 * Copy one received attachment into the owner's asset library.
 *
 * Forwarding should not require the user to download and re-upload a file.
 * The bytes are fetched through the same owner-scoped provider path the reader
 * uses, then flow through the normal asset pipeline (MIME allow-list, size
 * limit, malware scan, dedupe, extraction) before the composer sees an id.
 */
export const runtime = "nodejs";

// A large PDF may need a provider fetch plus a storage write.
export const maxDuration = 60;

function normalizeMime(value: string | undefined): string {
  return (value ?? "").split(";")[0]!.trim().toLowerCase();
}

export const POST = withMailUser(
  {
    rateLimit: { limit: assetRateLimitPerMin(), scope: "assets" },
    maxBodyBytes: 8 * 1024,
  },
  async (userId, request) => {
    if (!isAssetsEnabled()) {
      return assetErrorResponse("disabled");
    }

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError("bad_request", "Invalid attachment request.", 400);
    }

    const { messageId, attachmentId, filename, mimeType, sizeBytes } =
      parsed.data;

    const attachment = await getUnifiedAttachment(
      userId,
      messageId,
      attachmentId,
    );

    const resolvedMime = normalizeMime(
      attachment.contentType ?? mimeType,
    );
    if (!resolvedMime) {
      return apiError(
        "bad_request",
        "The attachment type is unknown. Attach it again from the message.",
        400,
      );
    }

    if (sizeBytes && attachment.body.length !== sizeBytes) {
      // The mailbox metadata is advisory; the bytes are authoritative. A
      // mismatch is not fatal (providers can report encoded sizes), but a large
      // drift usually means the wrong attachment id was supplied.
      console.warn("[mail/attachments/import] size mismatch", {
        attachmentId,
        expected: sizeBytes,
        actual: attachment.body.length,
      });
    }

    const result = await createAsset({
      userId,
      filename,
      mimeType: resolvedMime,
      bytes: attachment.body,
    });
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

    return result.deduped
      ? ok(payload)
      : created(payload, { location: `/api/v1/assets/${asset.id}` });
  },
);
