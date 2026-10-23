import { describe, expect, it } from "vitest";

import {
  CREDIT_PACKS,
  PLAN_CREDIT_GRANTS,
  USD_PER_CREDIT,
  creditsForPurchase,
  creditsForUsage,
  findCreditPack,
  formatCredits,
  usdForCredits,
} from "@/lib/billing/credit-config";

describe("credit pricing", () => {
  it("halves a purchase at the default 50% margin", () => {
    // $20 paid → $10 of credits → 1000 credits at $0.01 each.
    expect(creditsForPurchase(20)).toBe(1000);
    expect(creditsForPurchase(10)).toBe(500);
    expect(usdForCredits(1000)).toBe(10);
    expect(USD_PER_CREDIT).toBe(0.01);
  });

  it("derives the plan grants from the plan price with the same margin", () => {
    expect(PLAN_CREDIT_GRANTS.month).toBe(creditsForPurchase(25));
    expect(PLAN_CREDIT_GRANTS.year).toBe(creditsForPurchase(240));
  });

  it("lists top-up packs with consistent credit amounts", () => {
    for (const pack of CREDIT_PACKS) {
      expect(pack.credits).toBe(creditsForPurchase(pack.usd));
    }
    expect(findCreditPack("plus")?.credits).toBe(1000);
    expect(findCreditPack("nope")).toBeUndefined();
  });
});

describe("usage → credits", () => {
  it("charges deepseek input/output at the retail rate", () => {
    // 1M input tokens = $1 retail = 100 credits.
    expect(
      creditsForUsage({ model: "deepseek-v4-flash", promptTokens: 1_000_000 }),
    ).toBe(100);
    // 1M output tokens = $4 retail = 400 credits.
    expect(
      creditsForUsage({
        model: "deepseek-v4-flash",
        completionTokens: 1_000_000,
      }),
    ).toBe(400);
  });

  it("charges the reasoning model more than flash", () => {
    const flash = creditsForUsage({
      model: "deepseek-v4-flash",
      promptTokens: 100_000,
    });
    const pro = creditsForUsage({
      model: "deepseek-v4-pro",
      promptTokens: 100_000,
    });
    expect(pro).toBeGreaterThan(flash);
  });

  it("always charges at least one credit for a call with tokens", () => {
    expect(
      creditsForUsage({ model: "deepseek-v4-flash", promptTokens: 1 }),
    ).toBe(1);
    expect(creditsForUsage({ model: "deepseek-v4-flash" })).toBe(0);
  });

  it("formats balances for display", () => {
    expect(formatCredits(1250)).toBe("1,250");
    expect(formatCredits(-5)).toBe("0");
  });
});
