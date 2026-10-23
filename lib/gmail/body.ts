/**
 * Hard ceilings for stored email bodies.
 *
 * Gmail hands us decoded `text/plain` and `text/html` payloads with no size
 * limit. Most messages are small, but a newsletter with inline base64 images
 * can be several megabytes — and every one is copied into Postgres, WAL,
 * dumps and (eventually) offsite storage. At 10k users the disk, not the
 * network, is the binding constraint (guide §16.2b, tracker A8/A15).
 *
 * These are *storage* caps, not render caps: the UI still receives the body it
 * was given, just bounded. Truncation happens on a tag/line boundary where
 * possible so a capped HTML part does not end mid-attribute.
 */

/** ~64 KiB of plain text. Enough for a long thread message; far above the norm. */
export const MAX_STORED_BODY_TEXT_CHARS = 64 * 1024;

/** ~128 KiB of HTML. Matches the guide's 64–128 KiB recommendation. */
export const MAX_STORED_BODY_HTML_CHARS = 128 * 1024;

const TEXT_TRUNCATION_MARKER = "\n\n[... message truncated ...]";
const HTML_TRUNCATION_MARKER = "\n<!-- tartly:truncated -->";

/**
 * Cut at the last boundary in the final 20% of the window, otherwise at the
 * exact cap. The 80% rule avoids returning a nearly-empty string when the only
 * boundary is at the very start.
 */
function truncateAtBoundary(
  value: string,
  max: number,
  boundary: string,
  marker: string,
): string {
  if (value.length <= max) return value;

  const slice = value.slice(0, max);
  const at = slice.lastIndexOf(boundary);
  const minUseful = Math.floor(max * 0.8);
  const head =
    at >= minUseful
      ? boundary === ">"
        ? slice.slice(0, at + 1)
        : slice.slice(0, at)
      : slice;

  return `${head}${marker}`;
}

/** Apply both storage ceilings. `null` HTML stays `null` (plain-text mail). */
export function capStoredBodies({
  text,
  html,
}: {
  text: string;
  html: string | null;
}): { text: string; html: string | null } {
  return {
    text: truncateAtBoundary(
      text,
      MAX_STORED_BODY_TEXT_CHARS,
      "\n",
      TEXT_TRUNCATION_MARKER,
    ),
    html:
      html === null
        ? null
        : truncateAtBoundary(
            html,
            MAX_STORED_BODY_HTML_CHARS,
            ">",
            HTML_TRUNCATION_MARKER,
          ),
  };
}
