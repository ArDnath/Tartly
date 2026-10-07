/**
 * ImageKit media layer.
 *
 * `ImageKitRootProvider` is mounted once in `app/layout.tsx`; use `MediaImage`
 * and `MediaVideo` anywhere you would otherwise reach for `next/image` or a raw
 * `<video>`. Both accept every ImageKit transformation prop and fall back to a
 * plain element while `NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT` is unset.
 */
export { ImageKitRootProvider } from "./imagekit-provider";
export { MediaImage, type MediaImageProps } from "./media-image";
export { MediaVideo, type MediaVideoProps } from "./media-video";
