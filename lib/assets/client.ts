"use client";

/**
 * Browser-side asset upload.
 *
 * The browser hashes the file, asks the server for a scoped upload ticket,
 * streams the bytes **directly** to object storage, then registers the asset.
 * Bytes never pass through a route handler. Shared by Settings → Assets and the
 * chat composer so both obey the same limits and dedupe behavior.
 */

export type UploadedAsset = {
  id: string;
  kind: "image" | "file";
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  createdAt: string;
};

type UploadTicket = {
  mode: "blob" | "put";
  key: string;
  handleUploadUrl?: string;
  access?: "public" | "private";
  url?: string;
  headers?: Record<string, string>;
};

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
};

/**
 * Browsers sometimes report an empty MIME type (especially for files dragged
 * from some apps). The server re-validates the stored object's metadata, so a
 * best-effort fallback from the extension is safe and avoids a needless reject.
 */
export function inferMimeType(filename: string, declared?: string): string {
  const normalized = declared?.trim().toLowerCase();
  if (normalized && normalized !== "application/octet-stream") return normalized;
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function imageSize(
  blob: Blob,
): Promise<{ width: number | null; height: number | null }> {
  if (!blob.type.startsWith("image/")) return { width: null, height: null };
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: null, height: null };
  }
}

export async function errorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  const payload = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | null;
  return payload?.error?.message || fallback;
}

/**
 * Upload and register one asset. Returns the stored asset record the composer
 * needs (id, type, dimensions) — no bytes.
 */
export async function uploadAsset(input: {
  blob: Blob;
  filename: string;
  mimeType?: string;
  altText?: string | null;
}): Promise<UploadedAsset> {
  const filename = input.filename.trim() || "file";
  const mimeType = inferMimeType(filename, input.mimeType ?? input.blob.type);
  const bytes = await input.blob.arrayBuffer();
  const meta = {
    filename,
    mimeType,
    sizeBytes: input.blob.size,
    sha256: await sha256Hex(bytes),
  };

  const ticketResponse = await fetch("/api/v1/assets/upload-ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(meta),
  });
  if (!ticketResponse.ok) {
    throw new Error(
      await errorMessage(ticketResponse, `Couldn't upload ${filename}.`),
    );
  }

  const ticket = ((await ticketResponse.json()) as { data: UploadTicket }).data;

  if (ticket.mode === "blob") {
    const file =
      input.blob instanceof File
        ? input.blob
        : new File([input.blob], filename, { type: mimeType });
    const { upload } = await import("@vercel/blob/client");
    await upload(ticket.key, file, {
      access: ticket.access ?? "private",
      handleUploadUrl: ticket.handleUploadUrl ?? "/api/v1/assets/upload",
      clientPayload: JSON.stringify(meta),
      contentType: mimeType,
      multipart: input.blob.size > 4 * 1024 * 1024,
    });
  } else if (ticket.url) {
    const put = await fetch(ticket.url, {
      method: "PUT",
      headers: ticket.headers,
      body: input.blob,
    });
    if (!put.ok) throw new Error(`Couldn't upload ${filename}.`);
  } else {
    throw new Error(`Couldn't upload ${filename}.`);
  }

  const dimensions = await imageSize(input.blob);
  const finalize = await fetch("/api/v1/assets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...meta,
      key: ticket.key,
      altText: input.altText ?? null,
      width: dimensions.width,
      height: dimensions.height,
    }),
  });
  if (!finalize.ok) {
    throw new Error(await errorMessage(finalize, `Couldn't save ${filename}.`));
  }

  const payload = (await finalize.json()) as { data?: { asset?: UploadedAsset } };
  if (!payload.data?.asset) {
    throw new Error(`Couldn't save ${filename}.`);
  }
  return payload.data.asset;
}

/**
 * Upload a file part handed back by the composer. `PromptInput` presents blobs
 * as object/data URLs, so fetch that URL back into bytes before uploading.
 */
export async function uploadFilePart(file: {
  url: string;
  filename?: string;
  mediaType?: string;
}): Promise<UploadedAsset> {
  const response = await fetch(file.url);
  if (!response.ok) throw new Error("Couldn't read the selected file.");
  const blob = await response.blob();
  const filename = file.filename?.trim() || "file";
  return uploadAsset({
    blob,
    filename,
    mimeType: file.mediaType || blob.type,
  });
}

/** Lightweight byte formatting for chips and cards. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
