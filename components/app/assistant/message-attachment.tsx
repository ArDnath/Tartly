"use client";

import { FileTextIcon } from "lucide-react";

/**
 * A file shown in the transcript.
 *
 * Both a live optimistic `file` part (from `useChat`) and the rehydrated
 * `attachment` reference render through this, so the visual stays identical
 * before and after a reload. Images preview inline; other files get a type
 * glyph. The URL is the owner-scoped asset proxy.
 */
export function MessageAttachment({
  filename,
  mimeType,
  sizeBytes,
  url,
}: {
  filename: string;
  mimeType: string;
  sizeBytes?: number | null;
  url: string;
}) {
  const isImage = mimeType.startsWith("image/");
  const size =
    typeof sizeBytes === "number" && sizeBytes > 0
      ? sizeBytes < 1024
        ? `${sizeBytes} B`
        : sizeBytes < 1024 * 1024
          ? `${(sizeBytes / 1024).toFixed(0)} KB`
          : `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
      : null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={filename}
      className="group flex w-fit max-w-full items-center gap-2 rounded-lg border border-border bg-background/60 p-1.5 pr-3 transition-colors hover:border-foreground/25 hover:bg-accent/50"
    >
      <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md bg-muted">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={filename} className="size-full object-cover" />
        ) : (
          <FileTextIcon className="size-4 text-muted-foreground" aria-hidden />
        )}
      </span>
      <span className="min-w-0">
        <span className="block max-w-56 truncate text-xs font-medium text-foreground">
          {filename}
        </span>
        <span className="block text-[10px] text-muted-foreground">
          {mimeType === "application/pdf" ? "PDF" : mimeType.split("/").pop()?.toUpperCase()}
          {size ? ` · ${size}` : ""}
        </span>
      </span>
    </a>
  );
}
