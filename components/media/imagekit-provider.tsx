"use client";

import { ImageKitProvider } from "@imagekit/next";
import type { ReactNode } from "react";

import {
  getImageKitUrlEndpoint,
  isImageKitConfigured,
} from "@/lib/imagekit/config";

/**
 * App-wide ImageKit context.
 *
 * Sets the default `urlEndpoint` so `<MediaImage>` / `<MediaVideo>` (and the
 * raw `Image` / `Video` from `@imagekit/next`) do not have to repeat it.
 *
 * When `NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT` is blank the provider is a no-op and
 * renders its children unchanged — the SDK components would otherwise log an
 * error and render `null`.
 */
export function ImageKitRootProvider({ children }: { children: ReactNode }) {
  if (!isImageKitConfigured()) return <>{children}</>;

  return (
    <ImageKitProvider
      urlEndpoint={getImageKitUrlEndpoint()}
      transformationPosition="query"
    >
      {children}
    </ImageKitProvider>
  );
}
