/**
 * RFC 2822 / RFC 2047 message building and Gmail base64url encoding.
 * Pure module (no `server-only`) so it can be unit-tested directly.
 */

import { randomUUID } from "node:crypto";

export type InlineImage = {
  /** Content-ID referenced from the HTML as `cid:<id>`. */
  cid: string;
  filename: string;
  mimeType: string;
  content: Buffer;
};

export type Attachment = {
  filename: string;
  mimeType: string;
  content: Buffer;
};

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
  /** Inline images rendered via `cid:` in the HTML part. */
  inlineImages?: InlineImage[];
  /** Regular file attachments. */
  attachments?: Attachment[];
  /** Extra headers, e.g. `List-Unsubscribe`. CR/LF are stripped. */
  headers?: Record<string, string>;
};

/** Gmail rejects a raw message above ~25 MB (base64-encoded). */
export const GMAIL_MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

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

function escapeQuotes(value: string): string {
  return value.replace(/"/g, "'");
}

/** Standard base64 with 76-column wrapping, as RFC 2045 expects. */
function base64Body(content: Buffer): string {
  return content.toString("base64").replace(/(.{76})/g, "$1\r\n");
}

function uniqueBoundary(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

/** One MIME entity: its header lines and its encoded body. */
type MimeEntity = { headers: string[]; body: string };

/** Render a nested entity (its headers appear after the boundary line). */
function entityToString(entity: MimeEntity): string {
  return [...entity.headers, "", entity.body].join("\r\n");
}

function partEntity(
  contentType: string,
  content: Buffer,
  extraHeaders: string[] = [],
): MimeEntity {
  return {
    headers: [
      `Content-Type: ${contentType}`,
      "Content-Transfer-Encoding: base64",
      ...extraHeaders,
    ],
    body: base64Body(content),
  };
}

/** Packs entities under a boundary, with a terminating close marker. */
function packMultipart(boundary: string, entities: MimeEntity[]): string {
  return (
    entities.map((entity) => `--${boundary}\r\n${entityToString(entity)}`).join("\r\n") +
    `\r\n--${boundary}--`
  );
}

/**
 * The text/HTML entity. `multipart/alternative` when an explicit HTML body is
 * present, otherwise a single `text/plain` part.
 */
function alternativeEntity(email: OutboundEmail): MimeEntity {
  if (email.html) {
    const boundary = uniqueBoundary("alt");
    return {
      headers: [`Content-Type: multipart/alternative; boundary="${boundary}"`],
      body: packMultipart(boundary, [
        partEntity("text/plain; charset=UTF-8", Buffer.from(email.text ?? "", "utf8")),
        partEntity("text/html; charset=UTF-8", Buffer.from(email.html, "utf8")),
      ]),
    };
  }
  return partEntity(
    "text/plain; charset=UTF-8",
    Buffer.from(email.text ?? "", "utf8"),
  );
}

function inlinePart(image: InlineImage): MimeEntity {
  return partEntity(
    `${image.mimeType}; name="${escapeQuotes(image.filename)}"`,
    image.content,
    [
      `Content-ID: <${image.cid}>`,
      `Content-Disposition: inline; filename="${escapeQuotes(image.filename)}"`,
    ],
  );
}

function attachmentPart(attachment: Attachment): MimeEntity {
  return partEntity(
    `${attachment.mimeType}; name="${escapeQuotes(attachment.filename)}"`,
    attachment.content,
    [
      `Content-Disposition: attachment; filename="${escapeQuotes(attachment.filename)}"`,
    ],
  );
}

/**
 * Builds an RFC 2822 message. Composes `multipart/alternative` (text + HTML),
 * `multipart/related` (inline images with `Content-ID`) and `multipart/mixed`
 * (file attachments) only when the message actually needs them, matching the
 * nesting Gmail expects.
 */
export function buildMime(email: OutboundEmail): string {
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
  for (const [name, value] of Object.entries(email.headers ?? {})) {
    // Never allow header injection via a crafted newline.
    const safeName = name.replace(/[\r\n:]/g, "").trim();
    const safeValue = value.replace(/[\r\n]+/g, " ").trim();
    if (safeName && safeValue) headers.push(foldHeader(safeName, safeValue));
  }

  const inlineImages = email.inlineImages ?? [];
  const attachments = email.attachments ?? [];

  let entity = alternativeEntity(email);

  if (inlineImages.length > 0) {
    const related = uniqueBoundary("rel");
    entity = {
      headers: [`Content-Type: multipart/related; boundary="${related}"`],
      body: packMultipart(related, [entity, ...inlineImages.map(inlinePart)]),
    };
  }

  if (attachments.length > 0) {
    const mixed = uniqueBoundary("mix");
    entity = {
      headers: [`Content-Type: multipart/mixed; boundary="${mixed}"`],
      body: packMultipart(mixed, [entity, ...attachments.map(attachmentPart)]),
    };
  }

  // The outer entity's Content-Type header belongs in the message header block
  // (a single part) so the blank line before the body stays a single separator.
  const message = [...headers, ...entity.headers, "", entity.body, ""].join("\r\n");
  if (Buffer.byteLength(message, "utf8") > GMAIL_MAX_MESSAGE_BYTES) {
    throw new Error(
      "This message is too large to send (over Gmail's 25 MB limit). Remove an attachment and try again.",
    );
  }
  return message;
}

/** Convenience wrapper producing the Gmail `messages.send` request body. */
export function buildRawMessage(email: OutboundEmail): string {
  return toBase64Url(buildMime(email));
}
