import { describe, expect, it } from "vitest";

import {
  isUnreachableAddress,
  nextDeliverableTime,
  type DeliverableWindow,
} from "@/lib/followup/rules";

describe("isUnreachableAddress", () => {
  it("treats missing and malformed addresses as unreachable", () => {
    expect(isUnreachableAddress(null)).toBe(true);
    expect(isUnreachableAddress(undefined)).toBe(true);
    expect(isUnreachableAddress("")).toBe(true);
    expect(isUnreachableAddress("not-an-email")).toBe(true);
  });

  it("excludes robot and bounce local parts", () => {
    for (const local of [
      "mailer-daemon",
      "postmaster",
      "no-reply",
      "noreply",
      "donotreply",
      "do-not-reply",
      "bounce",
      "notifications",
    ]) {
      expect(isUnreachableAddress(`${local}@example.com`)).toBe(true);
    }
  });

  it("handles plus-addressing and case", () => {
    expect(isUnreachableAddress("NO-REPLY+123@Example.com")).toBe(true);
  });

  it("accepts a normal person", () => {
    expect(isUnreachableAddress("alice@example.com")).toBe(false);
  });
});

const WINDOW: DeliverableWindow = {
  timeZone: "UTC",
  workDays: [1, 2, 3, 4, 5], // Mon–Fri
  workStartHour: 9,
  quietEndHour: 17,
};

describe("nextDeliverableTime", () => {
  it("leaves a time inside working hours unchanged", () => {
    const inside = new Date("2026-01-05T10:00:00.000Z"); // Monday 10:00
    expect(nextDeliverableTime(inside, WINDOW).toISOString()).toBe(
      inside.toISOString(),
    );
  });

  it("pushes an early-morning time to the work-start hour", () => {
    const early = new Date("2026-01-05T07:00:00.000Z"); // Monday 07:00
    expect(nextDeliverableTime(early, WINDOW).toISOString()).toBe(
      "2026-01-05T09:00:00.000Z",
    );
  });

  it("defers an after-hours time to the next workday", () => {
    const evening = new Date("2026-01-05T18:00:00.000Z"); // Monday 18:00
    expect(nextDeliverableTime(evening, WINDOW).toISOString()).toBe(
      "2026-01-06T09:00:00.000Z",
    );
  });

  it("defers weekends to Monday morning", () => {
    const saturday = new Date("2026-01-03T12:00:00.000Z");
    expect(nextDeliverableTime(saturday, WINDOW).toISOString()).toBe(
      "2026-01-05T09:00:00.000Z",
    );
  });
});
