import type { NextRequest } from "next/server";

import { apiError } from "@/lib/api/http";
import { withMailUser } from "@/lib/mail/route";
import { getUnifiedAttachment } from "@/lib/mail/unified";

/**
 * Same-origin byte proxy for a message's inline images.
 *
 * The reader renders an email in a sandboxed frame; a `cid:` image has no URL a
 * browser can fetch, so `lib/mail/service.ts` and `lib/outlook/service.ts`
 * rewrite those references to this route. Serving the bytes ourselves keeps the
 * frame's CSP tight (`img-src 'self'`) and means the OAuth token never reaches
 * the page.
 *
 * Only raster/vector image types are ever echoed back. Anything else — an HTML
 * attachment trying to masquerade as an image, say — is served as
 * `application/octet-stream`, and every response is `nosniff` and carries an
 * inert CSP so even a directly-opened SVG cannot run script on our origin.
 */
const ALLOWED_IMAGE_TYPES = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/svg+xml",
  "image/vnd.microsoft.icon",
  "image/webp",
  "image/x-icon",
]);

function normalizeType(value: string | null): string {
  return (value ?? "").split(";")[0]!.trim().toLowerCase();
}

export const GET = withMailUser(
  // An image-heavy newsletter makes dozens of requests at once; the default API
  // ceiling would throttle rendering, so this scope gets a generous one.
  { rateLimit: { limit: 600, scope: "mail_asset" } },
  async (userId: string, request: NextRequest) => {
    const params = request.nextUrl.searchParams;
    const messageId = params.get("messageId");
    const attachmentId = params.get("attachmentId");
    if (!messageId || !attachmentId) {
      return apiError(
        "validation",
        "messageId and attachmentId are required.",
        400,
      );
    }

    const attachment = await getUnifiedAttachment(userId, messageId, attachmentId);

    const upstreamType = normalizeType(attachment.contentType ?? null);
    const requestedType = normalizeType(params.get("type"));
    const contentType = ALLOWED_IMAGE_TYPES.has(upstreamType)
      ? upstreamType
      : ALLOWED_IMAGE_TYPES.has(requestedType)
        ? requestedType
        : "application/octet-stream";

    return new Response(new Uint8Array(attachment.body), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(attachment.body.byteLength),
        // Same content for a given attachment id; let the browser reuse it.
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": "inline",
      },
    });
  },
);
