import { describe, expect, it } from "vitest";

import {
  calendarQuotaUnits,
  fullJitterDelayMs,
  gmailQuotaUnits,
  isRetryableGoogleStatus,
  refillPerMs,
} from "@/lib/google/quota";

describe("google/quota pure helpers", () => {
  it("converts a per-minute ceiling to a per-millisecond refill", () => {
    expect(refillPerMs(6_000)).toBeCloseTo(0.1);
    expect(refillPerMs(60_000)).toBeCloseTo(1);
  });

  it("uses capped exponential backoff with full jitter", () => {
    const half = () => 0.5;
    expect(fullJitterDelayMs(0, 250, 4_000, half)).toBe(125);
    expect(fullJitterDelayMs(3, 250, 4_000, half)).toBe(1_000);
    // 250 * 2^9 would exceed the cap; the cap wins.
    expect(fullJitterDelayMs(9, 250, 4_000, half)).toBe(2_000);
    // Full jitter can produce zero at the low end.
    expect(fullJitterDelayMs(0, 250, 4_000, () => 0)).toBe(0);
  });

  it("retries only transient statuses and quota-reason 403s", () => {
    expect(isRetryableGoogleStatus(429)).toBe(true);
    expect(isRetryableGoogleStatus(500)).toBe(true);
    expect(isRetryableGoogleStatus(503)).toBe(true);
    expect(isRetryableGoogleStatus(403, [])).toBe(false);
    expect(isRetryableGoogleStatus(403, ["rateLimitExceeded"])).toBe(true);
    expect(isRetryableGoogleStatus(403, ["userRateLimitExceeded"])).toBe(true);
    expect(isRetryableGoogleStatus(403, ["accessNotConfigured"])).toBe(false);
    expect(isRetryableGoogleStatus(400)).toBe(false);
    expect(isRetryableGoogleStatus(404)).toBe(false);
    expect(isRetryableGoogleStatus(401)).toBe(false);
  });

  it("prices Gmail calls by method", () => {
    expect(gmailQuotaUnits("/messages/send", "POST")).toBe(100);
    expect(gmailQuotaUnits("/messages/batchModify", "POST")).toBe(50);
    expect(gmailQuotaUnits("/messages?q=in:inbox")).toBe(5);
    expect(gmailQuotaUnits("/messages/abc123?format=full")).toBe(5);
    expect(gmailQuotaUnits("/threads/abc123")).toBe(10);
    expect(gmailQuotaUnits("/drafts", "GET")).toBe(5);
    expect(gmailQuotaUnits("/drafts", "POST")).toBe(10);
    expect(gmailQuotaUnits("/drafts/abc", "PUT")).toBe(15);
    expect(gmailQuotaUnits("/drafts/abc", "DELETE")).toBe(10);
    expect(gmailQuotaUnits("/labels")).toBe(1);
    expect(gmailQuotaUnits("/watch", "POST")).toBe(1);
    expect(gmailQuotaUnits("/history?startHistoryId=1")).toBe(2);
    expect(gmailQuotaUnits("/something-unknown")).toBe(5);
  });

  it("counts each Calendar call as one query", () => {
    expect(calendarQuotaUnits("/calendars/primary/events")).toBe(1);
    expect(calendarQuotaUnits("/freeBusy", "POST")).toBe(1);
  });
});
