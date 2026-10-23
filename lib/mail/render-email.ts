/**
 * Pure transforms applied to a sender's HTML before the reader renders it.
 *
 * Email HTML is written against a light client that runs JavaScript. Two of the
 * things that assumes break inside our sandboxed, scriptless frame:
 *
 *  - images are lazy-loaded with `data-src` (and only promoted to `src` by a
 *    script that never runs here), so the image stays blank;
 *  - inline images are referenced as `cid:<content-id>`, which resolves to
 *    nothing in a browser, so signature and pasted images go missing.
 *
 * Both have a deterministic fix at parse time: promote the lazy URL, and map
 * each `cid:` onto a URL the frame can actually fetch (a same-origin attachment
 * proxy, built by the caller).
 *
 * `hasLightBackground` feeds the reader's contrast fallback: a message that
 * brings its own light background is left exactly as authored, while one that
 * does not is painted with a readable light-on-dark default so its near-black
 * text does not vanish on our dark canvas.
 *
 * Deliberately free of `server-only`/network imports so both the server parser
 * and the client renderer can import it, and so it is unit-testable directly.
 */

/** `src` values a lazy loader ships before its script swaps in the real URL. */
function isPlaceholderSrc(value: string): boolean {
  const src = value.trim();
  if (!src) return true;
  if (/^about:blank$/i.test(src)) return true;
  // A tiny transparent spacer GIF/PNG is the usual lazy-load placeholder.
  if (/^data:image\/(?:gif|png);base64,/i.test(src) && src.length < 256) {
    return true;
  }
  return false;
}

/** Read an attribute value from a single tag, independent of quote style. */
function attribute(tag: string, name: string): string | null {
  const match = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * The attributes a lazy loader leaves the real URL in. Checked in order; the
 * first non-empty, non-`data:` value wins so a placeholder never beats the real
 * image.
 */
const LAZY_SRC_ATTRS = [
  "data-src",
  "data-lazy-src",
  "data-original",
  "data-actualsrc",
  "data-image",
];

/** Promote lazy-loaded `<img>` URLs into real ones. No-op when there are none. */
export function promoteLazyImages(html: string): string {
  if (!/data-(?:src|lazy-src|original|actualsrc|image|srcset)\s*=/i.test(html)) {
    return html;
  }

  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    let out = tag;
    const src = attribute(out, "src");
    const lazySrc = LAZY_SRC_ATTRS.map((name) => attribute(out, name)).find(
      (value): value is string =>
        Boolean(value && value.trim() && !value.startsWith("data:")),
    );

    if (lazySrc && (!src || isPlaceholderSrc(src))) {
      out = src
        ? out.replace(
            /\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
            `src="${escapeAttribute(lazySrc)}"`,
          )
        : out.replace(/<img\b/i, `<img src="${escapeAttribute(lazySrc)}"`);
    }

    const lazySrcset = attribute(out, "data-srcset");
    if (lazySrcset && !attribute(out, "srcset")) {
      out = out.replace(
        /<img\b/i,
        `<img srcset="${escapeAttribute(lazySrcset)}"`,
      );
    }

    return out;
  });
}

function decodeCid(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Replace `cid:<content-id>` references (in `src` and in CSS `url(...)`) with
 * the proxy URLs the caller resolved. Unmatched ids are left untouched.
 */
export function rewriteInlineImages(
  html: string,
  urls: Map<string, string>,
): string {
  if (urls.size === 0 || !/cid:/i.test(html)) return html;

  return html.replace(/cid:([^"'\s>)]+)/gi, (match, raw: string) => {
    const cid = decodeCid(raw).replace(/^<|>$/g, "");
    return urls.get(cid) ?? urls.get(raw) ?? match;
  });
}

/**
 * Tag every `<style>` element with the page's CSP nonce.
 *
 * A `srcdoc` frame inherits the host policy, which binds style *elements* to
 * that nonce. Without it a sender's own stylesheet — and therefore a designed
 * email's background and layout — is dropped while its dark text survives,
 * which lands unreadable on our dark canvas. Inside the sandboxed, scriptless
 * frame a style element can only affect the message itself, never the app UI.
 */
export function applyStyleNonce(html: string, nonce: string): string {
  if (!nonce || !/<style\b/i.test(html)) return html;
  return html.replace(/<style\b/gi, `<style nonce="${nonce}"`);
}

/** Named light colors worth treating as a sender-supplied background. */
const NAMED_LIGHT = new Set([
  "white",
  "snow",
  "whitesmoke",
  "seashell",
  "floralwhite",
  "oldlace",
  "ivory",
  "lightyellow",
  "lightcyan",
  "mintcream",
  "azure",
  "aliceblue",
  "ghostwhite",
  "honeydew",
  "linen",
  "antiquewhite",
  "papayawhip",
  "blanchedalmond",
  "mistyrose",
  "bisque",
  "beige",
  "cornsilk",
  "lavenderblush",
]);

/** Relative luminance (0–1) for a hex/rgb/named color, or null if not a color. */
function colorLuminance(token: string): number | null {
  const value = token.trim().toLowerCase();
  if (!value) return null;
  if (NAMED_LIGHT.has(value)) return 1;

  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    let digits = hex[1]!;
    if (digits.length === 3) {
      digits = digits
        .split("")
        .map((char) => char + char)
        .join("");
    }
    const [r, g, b] = [0, 2, 4].map(
      (offset) => parseInt(digits.slice(offset, offset + 2), 16) / 255,
    );
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  }

  const rgb = value.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/,
  );
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(
      (channel) => Number(channel) / 255,
    );
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  }

  return null;
}

/** True when a `background`/`background-color` value paints a light surface. */
function backgroundIsLight(value: string): boolean {
  const declaration = value.replace(/!important/gi, "");
  const tokens =
    declaration.match(/#[0-9a-f]{3,6}\b|rgba?\([^)]*\)|\b[a-z]+\b/gi) ?? [];
  for (const token of tokens) {
    const luminance = colorLuminance(token);
    if (luminance !== null && luminance >= 0.7) return true;
  }
  return false;
}

/**
 * Whether the message brings a light background of its own (as a `bgcolor`
 * attribute or a `background`/`background-color` declaration, inline or in a
 * `<style>` block). A light surface means the sender's own dark text will read,
 * so the reader must not override colors.
 */
export function hasLightBackground(html: string): boolean {
  for (const match of html.matchAll(
    /bgcolor\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
  )) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    const luminance = colorLuminance(value);
    if (luminance !== null && luminance >= 0.7) return true;
  }

  for (const match of html.matchAll(
    /background(?:-color)?\s*:\s*([^;"'}]+)/gi,
  )) {
    if (backgroundIsLight(match[1] ?? "")) return true;
  }

  return false;
}
