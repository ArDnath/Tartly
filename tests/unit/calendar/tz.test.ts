import { describe, expect, it } from "vitest";

import {
  addUtcDays,
  addUtcMinutes,
  formatSlotLabel,
  getIsoWeekday,
  getTimeZoneOffsetMs,
  getZonedParts,
  zonedTimeToUtc,
} from "@/lib/calendar/tz";

describe("getZonedParts", () => {
  it("returns wall-clock parts in the given zone", () => {
    const date = new Date("2026-01-05T10:30:00.000Z");
    expect(getZonedParts(date, "UTC")).toEqual({
      year: 2026,
      month: 1,
      day: 5,
      hour: 10,
      minute: 30,
    });
  });
});

describe("getTimeZoneOffsetMs", () => {
  it("is zero for UTC", () => {
    expect(getTimeZoneOffsetMs(new Date("2026-01-15T12:00:00.000Z"), "UTC")).toBe(0);
  });

  it("reflects standard and daylight offsets for New York", () => {
    // EST (UTC-5) in January, EDT (UTC-4) in July.
    expect(
      getTimeZoneOffsetMs(new Date("2026-01-15T12:00:00.000Z"), "America/New_York"),
    ).toBe(-5 * 60 * 60 * 1000);
    expect(
      getTimeZoneOffsetMs(new Date("2026-07-15T12:00:00.000Z"), "America/New_York"),
    ).toBe(-4 * 60 * 60 * 1000);
  });
});

describe("zonedTimeToUtc", () => {
  it("maps a UTC wall-clock time to itself", () => {
    expect(
      zonedTimeToUtc(
        { year: 2026, month: 1, day: 5, hour: 10, minute: 30 },
        "UTC",
      ).toISOString(),
    ).toBe("2026-01-05T10:30:00.000Z");
  });

  it("maps a New York winter wall-clock time across the offset", () => {
    expect(
      zonedTimeToUtc(
        { year: 2026, month: 1, day: 5, hour: 10, minute: 0 },
        "America/New_York",
      ).toISOString(),
    ).toBe("2026-01-05T15:00:00.000Z");
  });
});

describe("getIsoWeekday", () => {
  it("maps Monday=1 … Sunday=7", () => {
    expect(getIsoWeekday(new Date("2026-01-05T00:00:00.000Z"), "UTC")).toBe(1);
    expect(getIsoWeekday(new Date("2026-01-04T00:00:00.000Z"), "UTC")).toBe(7);
  });
});

describe("formatSlotLabel", () => {
  it("includes the day, time and zone", () => {
    const label = formatSlotLabel(new Date("2026-01-05T10:30:00.000Z"), "UTC");
    expect(label).toContain("Jan 5");
    expect(label).toContain("10:30");
    expect(label).toContain("UTC");
  });
});

describe("addUtcDays / addUtcMinutes", () => {
  it("adds whole days across DST safely", () => {
    expect(
      addUtcDays(new Date("2026-03-07T00:00:00.000Z"), 1).toISOString(),
    ).toBe("2026-03-08T00:00:00.000Z");
  });

  it("adds whole minutes", () => {
    expect(
      addUtcMinutes(new Date("2026-01-05T10:00:00.000Z"), 45).toISOString(),
    ).toBe("2026-01-05T10:45:00.000Z");
  });
});
