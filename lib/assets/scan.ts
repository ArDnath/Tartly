import "server-only";

import { Socket } from "node:net";

import {
  assetScanMode,
  clamavHost,
  clamavPort,
  clamavTimeoutMs,
  isClamavConfigured,
  type AssetScanMode,
} from "@/lib/env";

/**
 * Attachment malware scanning.
 *
 * A small pluggable `AssetScanner` interface with a ClamAV (`clamd` INSTREAM)
 * adapter. The scanner is transport-only: it knows nothing about storage or the
 * database, so it can be unit-tested against a fake socket and swapped for a
 * hosted engine later. `scanAsset` applies the configured mode:
 *
 *   off      → no scan, verdict `skipped`
 *   warn     → scan and record; the caller still accepts the file
 *   enforce  → scan; a non-clean or unscannable file must be rejected
 */

export type ScanVerdict = "clean" | "infected" | "error" | "skipped";

export type ScanResult = {
  verdict: ScanVerdict;
  /** Malware name when `infected`; null otherwise. */
  signature: string | null;
  scanner: string;
  /** Short, content-free reason for `error`. */
  detail: string | null;
};

export interface AssetScanner {
  readonly id: string;
  scan(
    bytes: Buffer,
    meta: { filename: string; mimeType: string },
  ): Promise<ScanResult>;
}

export type ClamavOptions = {
  host: string;
  port: number;
  timeoutMs: number;
};

const INSTREAM_CHUNK_BYTES = 64 * 1024;

/**
 * Parses a clamd INSTREAM reply into a verdict. Pure and exported so the wire
 * format is covered directly (see tests/unit/assets).
 */
export function parseClamavReply(raw: string): ScanResult {
  const text = raw.replace(/\0/g, "").trim();
  if (/\bFOUND\b/.test(text)) {
    const signature = text
      .replace(/^stream:\s*/i, "")
      .replace(/\s*FOUND.*$/i, "")
      .trim();
    return {
      verdict: "infected",
      signature: signature || "unknown",
      scanner: "clamav",
      detail: null,
    };
  }
  if (/\bOK\b/.test(text)) {
    return { verdict: "clean", signature: null, scanner: "clamav", detail: null };
  }
  return {
    verdict: "error",
    signature: null,
    scanner: "clamav",
    detail: text.slice(0, 200) || "empty_response",
  };
}

/** Streams `bytes` to clamd using the INSTREAM protocol. */
export async function clamavScan(
  bytes: Buffer,
  options: ClamavOptions,
): Promise<ScanResult> {
  return new Promise<ScanResult>((resolve) => {
    const socket = new Socket();
    let settled = false;
    let response = "";

    const finish = (result: ScanResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(options.timeoutMs);
    socket.on("timeout", () => {
      finish({
        verdict: "error",
        signature: null,
        scanner: "clamav",
        detail: "timeout",
      });
    });
    socket.on("error", (error) => {
      finish({
        verdict: "error",
        signature: null,
        scanner: "clamav",
        detail: (error as NodeJS.ErrnoException).code ?? error.message,
      });
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      // clamd terminates every reply with a NUL byte.
      if (response.includes("\0")) finish(parseClamavReply(response));
    });
    socket.on("end", () => finish(parseClamavReply(response)));

    socket.connect(options.port, options.host, () => {
      socket.write("zINSTREAM\0");
      for (let offset = 0; offset < bytes.length; offset += INSTREAM_CHUNK_BYTES) {
        const chunk = bytes.subarray(offset, offset + INSTREAM_CHUNK_BYTES);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length, 0);
        socket.write(length);
        socket.write(chunk);
      }
      const terminator = Buffer.alloc(4);
      terminator.writeUInt32BE(0, 0);
      socket.end(terminator);
    });
  });
}

const clamavScanner: AssetScanner = {
  id: "clamav",
  async scan(bytes) {
    return clamavScan(bytes, {
      host: clamavHost(),
      port: clamavPort(),
      timeoutMs: clamavTimeoutMs(),
    });
  },
};

const nullScanner: AssetScanner = {
  id: "none",
  async scan() {
    return { verdict: "skipped", signature: null, scanner: "none", detail: null };
  },
};

/** The configured scanner; `nullScanner` when clamd is not configured. */
export function getAssetScanner(): AssetScanner {
  return isClamavConfigured() ? clamavScanner : nullScanner;
}

/** Run a scan under the configured mode. Never throws. */
export async function scanAsset({
  bytes,
  filename,
  mimeType,
  mode = assetScanMode(),
}: {
  bytes: Buffer;
  filename: string;
  mimeType: string;
  mode?: AssetScanMode;
}): Promise<ScanResult> {
  if (mode === "off") {
    return { verdict: "skipped", signature: null, scanner: "none", detail: null };
  }
  if (!isClamavConfigured()) {
    // Fail closed: `enforce` callers treat this as blocking.
    return {
      verdict: "error",
      signature: null,
      scanner: "none",
      detail: "scanner_not_configured",
    };
  }
  try {
    return await getAssetScanner().scan(bytes, { filename, mimeType });
  } catch (error) {
    return {
      verdict: "error",
      signature: null,
      scanner: "clamav",
      detail: error instanceof Error ? error.message.slice(0, 200) : "scan_failed",
    };
  }
}

/** Whether a verdict must block an upload/send under the given mode. */
export function scanBlocked(
  result: ScanResult,
  mode: AssetScanMode = assetScanMode(),
): boolean {
  if (mode !== "enforce") return false;
  return result.verdict !== "clean" && result.verdict !== "skipped";
}
