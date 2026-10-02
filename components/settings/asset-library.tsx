"use client";

import { FileText, Loader2, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

export type AssetView = {
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** SHA-256 of the file, computed in the browser; content-addresses the upload. */
async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Intrinsic image dimensions for the library grid; best-effort. */
async function imageSize(
  file: File,
): Promise<{ width: number | null; height: number | null }> {
  if (!file.type.startsWith("image/")) return { width: null, height: null };
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: null, height: null };
  }
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | null;
  return payload?.error?.message || fallback;
}

type UploadTicket = {
  mode: "blob" | "put";
  key: string;
  handleUploadUrl?: string;
  access?: "public" | "private";
  url?: string;
  headers?: Record<string, string>;
};

/**
 * Asset library (Phase 6). Upload images/files once, reuse them in compose and
 * campaigns. Bytes are proxied through an authenticated route, never the bucket.
 */
export function AssetLibrary() {
  const [assets, setAssets] = useState<AssetView[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/assets", { cache: "no-store" });
      const payload = (await response.json()) as {
        data?: { assets: AssetView[]; enabled: boolean };
      };
      if (payload.data) {
        setAssets(payload.data.assets);
        setEnabled(payload.data.enabled);
      }
    } catch {
      setError("Couldn't load your assets.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/assets", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { data?: { assets: AssetView[]; enabled: boolean } }) => {
        if (!active || !payload.data) return;
        setAssets(payload.data.assets);
        setEnabled(payload.data.enabled);
      })
      .catch(() => {
        if (active) setError("Couldn't load your assets.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const uploadOne = async (file: File) => {
    const filename = file.name || "file";
    const mimeType = file.type || "application/octet-stream";
    const sizeBytes = file.size;
    const sha256 = await sha256Hex(file);
    const meta = { filename, mimeType, sizeBytes, sha256 };

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
      const { upload } = await import("@vercel/blob/client");
      await upload(ticket.key, file, {
        access: ticket.access ?? "private",
        handleUploadUrl: ticket.handleUploadUrl ?? "/api/v1/assets/upload",
        clientPayload: JSON.stringify(meta),
        contentType: mimeType,
        multipart: file.size > 4 * 1024 * 1024,
      });
    } else if (ticket.url) {
      const put = await fetch(ticket.url, {
        method: "PUT",
        headers: ticket.headers,
        body: file,
      });
      if (!put.ok) throw new Error(`Couldn't upload ${filename}.`);
    } else {
      throw new Error(`Couldn't upload ${filename}.`);
    }

    const dimensions = await imageSize(file);
    const finalize = await fetch("/api/v1/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...meta,
        key: ticket.key,
        altText: null,
        width: dimensions.width,
        height: dimensions.height,
      }),
    });
    if (!finalize.ok) {
      throw new Error(await errorMessage(finalize, `Couldn't save ${filename}.`));
    }
  };

  const upload = async (files: FileList) => {
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        await uploadOne(file);
      }
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (id: string) => {
    const previous = assets;
    setAssets((current) => current.filter((asset) => asset.id !== id));
    const response = await fetch(`/api/v1/assets/${id}`, { method: "DELETE" }).catch(
      () => null,
    );
    if (!response?.ok) setAssets(previous);
  };

  const saveAlt = async (id: string, altText: string) => {
    await fetch(`/api/v1/assets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ altText: altText.trim() || null }),
    }).catch(() => undefined);
  };

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {assets.length} {assets.length === 1 ? "asset" : "assets"} · images and
          PDFs, up to 10 MB each.
        </p>
        <Button
          type="button"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={uploading || !enabled}
        >
          {uploading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Upload className="size-3.5" />
          )}
          Upload
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files?.length) void upload(event.target.files);
          }}
        />
      </div>

      {!enabled ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Assets are disabled or storage is not configured in this environment.
        </p>
      ) : null}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : assets.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          No assets yet. Upload a logo, headshot, or PDF to reuse it in your mail.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {assets.map((asset) => (
            <li
              key={asset.id}
              className="flex flex-col overflow-hidden rounded-xl border border-border bg-card"
            >
              <div className="flex h-28 items-center justify-center bg-muted/40">
                {asset.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/v1/assets/${asset.id}/raw`}
                    alt={asset.altText ?? asset.filename}
                    className="max-h-28 max-w-full object-contain"
                  />
                ) : (
                  <FileText className="size-8 text-muted-foreground" aria-hidden />
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1.5 p-2.5">
                <p className="truncate text-[12px] font-medium text-foreground">
                  {asset.filename}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {formatBytes(asset.sizeBytes)}
                  {asset.width && asset.height
                    ? ` · ${asset.width}×${asset.height}`
                    : ""}
                </p>
                {asset.kind === "image" ? (
                  <input
                    defaultValue={asset.altText ?? ""}
                    placeholder="Alt text"
                    onBlur={(event) => void saveAlt(asset.id, event.target.value)}
                    className="w-full rounded-md border border-border bg-transparent px-1.5 py-1 text-[11px] outline-none focus:border-ring"
                  />
                ) : null}
                <div className="mt-auto flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard?.writeText(asset.id)}
                    className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Copy id
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${asset.filename}`}
                    onClick={() => void remove(asset.id)}
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
