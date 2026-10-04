import "server-only";

/**
 * Attachment text extraction.
 *
 * A tiny registry keyed by MIME so richer formats (PDF, DOCX, OCR) can be added
 * later without touching the pipeline. Only text-like formats are handled here:
 * binary formats need a parser dependency, and the pipeline deliberately ships
 * with none.
 */

export type ExtractedText = {
  text: string;
  /** Which extractor produced the text (its MIME). */
  parser: string;
  /** True when the source exceeded the caller's char budget and was cut. */
  truncated: boolean;
};

export type TextExtractor = {
  id: string;
  matches: (mimeType: string) => boolean;
  extract: (bytes: Buffer) => string;
};

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return HTML_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Strip HTML to readable text: drop script/style, tags, then decode entities. */
export function htmlToPlainText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\r\n/g, "\n")
    .replace(/[ \t\f]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const EXTRACTORS: TextExtractor[] = [
  {
    id: "text/html",
    matches: (mime) =>
      mime === "text/html" || mime === "application/xhtml+xml",
    extract: (bytes) => htmlToPlainText(bytes.toString("utf8")),
  },
  {
    id: "application/json",
    matches: (mime) => mime === "application/json",
    extract: (bytes) => bytes.toString("utf8"),
  },
  {
    id: "application/xml",
    matches: (mime) => mime === "application/xml" || mime === "text/xml",
    extract: (bytes) => bytes.toString("utf8"),
  },
  {
    id: "text/plain",
    matches: (mime) => mime.startsWith("text/"),
    extract: (bytes) => bytes.toString("utf8").trim(),
  },
];

/** Register an additional extractor (e.g. a PDF parser) at the front of the list. */
export function registerTextExtractor(extractor: TextExtractor): void {
  EXTRACTORS.unshift(extractor);
}

/**
 * Extract text from `bytes`, or return `null` when no extractor handles the
 * MIME type. The caller owns truncation; this only produces the raw string.
 */
export function extractText(
  bytes: Buffer,
  mimeType: string,
): { text: string; parser: string } | null {
  const mime = mimeType.toLowerCase().split(";")[0]!.trim();
  const extractor = EXTRACTORS.find((candidate) => candidate.matches(mime));
  if (!extractor) return null;
  try {
    return { text: extractor.extract(bytes), parser: extractor.id };
  } catch {
    return null;
  }
}

/** Whether any registered extractor handles this MIME type. */
export function canExtract(mimeType: string): boolean {
  const mime = mimeType.toLowerCase().split(";")[0]!.trim();
  return EXTRACTORS.some((extractor) => extractor.matches(mime));
}
