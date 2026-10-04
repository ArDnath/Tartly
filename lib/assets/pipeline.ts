import "server-only";

import { nanoid } from "nanoid";

import { assetExtractMaxChars, isAssetExtractionEnabled } from "@/lib/env";
import { assetExtractionRepository } from "@/lib/repositories/asset-extractions";
import type { AssetExtractionStatus } from "@/lib/db/schema";

import { openText, sealText } from "./crypto";
import { canExtract, extractText } from "./extract";

/**
 * Encrypted extraction pipeline.
 *
 * Given bytes that have already passed the malware scan, it extracts text for
 * the formats we support, truncates to a bounded budget, seals it with
 * AES-256-GCM, and stores only the ciphertext. Everything is best-effort: a
 * failure records a content-free status and never fails the upload.
 */

export type ExtractionOutcome = {
  status: AssetExtractionStatus;
  parser: string | null;
  charCount: number;
  truncated: boolean;
};

export async function extractAndStoreAsset({
  userId,
  assetId,
  bytes,
  mimeType,
}: {
  userId: string;
  assetId: string;
  bytes: Buffer;
  mimeType: string;
}): Promise<ExtractionOutcome> {
  if (!isAssetExtractionEnabled()) {
    return { status: "skipped", parser: null, charCount: 0, truncated: false };
  }

  if (!canExtract(mimeType)) {
    await upsert(userId, assetId, {
      status: "unsupported",
      parser: null,
      charCount: 0,
      truncated: false,
      error: null,
      sealed: null,
    });
    return { status: "unsupported", parser: null, charCount: 0, truncated: false };
  }

  const extracted = extractText(bytes, mimeType);
  if (!extracted) {
    await upsert(userId, assetId, {
      status: "failed",
      parser: null,
      charCount: 0,
      truncated: false,
      error: "extract_failed",
      sealed: null,
    });
    return { status: "failed", parser: null, charCount: 0, truncated: false };
  }

  const limit = assetExtractMaxChars();
  const truncated = extracted.text.length > limit;
  const text = truncated ? extracted.text.slice(0, limit) : extracted.text;

  try {
    const sealed = sealText(text);
    await upsert(userId, assetId, {
      status: "ok",
      parser: extracted.parser,
      charCount: text.length,
      truncated,
      error: null,
      sealed,
    });
    return {
      status: "ok",
      parser: extracted.parser,
      charCount: text.length,
      truncated,
    };
  } catch {
    await upsert(userId, assetId, {
      status: "failed",
      parser: extracted.parser,
      charCount: 0,
      truncated: false,
      error: "seal_failed",
      sealed: null,
    });
    return { status: "failed", parser: extracted.parser, charCount: 0, truncated: false };
  }
}

async function upsert(
  userId: string,
  assetId: string,
  input: {
    status: AssetExtractionStatus;
    parser: string | null;
    charCount: number;
    truncated: boolean;
    error: string | null;
    sealed: { ciphertext: string; iv: string; tag: string } | null;
  },
): Promise<void> {
  await assetExtractionRepository.upsert({
    status: input.status,
    row: {
      id: nanoid(),
      userId,
      assetId,
      status: input.status,
      parser: input.parser,
      ciphertext: input.sealed?.ciphertext ?? null,
      iv: input.sealed?.iv ?? null,
      tag: input.sealed?.tag ?? null,
      charCount: input.charCount,
      truncated: input.truncated,
      error: input.error,
    },
  });
}

export type ExtractedAssetText = {
  text: string;
  parser: string | null;
  truncated: boolean;
  charCount: number;
};

/**
 * Decrypt and return an asset's extracted text, or `null` when there is none
 * (never extracted, unsupported, or failed). Owner-scoped.
 */
export async function getExtractedText({
  userId,
  assetId,
}: {
  userId: string;
  assetId: string;
}): Promise<ExtractedAssetText | null> {
  if (!isAssetExtractionEnabled()) return null;
  const row = await assetExtractionRepository.findByAssetForUser(userId, assetId);
  if (!row || row.status !== "ok" || !row.ciphertext || !row.iv || !row.tag) {
    return null;
  }
  try {
    const text = openText({
      ciphertext: row.ciphertext,
      iv: row.iv,
      tag: row.tag,
    });
    return {
      text,
      parser: row.parser,
      truncated: row.truncated,
      charCount: row.charCount,
    };
  } catch {
    return null;
  }
}
