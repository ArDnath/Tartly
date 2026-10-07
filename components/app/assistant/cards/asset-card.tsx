"use client";

import { ImageIcon, PaperclipIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { asBoolean, asNumber, asRecord, asString } from "./shared";

/** Human-readable byte size; undefined when the input is missing/invalid. */
function formatBytes(bytes: number | undefined): string | undefined {
  if (!bytes || bytes <= 0) return undefined;
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** The user's asset library (images and files) returned by `list_assets`. */
export function AssetLibraryCard({ output }: { output: unknown }) {
  const data = asRecord(output);
  const assets = Array.isArray(data?.assets) ? data.assets : [];
  const count = asNumber(data?.count) ?? assets.length;

  if (count === 0) {
    return (
      <Card size="sm">
        <CardContent className="text-sm text-muted-foreground">
          No saved assets yet. Upload images or files in Settings → Assets.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ImageIcon className="size-4 text-muted-foreground" aria-hidden />
          Asset library — {count}
        </CardTitle>
      </CardHeader>
      <CardContent className="gap-2">
        <ul className="flex flex-col gap-1">
          {assets.slice(0, 8).map((raw, index) => {
            const asset = asRecord(raw) ?? {};
            const kind = asString(asset.kind) === "file" ? "file" : "image";
            const filename = asString(asset.filename) ?? `asset-${index}`;
            const size = formatBytes(asNumber(asset.sizeBytes));
            const altText = asString(asset.altText);
            return (
              <li
                key={asString(asset.id) ?? `${filename}-${index}`}
                className="flex items-center gap-2 text-xs"
              >
                {kind === "file" ? (
                  <PaperclipIcon
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                ) : (
                  <ImageIcon
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                )}
                <span className="truncate text-foreground">{filename}</span>
                {altText ? (
                  <span className="truncate text-muted-foreground">· {altText}</span>
                ) : null}
                {size ? (
                  <span className="ml-auto shrink-0 text-muted-foreground">{size}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
        {assets.length > 8 ? (
          <p className="text-xs text-muted-foreground">+{assets.length - 8} more</p>
        ) : null}
        {asString(data?.notice) ? (
          <p className="border-t border-border/60 pt-2 text-xs text-muted-foreground">
            {asString(data?.notice)}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** The receipt for `add_asset` (an image/file saved to the library). */
export function AssetSavedCard({ output }: { output: unknown }) {
  const data = asRecord(output);
  const saved = asBoolean(data?.saved);

  if (!saved) {
    return (
      <Card size="sm">
        <CardContent className="text-sm text-muted-foreground">
          {asString(data?.notice) ?? "The asset was not saved."}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <PaperclipIcon className="size-4 text-muted-foreground" aria-hidden />
          Saved: {asString(data?.filename) ?? "asset"}
        </CardTitle>
      </CardHeader>
      <CardContent className="gap-1 text-sm text-muted-foreground">
        {asBoolean(data?.deduped) ? (
          <p>An identical file already existed — reused it instead of uploading again.</p>
        ) : null}
        {asString(data?.notice) ? <p className="text-xs">{asString(data?.notice)}</p> : null}
      </CardContent>
    </Card>
  );
}
