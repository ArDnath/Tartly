import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MailMessage } from "@/lib/mail/types";

/**
 * Cursor pagination lives in the store, not the network. Mock the browser-side
 * client so the tests can drive `fetchMailbox` / `fetchMailboxPage` page by page
 * and assert the page walk (and its append-to-union bookkeeping) directly.
 */
const fetchMailbox = vi.fn();
const fetchMailboxPage = vi.fn();

vi.mock("@/lib/mail/client", () => ({
  fetchMailbox: (...args: unknown[]) => fetchMailbox(...args),
  fetchMailboxPage: (...args: unknown[]) => fetchMailboxPage(...args),
  errorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}));

import { mailFilterKey, useMailStore } from "@/components/mail/mail-store";

function message(id: string, box: MailMessage["box"] = "inbox"): MailMessage {
  return {
    id,
    box,
    from: { name: "Sender", email: "sender@example.com" },
    to: [{ name: "Me", email: "me@example.com" }],
    subject: `Subject ${id}`,
    preview: "",
    body: "",
    receivedAt: new Date(
      2026,
      0,
      Number(id.replace(/\D/g, "")) || 1,
    ).toISOString(),
    tag: "other",
    labels: [],
    unread: false,
    starred: false,
  };
}

function account() {
  return { name: "Me", email: "me@example.com" };
}

const ALL_KEY = mailFilterKey({ kind: "view", value: "all" });

function page(ids: string[], nextPageToken?: string) {
  return {
    messages: ids.map((id) => message(id)),
    labels: ["Inbox"],
    ...(nextPageToken ? { nextPageToken } : {}),
  };
}

beforeEach(() => {
  fetchMailbox.mockReset();
  fetchMailboxPage.mockReset();
  useMailStore.setState({
    messages: [],
    pages: {},
    pagers: {},
    loadingMore: false,
    status: "idle",
    error: null,
    labels: [],
    account: null,
    filter: { kind: "view", value: "all" },
    prefetchSettled: false,
  });
});

describe("hydrate", () => {
  it("seeds page one and keeps the server prefetch cursor", () => {
    useMailStore.getState().hydrate({
      messages: [message("1"), message("2")],
      labels: [],
      account: account(),
      nextPageToken: "page-2",
    });

    const pager = useMailStore.getState().pagers[ALL_KEY];
    expect(pager).toEqual({
      chunks: [["1", "2"]],
      index: 0,
      nextToken: "page-2",
    });
    expect(fetchMailbox).not.toHaveBeenCalled();
  });
});

describe("nextPage", () => {
  it("fetches the next page, moves the index, and advances the cursor", async () => {
    useMailStore.setState({
      messages: [message("1")],
      pages: { [ALL_KEY]: ["1"] },
      pagers: { [ALL_KEY]: { chunks: [["1"]], index: 0, nextToken: "page-2" } },
      status: "ready",
    });
    fetchMailboxPage.mockResolvedValueOnce(page(["2", "3"], "page-3"));

    await useMailStore.getState().nextPage();

    expect(fetchMailboxPage).toHaveBeenCalledWith({
      box: "inbox",
      pageToken: "page-2",
    });
    const state = useMailStore.getState();
    // The union keeps every page so the sidebar and mutations still see it…
    expect(state.messages.map((m) => m.id)).toEqual(["1", "2", "3"]);
    expect(state.pages[ALL_KEY]).toEqual(["1", "2", "3"]);
    // …while the pager points at the newly loaded chunk.
    expect(state.pagers[ALL_KEY]).toEqual({
      chunks: [["1"], ["2", "3"]],
      index: 1,
      nextToken: "page-3",
    });
    expect(state.loadingMore).toBe(false);
  });

  it("clears the cursor at the last page", async () => {
    useMailStore.setState({
      messages: [message("1")],
      pages: { [ALL_KEY]: ["1"] },
      pagers: { [ALL_KEY]: { chunks: [["1"]], index: 0, nextToken: "page-2" } },
      status: "ready",
    });
    fetchMailboxPage.mockResolvedValueOnce(page(["2"]));

    await useMailStore.getState().nextPage();

    expect(useMailStore.getState().pagers[ALL_KEY]?.nextToken).toBeUndefined();
  });

  it("is a no-op without a cursor", async () => {
    useMailStore.setState({
      messages: [message("1")],
      pages: { [ALL_KEY]: ["1"] },
      pagers: { [ALL_KEY]: { chunks: [["1"]], index: 0 } },
      status: "ready",
    });

    await useMailStore.getState().nextPage();

    expect(fetchMailboxPage).not.toHaveBeenCalled();
  });

  it("does not duplicate a message already held by another view", async () => {
    useMailStore.setState({
      messages: [message("1"), message("shared")],
      pages: { [ALL_KEY]: ["1"] },
      pagers: { [ALL_KEY]: { chunks: [["1"]], index: 0, nextToken: "page-2" } },
      status: "ready",
    });
    fetchMailboxPage.mockResolvedValueOnce(page(["shared", "2"], "page-3"));

    await useMailStore.getState().nextPage();

    const state = useMailStore.getState();
    expect(state.messages.map((m) => m.id)).toEqual(["1", "shared", "2"]);
    expect(state.pages[ALL_KEY]).toEqual(["1", "shared", "2"]);
  });

  it("reuses a visited page without refetching after going back", async () => {
    useMailStore.setState({
      messages: [message("1"), message("2")],
      pages: { [ALL_KEY]: ["1", "2"] },
      pagers: {
        [ALL_KEY]: { chunks: [["1"], ["2"]], index: 0, nextToken: "page-3" },
      },
      status: "ready",
    });

    await useMailStore.getState().nextPage();

    expect(fetchMailboxPage).not.toHaveBeenCalled();
    expect(useMailStore.getState().pagers[ALL_KEY]?.index).toBe(1);
  });
});

describe("prevPage", () => {
  it("steps back through the cache without a fetch", () => {
    useMailStore.setState({
      pagers: {
        [ALL_KEY]: { chunks: [["1"], ["2"]], index: 1, nextToken: "page-3" },
      },
    });

    useMailStore.getState().prevPage();

    expect(fetchMailboxPage).not.toHaveBeenCalled();
    expect(useMailStore.getState().pagers[ALL_KEY]?.index).toBe(0);
  });

  it("stays put on the first page", () => {
    useMailStore.setState({
      pagers: { [ALL_KEY]: { chunks: [["1"]], index: 0 } },
    });

    useMailStore.getState().prevPage();

    expect(useMailStore.getState().pagers[ALL_KEY]?.index).toBe(0);
  });
});

describe("load", () => {
  it("resets the walk to page one on a forced refresh", async () => {
    useMailStore.setState({
      messages: [message("1"), message("2")],
      pages: { [ALL_KEY]: ["1", "2"] },
      pagers: {
        [ALL_KEY]: { chunks: [["1"], ["2"]], index: 1, nextToken: "page-3" },
      },
      status: "ready",
    });
    fetchMailbox.mockResolvedValueOnce({
      messages: [message("1")],
      labels: [],
      account: account(),
      nextPageToken: "page-2",
    });

    await useMailStore.getState().load(true);

    const state = useMailStore.getState();
    expect(state.pages[ALL_KEY]).toEqual(["1"]);
    expect(state.messages.map((m) => m.id)).toEqual(["1"]);
    expect(state.pagers[ALL_KEY]).toEqual({
      chunks: [["1"]],
      index: 0,
      nextToken: "page-2",
    });
  });
});
