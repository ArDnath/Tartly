import { describe, expect, it } from "vitest";

import {
  conversationKey,
  conversationMessageIds,
  groupConversations,
  lastInbound,
  normalizeSubject,
} from "@/lib/mail/conversations";
import { conversationCount } from "@/lib/mail/filter";
import type { MailMessage } from "@/lib/mail/types";

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

describe("normalizeSubject", () => {
  it("strips reply and forward prefixes", () => {
    expect(normalizeSubject("Re: Fwd: Quarterly plan")).toBe("Quarterly plan");
    expect(normalizeSubject("RE: RE: hi")).toBe("hi");
  });

  it("keeps a subject with no prefix", () => {
    expect(normalizeSubject("Invoice 42")).toBe("Invoice 42");
  });
});

describe("conversationKey", () => {
  it("prefers the thread id and falls back to the message id", () => {
    expect(conversationKey(message())).toBe("t1");
    expect(conversationKey(message({ threadId: "" }))).toBe("m1");
  });
});

describe("groupConversations", () => {
  it("folds messages sharing a thread into one conversation, newest first", () => {
    const conversations = groupConversations([
      message({ id: "m1", receivedAt: new Date(2026, 0, 1).toISOString() }),
      message({
        id: "m2",
        receivedAt: new Date(2026, 0, 3).toISOString(),
        subject: "Re: Subject",
      }),
      message({ id: "m9", threadId: "t2", receivedAt: new Date(2026, 0, 2).toISOString() }),
    ]);

    expect(conversations).toHaveLength(2);
    // t1's newest message (Jan 3) outranks t2 (Jan 2).
    expect(conversations[0]!.threadId).toBe("t1");
    expect(conversations[0]!.messageCount).toBe(2);
    expect(conversations[0]!.messages.map((m) => m.id)).toEqual(["m2", "m1"]);
    // The list shows the base subject, not "Re: Subject".
    expect(conversations[0]!.subject).toBe("Subject");
  });

  it("is unread/starred/attachment positive if any message is", () => {
    const [conversation] = groupConversations([
      message({ id: "m1" }),
      message({
        id: "m2",
        unread: true,
        starred: true,
        attachments: [{ id: "a1", name: "plan.pdf", size: "1 KB" }],
      }),
    ]);

    expect(conversation!.unread).toBe(true);
    expect(conversation!.starred).toBe(true);
    expect(conversation!.hasAttachments).toBe(true);
  });

  it("names each participant once, newest first, and labels the mailbox 'me'", () => {
    const [conversation] = groupConversations(
      [
        message({ id: "m1", from: { name: "Ada", email: "ada@example.com" } }),
        message({
          id: "m2",
          box: "sent",
          from: { name: "Owner", email: "me@example.com" },
        }),
        message({ id: "m3", from: { name: "Ada", email: "ada@example.com" } }),
      ],
      { selfEmail: "me@example.com" },
    );

    expect(conversation!.participants.map((p) => p.name)).toEqual([
      "Ada",
      "me",
    ]);
    expect(conversation!.senderLine).toBe("Ada, me");
  });

  it("finds the newest message that wasn't sent by this mailbox", () => {
    const [conversation] = groupConversations([
      message({ id: "m2", box: "sent" }),
      message({ id: "m1", box: "inbox" }),
    ]);
    expect(lastInbound(conversation!)?.id).toBe("m1");
  });
});

describe("conversationMessageIds", () => {
  it("returns every message id in the conversation", () => {
    const [conversation] = groupConversations([
      message({ id: "m1" }),
      message({ id: "m2" }),
    ]);
    expect(conversationMessageIds(conversation!).sort()).toEqual(["m1", "m2"]);
  });
});

describe("conversationCount", () => {
  it("counts distinct conversations among selected message ids", () => {
    const messages = [
      message({ id: "m1", threadId: "t1" }),
      message({ id: "m2", threadId: "t1" }),
      message({ id: "m3", threadId: "t2" }),
    ];
    expect(conversationCount(messages, ["m1", "m2", "m3"])).toBe(2);
    expect(conversationCount(messages, [])).toBe(0);
  });
});
