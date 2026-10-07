import { getImageKitUrlEndpoint } from "@/lib/imagekit/config";

/**
 * Canonical brand marks, served from ImageKit.
 *
 * The base URL follows `NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT` so pointing the app
 * at another ImageKit account only means editing `.env`. The hard-coded
 * fallback keeps the marks rendering anywhere the public var is unset (tests,
 * previews, local first run).
 *
 * The `?updatedAt=` query is ImageKit's cache-buster from the media library;
 * keep it in sync when a mark is re-uploaded.
 */
const IMAGEKIT_BASE =
  getImageKitUrlEndpoint() || "https://ik.imagekit.io/Ariyaman";

/**
 * Both marks are displayed small (≤48px) but are stored at full resolution, so
 * the `tr` transforms resize them at the CDN edge. Without this the landing
 * page downloads ~94KB and ~172KB of pixels to paint a 42px logo and a 28px
 * agent mark. `w-192` covers the 48px display at 4× and keeps the mark large
 * enough for the schema.org logo; the agent mark's `:w-112` chains a
 * width-only resize after the crop so its aspect ratio is preserved.
 */

/** Tartly product mark — wordmark tile used across the app and landing page. */
export const TARTLY_LOGO_URL = `${IMAGEKIT_BASE}/Tartly/tartly.png?updatedAt=1791192391962&tr=w-192,h-192`;

/** Tartly agent mark — used by the assistant panel, briefings and composer.
 *
 *  The source PNG carries a wide transparent margin with the mascot shifted
 *  right, which made the mark render small and off-centre. The `tr` extract
 *  crops to the mascot's bounding box so it fills and centres in any square it
 *  is placed in. Keep the coordinates in sync if the mark is re-exported.
 */
export const TARTLY_AGENT_LOGO_URL = `${IMAGEKIT_BASE}/Tartly/TartlyAgent.png?updatedAt=1791192282492&tr=cm-extract,x-246,y-242,w-857,h-764:w-112`;
