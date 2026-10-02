import { z } from "zod";

import { defineTool, type AnyToolDefinition } from "@/lib/agent/registry";
import { listAssets } from "@/lib/assets/service";

import { requireReadPermission } from "./shared";

/**
 * `list_assets` — READ.
 *
 * The user's asset library (images and files). Use it before sending to find an
 * id to attach or inline. Never returns bytes, only metadata.
 */

const inputSchema = z.object({
  kind: z
    .enum(["image", "file"])
    .optional()
    .describe("Filter to images or files; omit for everything."),
});

export type ListAssetsInput = z.infer<typeof inputSchema>;

export const listAssetsTool: AnyToolDefinition = defineTool({
  name: "list_assets",
  description:
    "List the user's saved images and files (the asset library). Returns ids you can pass to send_email as assetIds (attachments) or inlineImageIds (inline images). Metadata only; never returns file bytes.",
  risk: "READ",
  inputSchema,
  authorize(ctx) {
    requireReadPermission(ctx);
  },
  async execute(ctx, input) {
    const assets = await listAssets({
      userId: ctx.userId,
      ...(input.kind ? { kind: input.kind } : {}),
    });
    return {
      count: assets.length,
      assets: assets.map((asset) => ({
        id: asset.id,
        filename: asset.filename,
        kind: asset.kind,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        width: asset.width,
        height: asset.height,
        altText: asset.altText,
      })),
      notice:
        "Pass an id to send_email: assetIds attaches a file, inlineImageIds renders an image in the body.",
    };
  },
});
