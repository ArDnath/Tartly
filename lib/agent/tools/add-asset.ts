import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import { AuthorizationError } from "@/lib/agent/errors";
import { createAsset } from "@/lib/assets/service";
import { isAssetsEnabled } from "@/lib/env";

import { requireWritePermission } from "./shared";

/**
 * `add_asset` — WRITE.
 *
 * Saves a small image/file into the user's library from base64 content. Bounded
 * so the model can never upload something huge; the service re-validates MIME
 * and size. Saving is reversible (the asset can be deleted in Settings).
 */

const MAX_BASE64_CHARS = 4_000_000; // ~3 MB of binary

const inputSchema = z.object({
  filename: z.string().min(1).max(240).describe("A display filename, e.g. logo.png."),
  mimeType: z
    .string()
    .min(3)
    .max(120)
    .describe("The file's MIME type, e.g. image/png or application/pdf."),
  dataBase64: z
    .string()
    .min(4)
    .max(MAX_BASE64_CHARS)
    .describe("The file's bytes, base64-encoded."),
  altText: z
    .string()
    .max(500)
    .optional()
    .describe("Optional alt text for images."),
});

export type AddAssetInput = z.infer<typeof inputSchema>;

export const addAssetTool: AnyToolDefinition = defineTool({
  name: "add_asset",
  description:
    "Save a small image or file into the user's asset library so it can be reused in emails. Provide base64 bytes. Only use this when the user asks you to save/upload something; do not fetch arbitrary files from the web.",
  risk: "WRITE",
  inputSchema,
  authorize(ctx) {
    requireWritePermission(ctx);
    if (!isAssetsEnabled()) {
      throw new AuthorizationError("The asset library is disabled.");
    }
  },
  async execute(ctx, input) {
    let bytes: Buffer;
    try {
      bytes = Buffer.from(input.dataBase64, "base64");
    } catch {
      return { saved: false, notice: "The provided data was not valid base64." };
    }

    const result = await createAsset({
      userId: ctx.userId,
      filename: input.filename,
      mimeType: input.mimeType,
      bytes,
      altText: input.altText ?? null,
    });

    if (!result.ok) {
      return { saved: false, notice: `Could not save the asset (${result.error}).` };
    }

    return {
      saved: true,
      deduped: result.deduped,
      assetId: result.asset.id,
      filename: result.asset.filename,
      notice: "Saved to the asset library. Use its id with send_email.",
    };
  },
});
