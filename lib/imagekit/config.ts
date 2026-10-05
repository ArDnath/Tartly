/**
 * Client-safe ImageKit configuration.
 *
 * `NEXT_PUBLIC_*` values are inlined at build time, so this module can be
 * imported from server components, client components and edge code alike. It
 * deliberately avoids `lib/env.ts`, which pulls in the full (server-only) Zod
 * schema and would drag every secret name into a client bundle.
 *
 * The endpoint is optional. While it is blank, `isImageKitConfigured()` returns
 * false and `<MediaImage>` / `<MediaVideo>` fall back to their placeholder
 * sources instead of building an invalid URL.
 *
 * The values are read lazily (inside functions) rather than captured at module
 * load so tests can stub `process.env`.
 */

/** ImageKit URL endpoint without a trailing slash, or `""` when unset. */
export function getImageKitUrlEndpoint(): string {
  return (process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT ?? "").replace(
    /\/+$/,
    "",
  );
}

/** True when a URL endpoint is configured and media should go through ImageKit. */
export function isImageKitConfigured(): boolean {
  return getImageKitUrlEndpoint().length > 0;
}

/**
 * Whether a given `src` should be rendered through ImageKit: MediaImage /
 * MediaVideo use this to decide between the SDK component and the fallback.
 */
export function shouldRenderWithImageKit(src: unknown): boolean {
  return isImageKitConfigured() && typeof src === "string" && src.trim().length > 0;
}
