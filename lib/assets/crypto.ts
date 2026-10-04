import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

import { assetExtractKey } from "@/lib/env";

/**
 * Envelope-free symmetric sealing for extracted attachment text.
 *
 * Extracted text can contain anything a sender put in a document, so it is
 * never stored in the clear. AES-256-GCM gives confidentiality *and* integrity:
 * a tampered ciphertext fails authentication on open instead of decrypting to
 * garbage. The 32-byte key lives in the server environment and is deliberately
 * not derived from any user data.
 */

const KEY_BYTES = 32;
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const ALGO = "aes-256-gcm";

export type SealedText = {
  /** Base64 ciphertext. */
  ciphertext: string;
  /** Base64 12-byte nonce. */
  iv: string;
  /** Base64 16-byte auth tag. */
  tag: string;
};

/** Decode and validate the configured key; throws a clear error if unusable. */
export function extractionKey(): Buffer {
  const raw = assetExtractKey();
  if (!raw) {
    throw new Error("ASSET_EXTRACT_KEY is not configured.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `ASSET_EXTRACT_KEY must be a base64-encoded ${KEY_BYTES}-byte key.`,
    );
  }
  return key;
}

/** Encrypt UTF-8 text. Safe to call repeatedly — every call uses a fresh IV. */
export function sealText(plaintext: string): SealedText {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, extractionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

/** Decrypt and authenticate sealed text. Throws on a tampered ciphertext. */
export function openText(sealed: SealedText): string {
  const iv = Buffer.from(sealed.iv, "base64");
  const tag = Buffer.from(sealed.tag, "base64");
  if (iv.length !== IV_BYTES || tag.length !== 16) {
    throw new Error("Sealed text is malformed.");
  }
  const decipher = createDecipheriv(ALGO, extractionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
