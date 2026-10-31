import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  EmailDraft,
  EmailSummary,
  FullEmailProvider,
} from "@/lib/providers/email/types";

const connectedMailProviders = vi.fn();

vi.mock("@/lib/mail/accounts", () => ({
  connectedMailProviders: (...args: unknown[]) => connectedMailProviders(...args),
}));

import { createUnifiedEmailProvider } from "@/lib/providers/email/unified-provider";

function summary(overrides: Partial<EmailSummary> = {}): EmailSummary {
  return {
    id: "m1",
    threadId: "t1",
    from: { name: "Ada", email: "ada@example.com" },
    to: [{ name: "Me", email: "me@example.com" }],
    subject: "Subject",
    snippet: "snippet",
    receivedAt: new Date(2026, 0, 2).toISOString(),
    direction: "inbound",
    unread: false,
    starred: false,
    labels: [],
    hasAttachments: false,
    ...overrides,
  };
}

function draft(overrides: Partial<EmailDraft> = {}): EmailDraft {
  return {
    id: "d1",
    version: "v1",
    updatedAt: new Date(2026, 0, 2).toISOString(),
    to: ["ada@example.com"],
    cc: [],
    bcc: [],
    subject: "Hello",
    body: "Body",
    ...overrides,
  };
}

function provider(
  kind: "gmail" | "outlook",
  overrides: Partial<FullEmailProvider> = {},
): FullEmailProvider {
  return {
    kind,
    isConnected: async () => true,
    searchMessages: async () => ({ messages: [] }),
    getMessage: async () => {
      throw new Error("not used");
    },
    getThread: async () => {
      throw new Error("not used");
    },
    listCorrespondents: async () => [],
    getDraft: async () => draft(),
    listDrafts: async () => [],
    createDraft: async () => draft(),
    updateDraft: async () => draft(),
    archiveMessage: async () => undefined,
    trashMessage: async () => undefined,
    untrashMessage: async () => undefined,
    deleteMessage: async () => undefined,
    markRead: async () => undefined,
    setStarred: async () => undefined,
    addLabel: async () => undefined,
    removeLabel: async () => undefined,
    ...overrides,
  };
}

beforeEach(() => {
  connectedMailProviders.mockReset();
  connectedMailProviders.mockResolvedValue(["google", "microsoft"]);
});

describe("unified email provider", () => {
  it("merges both mailboxes and namespaces Outlook ids", async () => {
    const gmail = provider("gmail", {
      searchMessages: async () => ({
        messages: [
          summary({
            id: "g1",
            threadId: "gt1",
            receivedAt: new Date(2026, 0, 1).toISOString(),
          }),
        ],
      }),
    });
    const outlook = provider("outlook", {
      searchMessages: async () => ({
        messages: [
          summary({
            id: "o1",
            threadId: "ot1",
            receivedAt: new Date(2026, 0, 3).toISOString(),
          }),
        ],
      }),
    });

    const unified = createUnifiedEmailProvider({ gmail, outlook });
    const result = await unified.searchMessages({ userId: "u1", limit: 10 });

    expect(result.messages.map((message) => message.id)).toEqual([
      "outlook:o1",
      "g1",
    ]);
    expect(result.messages[0]!.threadId).toBe("outlook:ot1");
    expect(result.messages[0]!.provider).toBe("outlook");
    expect(result.messages[1]!.provider).toBe("gmail");
  });

  it("routes get_message by the Outlook id prefix", async () => {
    const getOutlook = vi.fn(async () => ({
      ...summary({ id: "o1", threadId: "ot1" }),
      bodyText: "body",
      attachments: [],
    }));
    const getGmail = vi.fn(async () => ({
      ...summary({ id: "g1", threadId: "gt1" }),
      bodyText: "body",
      attachments: [],
    }));
    const unified = createUnifiedEmailProvider({
      gmail: provider("gmail", { getMessage: getGmail }),
      outlook: provider("outlook", { getMessage: getOutlook }),
    });

    const outlook = await unified.getMessage({
      userId: "u1",
      messageId: "outlook:o1",
    });
    expect(getOutlook).toHaveBeenCalledWith({ userId: "u1", messageId: "o1" });
    expect(outlook.id).toBe("outlook:o1");

    const gmail = await unified.getMessage({ userId: "u1", messageId: "g1" });
    expect(getGmail).toHaveBeenCalledWith({ userId: "u1", messageId: "g1" });
    expect(gmail.id).toBe("g1");
  });

  it("creates a draft in the requested mailbox", async () => {
    const gmailDraft = vi.fn(async () => draft({ id: "g-draft" }));
    const outlookDraft = vi.fn(async () => draft({ id: "o-draft" }));
    const unified = createUnifiedEmailProvider({
      gmail: provider("gmail", { createDraft: gmailDraft }),
      outlook: provider("outlook", { createDraft: outlookDraft }),
    });

    const created = await unified.createDraft({
      userId: "u1",
      draft: {
        to: ["ada@example.com"],
        cc: [],
        bcc: [],
        subject: "Hi",
        body: "Hello",
        account: "outlook",
      },
    });

    expect(outlookDraft).toHaveBeenCalledTimes(1);
    expect(gmailDraft).not.toHaveBeenCalled();
    expect(created.id).toBe("outlook:o-draft");
  });

  it("strips a prefixed thread id before calling the Outlook draft API", async () => {
    const outlookDraft = vi.fn(
      async (_input: Parameters<FullEmailProvider["createDraft"]>[0]) =>
        draft({ id: "o-draft" }),
    );
    const unified = createUnifiedEmailProvider({
      gmail: provider("gmail"),
      outlook: provider("outlook", { createDraft: outlookDraft }),
    });

    await unified.createDraft({
      userId: "u1",
      draft: {
        to: ["ada@example.com"],
        cc: [],
        bcc: [],
        subject: "Re: Hi",
        body: "Hello",
        threadId: "outlook:conv-1",
      },
    });

    expect(outlookDraft.mock.calls[0]![0].draft.threadId).toBe("conv-1");
  });
});
