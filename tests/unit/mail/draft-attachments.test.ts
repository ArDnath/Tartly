import { describe, expect, it } from "vitest";

import { MAX_OUTBOUND_ASSETS } from "@/lib/assets/limits";
import {
  mailAttachmentImportBody,
  mailCreateDraftBody,
  mailSendBody,
} from "@/lib/api/contracts/mail";

describe("mail draft attachments", () => {
  it("keeps library attachment ids on a saved draft", () => {
    const parsed = mailCreateDraftBody.parse({
      to: ["ada@example.com"],
      subject: "Report",
      body: "See attached.",
      assetIds: ["asset-1"],
      inlineImageIds: ["image-1"],
    });

    expect(parsed.assetIds).toEqual(["asset-1"]);
    expect(parsed.inlineImageIds).toEqual(["image-1"]);
  });

  it("caps attachments at the shared outbound limit", () => {
    const tooMany = Array.from(
      { length: MAX_OUTBOUND_ASSETS + 1 },
      (_, index) => `asset-${index}`,
    );

    expect(
      mailSendBody.safeParse({
        to: ["ada@example.com"],
        assetIds: tooMany,
      }).success,
    ).toBe(false);
    expect(
      mailCreateDraftBody.safeParse({
        to: ["ada@example.com"],
        assetIds: tooMany,
      }).success,
    ).toBe(false);
  });
});

describe("mail attachment import", () => {
  it("requires the owning message and attachment ids", () => {
    const parsed = mailAttachmentImportBody.parse({
      messageId: "message-1",
      attachmentId: "attachment-1",
      filename: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });

    expect(parsed.filename).toBe("report.pdf");
    expect(
      mailAttachmentImportBody.safeParse({ messageId: "message-1" }).success,
    ).toBe(false);
  });
});
