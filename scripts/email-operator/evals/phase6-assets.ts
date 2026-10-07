import { createAsset, imageDimensions, mimeAllowed } from "../../../lib/assets/service";
import { assetStorageKey, sha256Hex } from "../../../lib/assets/storage";
import { inlineCid } from "../../../lib/assets/outbound";
import { buildMime } from "../../../lib/gmail/mime";
import { assert, section } from "../harness";

/**
 * Phase 6 — assets & inline images.
 *
 * Deterministic: MIME nesting for related + mixed + alternative, the
 * content-addressed per-user storage key, MIME/size validation, and intrinsic
 * dimension parsing. No storage, model, or Google call is made.
 */

export async function run(): Promise<void> {
  section("phase 6 — MIME builds the right multipart nesting");
  const plain = buildMime({
    from: "me@x.com",
    to: ["a@x.com"],
    subject: "Hi",
    text: "Hello",
  });
  assert(
    plain.includes("Content-Type: text/plain; charset=UTF-8") &&
      !plain.includes("multipart/"),
    "a text-only message stays single-part",
  );

  const alternative = buildMime({
    from: "me@x.com",
    to: ["a@x.com"],
    subject: "Hi",
    text: "Hello",
    html: "<p>Hello</p>",
  });
  assert(
    alternative.includes("multipart/alternative"),
    "text + HTML becomes multipart/alternative",
  );

  const inline = buildMime({
    from: "me@x.com",
    to: ["a@x.com"],
    subject: "Hi",
    text: "Hello",
    html: `<p>Hello</p><img src="cid:logo" />`,
    inlineImages: [
      {
        cid: "logo",
        filename: "logo.png",
        mimeType: "image/png",
        content: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      },
    ],
  });
  assert(
    inline.includes("multipart/related") &&
      inline.includes("Content-ID: <logo>") &&
      inline.includes('Content-Disposition: inline; filename="logo.png"'),
    "inline images become multipart/related parts with a Content-ID",
  );

  const both = buildMime({
    from: "me@x.com",
    to: ["a@x.com"],
    subject: "Hi",
    text: "Hello",
    html: `<p>Hello</p><img src="cid:logo" />`,
    inlineImages: [
      { cid: "logo", filename: "logo.png", mimeType: "image/png", content: Buffer.from("x") },
    ],
    attachments: [
      {
        filename: "report.pdf",
        mimeType: "application/pdf",
        content: Buffer.from("pdf"),
      },
    ],
  });
  assert(
    both.includes("multipart/mixed") &&
      both.includes("multipart/related") &&
      both.includes("multipart/alternative") &&
      both.includes('Content-Disposition: attachment; filename="report.pdf"'),
    "inline + attachment nests related inside mixed inside alternative",
  );

  section("phase 6 — asset validation + content addressing");
  assert(
    mimeAllowed("image/png") && mimeAllowed("application/pdf"),
    "allowed MIME globs accept images and PDFs",
  );
  assert(
    !mimeAllowed("application/zip") && !mimeAllowed("text/html"),
    "disallowed MIME types are rejected",
  );

  const empty = await createAsset({
    userId: "phase6-user",
    filename: "a.png",
    mimeType: "image/png",
    bytes: Buffer.alloc(0),
  });
  const badType = await createAsset({
    userId: "phase6-user",
    filename: "a.zip",
    mimeType: "application/zip",
    bytes: Buffer.from("data"),
  });
  assert(
    empty.ok === false && empty.error === "empty",
    "empty uploads are rejected",
  );
  assert(
    badType.ok === false && badType.error === "unsupported_type",
    "unsupported types are rejected before storage",
  );

  const bytes = Buffer.from("same-content");
  assert(
    assetStorageKey("userA", bytes) !== assetStorageKey("userB", bytes),
    "storage keys are user-scoped even for identical content",
  );
  assert(
    assetStorageKey("userA", bytes) === assetStorageKey("userA", Buffer.from("same-content")),
    "identical content addresses to the same key (dedupe)",
  );
  assert(sha256Hex(bytes).length === 64, "sha256 is a 64-char hex digest");
  assert(
    inlineCid("abc") === "asset-abc@tartly",
    "inline Content-IDs are stable and namespaced",
  );

  section("phase 6 — image dimensions from headers");
  const png = Buffer.alloc(24);
  png.writeUInt32BE(1600, 16);
  png.writeUInt32BE(900, 20);
  assert(
    imageDimensions(png, "image/png").width === 1600 &&
      imageDimensions(png, "image/png").height === 900,
    "PNG dimensions are read from the IHDR header",
  );
  assert(
    imageDimensions(Buffer.from("x"), "image/jpeg").width === null,
    "unknown formats return null rather than guessing",
  );
}
