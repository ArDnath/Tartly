import { describe, expect, it } from "vitest";

import { selectConversations } from "@/lib/mail/filter";
import { EMPTY_MAIL_QUERY, type MailMessage } from "@/lib/mail/types";

function message(overrides: Partial<MailMessage> = {}): MailMessage {
  return {
    id: "m1",
    threadId: "t1",
    box: "inbox",
    from: { name: "Ada", email: "ada@example.com" },
    to: [{ name: "Me", email: "me@example.com" }],
    subject: "Subject",
    preview: "",
    body: "",
    receivedAt: new Date(2026, 0, 2).toISOString(),
    tag: "other",
    labels: [],
    unread: false,
    starred: false,
    ...overrides,
  };
}

const messages = [
  message({ id: "g1", threadId: "gt1", provider: "gmail" }),
  message({ id: "o1", threadId: "ot1", provider: "outlook" }),
  // Legacy rows without a provider are Gmail.
  message({ id: "legacy", threadId: "lt1" }),
];

describe("shared-inbox account filter", () => {
  it("returns both providers for All mail", () => {
    const rows = selectConversations(
      messages,
      { kind: "view", value: "all" },
      EMPTY_MAIL_QUERY,
      null,
      null,
      "all",
    );
    expect(rows.map((row) => row.threadId).sort()).toEqual([
      "gt1",
      "lt1",
      "ot1",
    ]);
    // The conversation carries the provider so the row badge can render it.
    expect(rows.find((row) => row.threadId === "ot1")?.provider).toBe(
      "outlook",
    );
  });

  it("returns only Gmail rows for the Gmail scope", () => {
    const rows = selectConversations(
      messages,
      { kind: "view", value: "all" },
      EMPTY_MAIL_QUERY,
      null,
      null,
      "gmail",
    );
    expect(rows.map((row) => row.threadId).sort()).toEqual(["gt1", "lt1"]);
  });

  it("returns only Outlook rows for the Outlook scope", () => {
    const rows = selectConversations(
      messages,
      { kind: "view", value: "all" },
      EMPTY_MAIL_QUERY,
      null,
      null,
      "outlook",
    );
    expect(rows.map((row) => row.threadId)).toEqual(["ot1"]);
  });
});
