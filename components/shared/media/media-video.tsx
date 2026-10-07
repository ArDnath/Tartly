"use client";

import { Video as ImageKitVideo, type IKVideoProps } from "@imagekit/next";

import { shouldRenderWithImageKit } from "@/lib/imagekit/config";

export type MediaVideoProps = IKVideoProps & {
  /**
   * Source for a native `<video>` fallback, used when ImageKit is not
   * configured or the ImageKit `src` is still empty.
   */
  fallbackSrc?: string;
  /** Classes for the fallback `<video>`; defaults to ImageKit's `className`. */
  fallbackClassName?: string;
};

function hasImageKitSrc(src: IKVideoProps["src"]): boolean {
  return shouldRenderWithImageKit(src);
}

/**
 * ImageKit-aware video.
 *
 * Renders the SDK's `Video` (an HTML5 `<video>` with ImageKit URL generation and
 * transformations) when a URL endpoint is configured and `src` is set.
 * Otherwise it degrades to a native `<video>` using `fallbackSrc`.
 *
 * Use `buildSrc` from `@imagekit/next` to derive a poster thumbnail from the
 * video, e.g. `buildSrc({ urlEndpoint, src: `${videoPath}/ik-thumbnail.jpg` })`.
 */
export function MediaVideo({
  fallbackSrc,
  fallbackClassName,
  className,
  poster,
  ...props
}: MediaVideoProps) {
  if (hasImageKitSrc(props.src)) {
    return (
      <ImageKitVideo
        {...props}
        poster={poster}
        className={className}
      />
    );
  }

  if (!fallbackSrc) return null;

  // Strip the ImageKit-only props before handing the rest to a native element.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { transformation, queryParameters, transformationPosition, urlEndpoint, ...videoProps } =
    props;

  return (
    <video
      {...videoProps}
      poster={poster}
      className={fallbackClassName ?? className}
      src={fallbackSrc}
    />
  );
}
