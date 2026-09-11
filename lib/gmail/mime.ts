/**
 * RFC 2822 / RFC 2047 message building and Gmail base64url encoding.
 * Pure module (no `server-only`) so it can be unit-tested directly.
 */

export type OutboundEmail = {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
  /** Threading headers so replies land in the existing Gmail conversation. */
  inReplyTo?: string;
  references?: string[];
};

/** Encodes a header value as RFC 2047 only when it contains non-ASCII. */
export function encodeRfc2047(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Gmail requires URL-safe base64 without padding. */
export function toBase64Url(value: string | Buffer): string {
  const buffer = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Folds long header values onto continuation lines. */
function foldHeader(name: string, value: string): string {
  const header = `${name}: ${value}`;
  if (header.length <= 78) return header;

  const words = value.split(" ");
  const lines: string[] = [`${name}:`];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > 76) {
      lines.push(current.trim());
      current = word;
    } else {
      current = `${current} ${word}`;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines.join("\r\n ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Wraps plain text into a minimal HTML body. */
export function textToHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  return `<div>${paragraphs}</div>`;
}

/**
 * Builds an RFC 2822 message. When both `text` and `html` are present the
 * message is `multipart/alternative`; otherwise it is a single-part body.
 */
export function buildMime(email: OutboundEmail): string {
  const boundary = `redape_${Math.random().toString(36).slice(2)}`;
  const headers: string[] = [
    foldHeader("From", email.from),
    foldHeader("To", email.to.join(", ")),
  ];

  if (email.cc?.length) headers.push(foldHeader("Cc", email.cc.join(", ")));
  if (email.bcc?.length) headers.push(foldHeader("Bcc", email.bcc.join(", ")));
  headers.push(foldHeader("Subject", encodeRfc2047(email.subject)));
  headers.push("MIME-Version: 1.0");

  if (email.inReplyTo) headers.push(foldHeader("In-Reply-To", email.inReplyTo));
  if (email.references?.length) {
    headers.push(foldHeader("References", email.references.join(" ")));
  }

  const html = email.html ?? (email.text ? null : undefined);
  if (html) {
    headers.push(
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
    );
    return [
      ...headers,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      toBase64Url(email.text),
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      toBase64Url(html),
      `--${boundary}--`,
      "",
    ].join("\r\n");
  }

  headers.push("Content-Type: text/plain; charset=UTF-8");
  headers.push("Content-Transfer-Encoding: base64");
  return [...headers, "", toBase64Url(email.text), ""].join("\r\n");
}

/** Convenience wrapper producing the Gmail `messages.send` request body. */
export function buildRawMessage(email: OutboundEmail): string {
  return toBase64Url(buildMime(email));
}
