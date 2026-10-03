/**
 * Pure Gmail payload parsing: base64url decoding, MIME walking, RFC 2047
 * header decoding and address parsing.
 *
 * Deliberately free of `server-only`/network imports so it is unit-testable in
 * isolation (see `scripts/email-operator/phase1-gmail.ts`).
 */

export type GmailHeader = { name?: string | null; value?: string | null };

export type GmailBody = {
  size?: number | null;
  data?: string | null;
  attachmentId?: string | null;
};

export type GmailPart = {
  partId?: string | null;
  mimeType?: string | null;
  filename?: string | null;
  headers?: GmailHeader[] | null;
  body?: GmailBody | null;
  parts?: GmailPart[] | null;
};

export type GmailMessageResource = {
  id?: string | null;
  threadId?: string | null;
  labelIds?: string[] | null;
  snippet?: string | null;
  internalDate?: string | null;
  payload?: GmailPart | null;
};

export type ParsedAddress = { name: string | null; email: string };

/**
 * Bulk-mail headers captured at parse time (Phase 2). Kept structurally
 * identical to `MessageUnsubscribeInfo` in `lib/db/schema.ts` so it can be
 * stored verbatim; defined here to keep this module dependency-free.
 */
export type ParsedUnsubscribeInfo = {
  url?: string;
  mailto?: string;
  oneClick: boolean;
  listId?: string;
  precedence?: string;
};

export type ParsedMessage = {
  gmailMessageId: string;
  gmailThreadId: string;
  subject: string | null;
  from: ParsedAddress | null;
  to: ParsedAddress[];
  cc: ParsedAddress[];
  bodyText: string;
  bodyHtml: string | null;
  snippet: string | null;
  labels: string[];
  unsubscribe: ParsedUnsubscribeInfo | null;
  /** `Auto-Submitted` / `X-Autoreply` marker: this is a robot, not a person. */
  autoSubmitted: boolean;
  sentAt: Date | null;
};

/** Decodes Gmail's URL-safe base64 into UTF-8 text. */
export function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

export function getHeader(
  headers: GmailHeader[] | null | undefined,
  name: string,
): string | undefined {
  const target = name.toLowerCase();
  const found = (headers ?? []).find(
    (header) => (header.name ?? "").toLowerCase() === target,
  );
  return found?.value ?? undefined;
}

/** Decodes RFC 2047 encoded words, e.g. `=?UTF-8?B?SGVsbG8=?=`. */
export function decodeRfc2047(value: string): string {
  return value.replace(
    /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
    (_match, charset: string, encoding: string, text: string) => {
      try {
        if (encoding.toUpperCase() === "B") {
          return Buffer.from(text, "base64").toString(
            normalizeCharset(charset),
          );
        }
        // Q-encoding: underscores are spaces, `=XX` are hex bytes.
        const bytes = text
          .replace(/_/g, " ")
          .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) =>
            String.fromCharCode(parseInt(hex, 16)),
          );
        return Buffer.from(bytes, "binary").toString(normalizeCharset(charset));
      } catch {
        return text;
      }
    },
  );
}

function normalizeCharset(charset: string): BufferEncoding {
  const normalized = charset.toLowerCase();
  if (normalized === "utf-8" || normalized === "utf8") return "utf8";
  if (normalized === "iso-8859-1" || normalized === "latin1") return "latin1";
  return "utf8";
}

/** Parses a `Name <email@host>` style address list. */
export function parseAddressList(value: string | undefined): ParsedAddress[] {
  if (!value) return [];

  const decoded = decodeRfc2047(value);
  const addresses: ParsedAddress[] = [];
  let current = "";
  let inQuotes = false;

  const flush = (raw: string) => {
    const part = raw.trim();
    if (!part) return;
    const angle = part.match(/^(.*)<([^>]+)>\s*$/);
    if (angle) {
      const name = angle[1].trim().replace(/^"|"$/g, "");
      addresses.push({ name: name || null, email: angle[2].trim().toLowerCase() });
      return;
    }
    addresses.push({ name: null, email: part.replace(/^"|"$/g, "").toLowerCase() });
  };

  for (const char of decoded) {
    if (char === '"') inQuotes = !inQuotes;
    if (char === "," && !inQuotes) {
      flush(current);
      current = "";
      continue;
    }
    current += char;
  }
  flush(current);

  return addresses.filter((address) => address.email.includes("@"));
}

/** Recursively collects the best text/plain and text/html bodies. */
export function extractBodies(payload: GmailPart | null | undefined): {
  text: string;
  html: string | null;
} {
  let text = "";
  let html: string | null = null;

  const walk = (part: GmailPart | null | undefined) => {
    if (!part) return;

    const mimeType = (part.mimeType ?? "").toLowerCase();
    const data = part.body?.data;
    // Attachment parts carry an attachmentId and no inline data; skip them.
    const isAttachment = Boolean(part.filename) && !data;

    if (data && !isAttachment) {
      if (mimeType === "text/plain" && !text) {
        text = decodeBase64Url(data);
      } else if (mimeType === "text/html" && html === null) {
        html = decodeBase64Url(data);
      }
    }

    for (const child of part.parts ?? []) walk(child);
  };

  walk(payload);
  return { text, html };
}

/** Turns a Gmail `messages.get` resource into a normalized row. */
export function parseGmailMessage(message: GmailMessageResource): ParsedMessage {
  const headers = message.payload?.headers ?? null;
  const { text, html } = extractBodies(message.payload);

  const internalDate = message.internalDate
    ? Number(message.internalDate)
    : Number.NaN;

  return {
    gmailMessageId: message.id ?? "",
    gmailThreadId: message.threadId ?? "",
    subject: getHeader(headers, "subject")
      ? decodeRfc2047(getHeader(headers, "subject")!)
      : null,
    from: parseAddressList(getHeader(headers, "from"))[0] ?? null,
    to: parseAddressList(getHeader(headers, "to")),
    cc: parseAddressList(getHeader(headers, "cc")),
    bodyText: text,
    bodyHtml: html,
    snippet: message.snippet ?? null,
    labels: message.labelIds ?? [],
    unsubscribe: parseUnsubscribeHeaders(headers),
    autoSubmitted: parseAutoSubmitted(headers),
    sentAt: Number.isFinite(internalDate) ? new Date(internalDate) : null,
  };
}

/** The `<url>`s inside a `List-Unsubscribe` header value. */
function extractAngleBrackets(value: string): string[] {
  return [...value.matchAll(/<([^>]+)>/g)].map((match) => match[1]!.trim());
}

/**
 * Reads the bulk-mail headers that make newsletter/marketing detection
 * deterministic and free. Returns null for ordinary person-to-person mail.
 */
export function parseUnsubscribeHeaders(
  headers: GmailHeader[] | null | undefined,
): ParsedUnsubscribeInfo | null {
  const listUnsubscribe = getHeader(headers, "list-unsubscribe");
  const listId = getHeader(headers, "list-id");
  const precedence = getHeader(headers, "precedence");
  const post = getHeader(headers, "list-unsubscribe-post");

  if (!listUnsubscribe && !listId && !precedence && !post) return null;

  const targets = listUnsubscribe ? extractAngleBrackets(listUnsubscribe) : [];
  const url = targets.find((target) => /^https?:\/\//i.test(target));
  const mailto = targets.find((target) => /^mailto:/i.test(target));

  return {
    ...(url ? { url } : {}),
    ...(mailto ? { mailto } : {}),
    // RFC 8058: the sender accepts a POST-only unsubscribe.
    oneClick: /list-unsubscribe\s*=\s*one-click/i.test(post ?? ""),
    ...(listId ? { listId: listId.trim().slice(0, 200) } : {}),
    ...(precedence ? { precedence: precedence.trim().toLowerCase().slice(0, 40) } : {}),
  };
}

/**
 * Detects auto-reply/bounce markers that mean the sender is a machine
 * (`Auto-Submitted: auto-replied|auto-generated`, `X-Autoreply: yes`,
 * `Precedence: bulk|junk|list`). Pure header check — no content.
 */
export function parseAutoSubmitted(
  headers: GmailHeader[] | null | undefined,
): boolean {
  const autoSubmitted = getHeader(headers, "auto-submitted");
  if (autoSubmitted && !/^no\b/i.test(autoSubmitted.trim())) return true;

  const autoReply = getHeader(headers, "x-autoreply") ?? getHeader(headers, "x-autorespond");
  if (autoReply && /^(yes|true|auto)/i.test(autoReply.trim())) return true;

  const precedence = getHeader(headers, "precedence");
  if (precedence && /^(bulk|junk|list)\b/i.test(precedence.trim())) return true;

  return false;
}

/**
 * Strips HTML into readable text. Used when a message only carries an HTML
 * body so triage/drafting still has plain text to work with.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
