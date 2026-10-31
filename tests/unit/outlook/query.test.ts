import { afterEach, describe, expect, it, vi } from "vitest";

import { toGraphSearchQuery } from "@/lib/outlook/service";

describe("toGraphSearchQuery", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("translates relative dates into Graph KQL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));

    expect(toGraphSearchQuery("newer_than:7d invoice")).toBe(
      "received>=2026-03-08 invoice",
    );
  });

  it("translates Gmail state and attachment operators", () => {
    expect(
      toGraphSearchQuery("is:unread has:attachment from:jane@acme.com"),
    ).toBe("isRead:false hasAttachments:true from:jane@acme.com");
  });

  it("drops Gmail-only mailbox/label terms but keeps free text", () => {
    expect(toGraphSearchQuery("in:inbox label:Investors pricing")).toBe(
      "pricing",
    );
  });

  it("leaves plain text untouched", () => {
    expect(toGraphSearchQuery("quarterly plan")).toBe("quarterly plan");
  });
});
