import { describe, expect, it } from "vitest";

import {
  DEFAULT_MEETING_MINS,
  extractEmails,
  parseWhen,
} from "@/lib/calendar/parse-when";

/** Compare a Date by its local wall-clock fields (parse-when uses local time). */
function localParts(date: Date) {
  return {
    y: date.getFullYear(),
    m: date.getMonth(),
    d: date.getDate(),
    h: date.getHours(),
    min: date.getMinutes(),
    s: date.getSeconds(),
  };
}

// Monday 5 Jan 2026, 10:30 local. All expectations are expressed in local time
// so the suite is timezone-agnostic.
const NOW = new Date(2026, 0, 5, 10, 30, 0);

describe("extractEmails", () => {
  it("extracts and de-duplicates addresses", () => {
    expect(
      extractEmails("cc alice@x.com and ALICE@x.com, bob+tag@sub.x.co"),
    ).toEqual(["alice@x.com", "ALICE@x.com", "bob+tag@sub.x.co"]);
  });

  it("returns [] when there is no address", () => {
    expect(extractEmails("no addresses here")).toEqual([]);
  });
});

describe("parseWhen", () => {
  it("returns null for text with no time reference", () => {
    expect(parseWhen("hello there", NOW)).toBeNull();
  });

  it("parses relative hours", () => {
    const slot = parseWhen("in 2 hours", NOW);
    expect(slot).not.toBeNull();
    expect(localParts(slot!.start)).toMatchObject({ d: 5, h: 12, min: 30, s: 0 });
    expect(slot!.end.getTime() - slot!.start.getTime()).toBe(
      DEFAULT_MEETING_MINS * 60_000,
    );
  });

  it("parses relative minutes and honours a custom duration", () => {
    const slot = parseWhen("in 30 minutes", NOW, 45);
    expect(localParts(slot!.start)).toMatchObject({ d: 5, h: 11, min: 0 });
    expect(slot!.end.getTime() - slot!.start.getTime()).toBe(45 * 60_000);
  });

  it("resolves tomorrow with an explicit clock", () => {
    const slot = parseWhen("tomorrow at 3pm", NOW);
    expect(localParts(slot!.start)).toMatchObject({ d: 6, h: 15, min: 0 });
  });

  it("resolves a bare future time to today", () => {
    const slot = parseWhen("3pm", NOW);
    expect(localParts(slot!.start)).toMatchObject({ d: 5, h: 15, min: 0 });
  });

  it("rolls a bare past time to tomorrow", () => {
    const slot = parseWhen("9am", NOW);
    expect(localParts(slot!.start)).toMatchObject({ d: 6, h: 9, min: 0 });
  });

  it("'next week' is seven days out at the default hour", () => {
    const slot = parseWhen("next week", NOW);
    expect(localParts(slot!.start)).toMatchObject({ d: 12, h: 9, min: 0 });
  });

  it("uses the next occurrence of a named weekday", () => {
    // NOW is a Monday; naming Monday itself means the following week.
    const slot = parseWhen("monday", NOW);
    expect(localParts(slot!.start)).toMatchObject({ d: 12, h: 9, min: 0 });
  });

  it("rejects an impossible clock with no day reference", () => {
    expect(parseWhen("at 25:00", NOW)).toBeNull();
  });
});
