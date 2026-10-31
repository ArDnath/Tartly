import { describe, expect, it } from "vitest";

import type { OutlookTransport } from "@/lib/outlook/client";
import { sendOutlookMail } from "@/lib/outlook/service";

type Call = { path: string; init?: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function transportFor(
  calls: Call[],
  handlers: Record<string, (init?: RequestInit) => Response> = {},
): OutlookTransport {
  return async (_userId, path, init) => {
    calls.push({ path, ...(init ? { init } : {}) });
    const handler = handlers[path];
    if (handler) return handler(init);
    if (path === "/me/messages") return jsonResponse({ id: "draft-1" }, 201);
    if (path === "/me/sendMail") return new Response(null, { status: 202 });
    if (path.endsWith("/attachments")) return jsonResponse({}, 201);
    if (path.endsWith("/send")) return new Response(null, { status: 202 });
    if (path.endsWith("/createUploadSession")) {
      return jsonResponse({ uploadUrl: "https://upload.example/session" }, 201);
    }
    if (path === "https://upload.example/session") {
      return new Response(null, { status: 200 });
    }
    throw new Error(`Unexpected Graph path: ${path}`);
  };
}

describe("sendOutlookMail", () => {
  it("uses sendMail when there are no attachments", async () => {
    const calls: Call[] = [];
    await sendOutlookMail(
      "user-1",
      {
        to: ["ada@example.com"],
        subject: "Hello",
        body: "Body",
      },
      transportFor(calls),
    );

    expect(calls.map((call) => call.path)).toEqual(["/me/sendMail"]);
  });

  it("attaches a small file to a draft before sending it", async () => {
    const calls: Call[] = [];
    await sendOutlookMail(
      "user-1",
      {
        to: ["ada@example.com"],
        subject: "Report",
        body: "See attached.",
        attachments: [
          {
            filename: "report.pdf",
            mimeType: "application/pdf",
            content: Buffer.from("pdf"),
          },
        ],
      },
      transportFor(calls),
    );

    expect(calls.map((call) => call.path)).toEqual([
      "/me/messages",
      "/me/messages/draft-1/attachments",
      "/me/messages/draft-1/send",
    ]);
    const attachment = JSON.parse(String(calls[1]!.init!.body)) as {
      name: string;
      contentBytes: string;
    };
    expect(attachment.name).toBe("report.pdf");
    expect(Buffer.from(attachment.contentBytes, "base64").toString()).toBe("pdf");
  });

  it("uses an upload session for files above 3 MB", async () => {
    const calls: Call[] = [];
    const content = Buffer.alloc(5 * 1024 * 1024, 1);

    await sendOutlookMail(
      "user-1",
      {
        to: ["ada@example.com"],
        subject: "Large",
        body: "See attached.",
        attachments: [
          { filename: "large.pdf", mimeType: "application/pdf", content },
        ],
      },
      transportFor(calls),
    );

    expect(calls.map((call) => call.path)).toEqual([
      "/me/messages",
      "/me/messages/draft-1/attachments/createUploadSession",
      "https://upload.example/session",
      "https://upload.example/session",
      "/me/messages/draft-1/send",
    ]);

    const ranges = calls
      .filter((call) => call.path === "https://upload.example/session")
      .map((call) => (call.init?.headers as Record<string, string>)["Content-Range"]);
    expect(ranges).toEqual([
      `bytes 0-${4 * 1024 * 1024 - 1}/${content.length}`,
      `bytes ${4 * 1024 * 1024}-${content.length - 1}/${content.length}`,
    ]);
  });
});
