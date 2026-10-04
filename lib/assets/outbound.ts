import "server-only";

import { ValidationError } from "@/lib/agent/errors";
import type { Attachment, InlineImage } from "@/lib/gmail/mime";
import { textToHtml } from "@/lib/gmail/mime";

import { assetSendable, isImageMime, readAssetBytes } from "./service";

/**
 * Resolve stored assets into the MIME structures `sendEmail` expects.
 *
 * Inline images become `multipart/related` parts referenced by `cid:` from an
 * HTML body; attachments become `multipart/mixed` parts. Bytes are copied into
 * the message at send time, so deleting an asset later never affects delivered
 * mail. Non-image ids requested as inline are downgraded to attachments.
 */
export type ResolvedOutboundAssets = {
  inlineImages: InlineImage[];
  attachments: Attachment[];
  /** `<img src="cid:…">` markup to append to the HTML body, or "". */
  htmlImages: string;
};

export function inlineCid(assetId: string): string {
  return `asset-${assetId}@lunabox`;
}

export async function resolveOutboundAssets({
  userId,
  inlineImageIds = [],
  attachmentIds = [],
}: {
  userId: string;
  inlineImageIds?: string[];
  attachmentIds?: string[];
}): Promise<ResolvedOutboundAssets> {
  const inlineImages: InlineImage[] = [];
  const attachments: Attachment[] = [];
  const htmlParts: string[] = [];

  for (const id of inlineImageIds.slice(0, 20)) {
    const resolved = await readAssetBytes({ userId, id });
    if (!resolved) continue;
    const { asset, body } = resolved;
    if (!assetSendable(asset)) {
      throw new ValidationError(
        `"${asset.filename}" was blocked by the security scan and cannot be sent.`,
      );
    }
    if (!isImageMime(asset.mimeType)) {
      attachments.push({ filename: asset.filename, mimeType: asset.mimeType, content: body });
      continue;
    }
    const cid = inlineCid(asset.id);
    inlineImages.push({
      cid,
      filename: asset.filename,
      mimeType: asset.mimeType,
      content: body,
    });
    const alt = asset.altText ? ` alt="${escapeAttr(asset.altText)}"` : ' alt=""';
    htmlParts.push(`<p><img src="cid:${cid}"${alt} /></p>`);
  }

  for (const id of attachmentIds.slice(0, 20)) {
    const resolved = await readAssetBytes({ userId, id });
    if (!resolved) continue;
    if (!assetSendable(resolved.asset)) {
      throw new ValidationError(
        `"${resolved.asset.filename}" was blocked by the security scan and cannot be sent.`,
      );
    }
    attachments.push({
      filename: resolved.asset.filename,
      mimeType: resolved.asset.mimeType,
      content: resolved.body,
    });
  }

  return { inlineImages, attachments, htmlImages: htmlParts.join("\n") };
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Build the HTML body for a text body plus inline images. */
export function buildHtmlWithImages(text: string, htmlImages: string): string | null {
  if (!htmlImages) return null;
  return `${textToHtml(text)}\n${htmlImages}`;
}
