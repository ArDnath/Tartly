import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAsset: vi.fn(),
  readAssetBytes: vi.fn(),
  getExtractedText: vi.fn(),
  canExtract: vi.fn(),
  extractText: vi.fn(),
}));
const { getAsset, readAssetBytes, getExtractedText, canExtract, extractText } =
  mocks;

vi.mock("@/lib/assets/service", () => ({
  getAsset: mocks.getAsset,
  readAssetBytes: mocks.readAssetBytes,
}));
vi.mock("@/lib/assets/pipeline", () => ({
  getExtractedText: mocks.getExtractedText,
}));
vi.mock("@/lib/assets/extract", () => ({
  canExtract: mocks.canExtract,
  extractText: mocks.extractText,
}));
vi.mock("@/lib/env", () => ({
  isAssetsEnabled: () => true,
  assetExtractMaxChars: () => 100_000,
}));

import {
  attachmentPartFromAsset,
  expandStoredMessagesWithAttachments,
  loadChatAttachments,
} from "@/lib/agent/attachments";
import type { ChatAttachmentPart } from "@/lib/db/schema";

function asset(overrides: Record<string, unknown> = {}) {
  return {
    id: "asset-1",
    kind: "file",
    filename: "report.pdf",
    mimeType: "application/pdf",
    sizeBytes: 12,
    scanStatus: "skipped",
    ...overrides,
  };
}

function attachment(overrides: Partial<ChatAttachmentPart> = {}): ChatAttachmentPart {
  return {
    type: "attachment",
    assetId: "asset-1",
    kind: "file",
    filename: "report.pdf",
    mimeType: "application/pdf",
    sizeBytes: 12,
    ...overrides,
  };
}

describe("agent/attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("turns an owned asset into a transcript reference", () => {
    expect(attachmentPartFromAsset(asset() as never)).toEqual({
      type: "attachment",
      assetId: "asset-1",
      kind: "file",
      filename: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
    });
  });

  it("drops unknown and infected assets", async () => {
    getAsset
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(asset({ id: "asset-2", scanStatus: "infected" }))
      .mockResolvedValueOnce(asset({ id: "asset-3" }));

    const result = await loadChatAttachments({
      userId: "user-1",
      assetIds: ["missing", "asset-2", "asset-3"],
    });

    expect(result.parts.map((part) => part.assetId)).toEqual(["asset-3"]);
    expect(result.rejectedIds).toEqual(["missing", "asset-2"]);
  });

  it("expands a PDF into delimited text", async () => {
    getExtractedText.mockResolvedValue({
      text: "Quarterly revenue was 42.",
      parser: "application/pdf",
      truncated: false,
      charCount: 25,
    });

    const [message] = await expandStoredMessagesWithAttachments({
      userId: "user-1",
      messages: [
        {
          id: "m1",
          role: "user",
          createdAt: new Date().toISOString(),
          hidden: false,
          parts: [
            { type: "text", text: "Summarize this" },
            attachment(),
          ],
        },
      ],
    });

    const text = message!.parts
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("");
    expect(text).toContain("Summarize this");
    expect(text).toContain('<attachment name="report.pdf"');
    expect(text).toContain("Quarterly revenue was 42.");
    // The reference itself is not sent to the model.
    expect(
      message!.parts.some(
        (part) => (part as { type?: string }).type === "attachment",
      ),
    ).toBe(false);
  });

  it("sends images only on the newest attachment turn", async () => {
    readAssetBytes.mockResolvedValue({
      asset: asset({ kind: "image", filename: "chart.png", mimeType: "image/png" }),
      body: Buffer.from([1, 2, 3]),
    });

    const image = attachment({
      kind: "image",
      filename: "chart.png",
      mimeType: "image/png",
    });

    const messages = await expandStoredMessagesWithAttachments({
      userId: "user-1",
      messages: [
        {
          id: "m1",
          role: "user",
          createdAt: "2026-01-01T00:00:00.000Z",
          hidden: false,
          parts: [{ type: "text", text: "First" }, image],
        },
        {
          id: "m2",
          role: "assistant",
          createdAt: "2026-01-01T00:00:01.000Z",
          hidden: false,
          parts: [{ type: "text", text: "Okay" }],
        },
        {
          id: "m3",
          role: "user",
          createdAt: "2026-01-01T00:00:02.000Z",
          hidden: false,
          parts: [{ type: "text", text: "What is in it?" }, image],
        },
      ],
    });

    const firstParts = messages[0]!.parts;
    expect(firstParts.some((part) => part.type === "file")).toBe(false);
    expect(
      firstParts.some(
        (part) => part.type === "text" && part.text.includes("Earlier"),
      ),
    ).toBe(true);

    const lastFilePart = messages[2]!.parts.find((part) => part.type === "file");
    expect(lastFilePart).toMatchObject({
      type: "file",
      mediaType: "image/png",
      filename: "chart.png",
    });
    expect(
      lastFilePart?.type === "file" ? lastFilePart.url : "",
    ).toMatch(/^data:image\/png;base64,/);
  });

  it("parses a document on demand when stored extraction is absent", async () => {
    getExtractedText.mockResolvedValue(null);
    canExtract.mockReturnValue(true);
    extractText.mockResolvedValue({
      text: "On-demand PDF body",
      parser: "application/pdf",
    });
    readAssetBytes.mockResolvedValue({
      asset: asset(),
      body: Buffer.from("pdf"),
    });

    const [message] = await expandStoredMessagesWithAttachments({
      userId: "user-1",
      messages: [
        {
          id: "m1",
          role: "user",
          createdAt: new Date().toISOString(),
          hidden: false,
          parts: [attachment()],
        },
      ],
    });

    const text = message!.parts
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("");
    expect(text).toContain("On-demand PDF body");
    // A file-only turn still gets an explicit instruction for the model.
    expect(text).toContain("without a message");
  });
});
