"use client";

import { Image as ImageKitImage, type IKImageProps } from "@imagekit/next";

import { shouldRenderWithImageKit } from "@/lib/imagekit/config";

export type MediaImageProps = IKImageProps & {
  /**
   * Source for a plain `<img>` fallback. Shown when ImageKit is not configured
   * or the ImageKit `src` is still empty, so the UI never renders a broken
   * request while the media library is being filled in.
   */
  fallbackSrc?: string;
  /** Classes for the fallback `<img>`; defaults to ImageKit's `className`. */
  fallbackClassName?: string;
};

/**
 * ImageKit-aware image.
 *
 * Renders the SDK's `Image` (a `next/image` wrapper with on-the-fly transforms)
 * when `NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT` is set and `src` points at a media
 * library asset. Otherwise it degrades to a plain `<img>` using `fallbackSrc`.
 *
 * The raw `src` is only ever used through the SDK; read the ImageKit docs for
 * the drop-in props (`transformation`, `queryParameters`, `responsive`, …).
 */
export function MediaImage({
  fallbackSrc,
  fallbackClassName,
  className,
  width,
  height,
  style,
  alt = "",
  loading,
  ...props
}: MediaImageProps) {
  if (shouldRenderWithImageKit(props.src)) {
    return (
      <ImageKitImage
        {...props}
        className={className}
        width={width}
        height={height}
        style={style}
        alt={alt}
        loading={loading}
      />
    );
  }

  if (!fallbackSrc) return null;

  // A plain <img> keeps placeholders working without registering every remote
  // host in next.config's `images.remotePatterns`.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={fallbackSrc}
      alt={alt}
      width={width}
      height={height}
      style={style}
      loading={loading}
      className={fallbackClassName ?? className}
    />
  );
}
