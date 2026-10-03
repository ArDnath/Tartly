import { z } from "zod";

import { defineOperation } from "./registry";
import {
  dataEnvelope,
  noContentResponse,
  okResponse,
  streamResponse,
} from "./shared";

/**
 * Asset library: client-direct uploads, registration, metadata and the
 * authenticated byte proxy (Phase C1).
 */

const sha256 = z.string().regex(/^[a-f0-9]{64}$/i);

export const uploadTicketBody = z.object({
  filename: z.string().min(1).max(240),
  mimeType: z.string().min(3).max(120),
  sizeBytes: z.number().int().positive(),
  sha256,
});

export const assetFinalizeBody = z.object({
  key: z.string().min(1).max(1024),
  filename: z.string().min(1).max(240),
  mimeType: z.string().min(3).max(120),
  sizeBytes: z.number().int().positive(),
  sha256,
  altText: z.string().max(500).nullable().optional(),
  width: z.number().int().min(0).max(100_000).nullable().optional(),
  height: z.number().int().min(0).max(100_000).nullable().optional(),
});

export const assetPatchBody = z.object({
  altText: z.string().max(500).nullable(),
});

export const assetQuery = z
  .object({ kind: z.enum(["image", "file"]).optional() })
  .passthrough();

/** Vercel Blob `handleUpload` protocol body (mint/complete phases). */
export const blobUploadBody = z
  .object({
    type: z.string(),
    payload: z.string().optional(),
    clientPayload: z.string().optional(),
  })
  .passthrough();

const assetEnvelope = dataEnvelope(z.object({ asset: z.unknown() }));
const ticketSchema = z
  .object({
    mode: z.enum(["put", "blob"]),
    key: z.string(),
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    handleUploadUrl: z.string().optional(),
    access: z.string().optional(),
  })
  .passthrough();

export const assetOperations = [
  defineOperation({
    method: "GET",
    path: "/api/v1/assets",
    operationId: "listAssets",
    tags: ["assets"],
    summary: "List the user's assets",
    security: "session",
    query: assetQuery,
    responses: okResponse(
      dataEnvelope(
        z.object({ assets: z.array(z.unknown()), enabled: z.boolean() }),
      ),
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/assets",
    operationId: "registerAsset",
    tags: ["assets"],
    summary: "Register a directly-uploaded asset (metadata only)",
    security: "session",
    body: assetFinalizeBody,
    responses: {
      200: {
        description: "Identical bytes already registered (deduped).",
        schema: dataEnvelope(
          z.object({ deduped: z.boolean(), asset: z.unknown() }),
        ),
      },
      201: {
        description: "New asset registered.",
        schema: dataEnvelope(
          z.object({ deduped: z.boolean(), asset: z.unknown() }),
        ),
      },
    },
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/assets/{id}",
    operationId: "getAsset",
    tags: ["assets"],
    summary: "Get asset metadata",
    security: "session",
    responses: okResponse(assetEnvelope),
  }),
  defineOperation({
    method: "PATCH",
    path: "/api/v1/assets/{id}",
    operationId: "updateAsset",
    tags: ["assets"],
    summary: "Update asset alt text",
    security: "session",
    body: assetPatchBody,
    responses: okResponse(assetEnvelope),
  }),
  defineOperation({
    method: "DELETE",
    path: "/api/v1/assets/{id}",
    operationId: "deleteAsset",
    tags: ["assets"],
    summary: "Soft-remove an asset",
    security: "session",
    responses: noContentResponse(),
  }),
  defineOperation({
    method: "GET",
    path: "/api/v1/assets/{id}/raw",
    operationId: "getAssetBytes",
    tags: ["assets"],
    summary: "Authenticated asset byte proxy",
    security: "session",
    responses: streamResponse("application/octet-stream", "Raw asset bytes."),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/assets/upload-ticket",
    operationId: "createAssetUploadTicket",
    tags: ["assets"],
    summary: "Mint a direct-upload ticket (S3 PUT or Blob token)",
    security: "session",
    body: uploadTicketBody,
    responses: okResponse(
      dataEnvelope(ticketSchema),
      "Signed upload target for the storage driver.",
    ),
  }),
  defineOperation({
    method: "POST",
    path: "/api/v1/assets/upload",
    operationId: "assetBlobUpload",
    tags: ["assets"],
    summary: "Vercel Blob client-upload token/completion endpoint",
    security: "session",
    body: blobUploadBody,
    responses: okResponse(z.unknown(), "Vercel Blob protocol response."),
  }),
] as const;
