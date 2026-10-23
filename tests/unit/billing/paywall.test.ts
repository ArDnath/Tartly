import { afterEach, describe, expect, it, vi } from "vitest";

import { isActiveSubscriptionStatus, subscriptionIsEntitled } from "@/lib/billing/entitlements";
import { BILLING_PLAN, isBillingInterval } from "@/lib/billing/plans";
import { signSimCheckout, verifySimCheckout } from "@/lib/billing/sim";
import { isPaywallGatedEmail, paywallGatedEmails } from "@/lib/env";

describe("paywall allowlist", () => {
  it("gates every account when the allowlist is empty (the default)", () => {
    expect(paywallGatedEmails()).toEqual([]);
    expect(isPaywallGatedEmail("ariyamandebnath.ad@gmail.com")).toBe(true);
    expect(isPaywallGatedEmail("someone.else@example.com")).toBe(true);
  });

  it("gates an unknown email rather than exempting it", () => {
    expect(isPaywallGatedEmail(null)).toBe(true);
    expect(isPaywallGatedEmail("")).toBe(true);
  });

  it("gates only the listed accounts when an allowlist is set (case-insensitive)", async () => {
    const original = process.env.PAYWALL_GATED_EMAILS;
    process.env.PAYWALL_GATED_EMAILS =
      "owner@example.com, Other@Example.com ";
    vi.resetModules();
    try {
      const env = await import("@/lib/env");
      expect(env.paywallGatedEmails()).toEqual([
        "owner@example.com",
        "other@example.com",
      ]);
      expect(env.isPaywallGatedEmail("owner@example.com")).toBe(true);
      expect(env.isPaywallGatedEmail("OWNER@EXAMPLE.COM")).toBe(true);
      expect(env.isPaywallGatedEmail("other@example.com")).toBe(true);
      expect(env.isPaywallGatedEmail("someone.else@example.com")).toBe(false);
    } finally {
      if (original === undefined) delete process.env.PAYWALL_GATED_EMAILS;
      else process.env.PAYWALL_GATED_EMAILS = original;
      vi.resetModules();
    }
  });
});

describe("billing test-mode lock", () => {
  const originalEnv = { ...process.env };

  // `lib/env.ts` validates `process.env` at import. Switching a value therefore
  // needs a fresh module instance, so these helpers reset the module registry
  // before each dynamic import.
  async function loadEnvWith(vars: Record<string, string | undefined>) {
    vi.resetModules();
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await import("@/lib/env");
  }

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("recognises test and live keys by prefix", async () => {
    const env = await loadEnvWith({ DODO_PAYMENTS_API_KEY: undefined });
    expect(env.isDodoTestKey("dodo_test_123")).toBe(true);
    expect(env.isDodoTestKey("dodo_live_123")).toBe(false);
    expect(env.isDodoLiveKey("dodo_live_123")).toBe(true);
    expect(env.isDodoLiveKey("dodo_test_123")).toBe(false);
    expect(env.isDodoTestKey(null)).toBe(false);
    expect(env.isDodoTestKey(undefined)).toBe(false);
  });

  it("honours a test key and defaults to the test environment", async () => {
    const env = await loadEnvWith({
      DODO_PAYMENTS_API_KEY: "dodo_test_abc",
      DODO_PAYMENTS_ENVIRONMENT: undefined,
      DODO_LIVE_MODE_ENABLED: undefined,
      BILLING_SIMULATION: undefined,
    });
    expect(env.isDodoConfigured()).toBe(true);
    expect(env.dodoEnvironment()).toBe("test_mode");
  });

  it("refuses an explicitly live key unless live mode is fully enabled", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const locked = await loadEnvWith({
        DODO_PAYMENTS_API_KEY: "dodo_live_abc",
        DODO_PAYMENTS_ENVIRONMENT: "live_mode",
        DODO_LIVE_MODE_ENABLED: undefined,
      });
      expect(locked.isDodoConfigured()).toBe(false);
      expect(locked.dodoEnvironment()).toBe("test_mode");

      const halfEnabled = await loadEnvWith({
        DODO_PAYMENTS_API_KEY: "dodo_live_abc",
        DODO_PAYMENTS_ENVIRONMENT: undefined,
        DODO_LIVE_MODE_ENABLED: "true",
      });
      expect(halfEnabled.isDodoConfigured()).toBe(false);
      expect(halfEnabled.dodoEnvironment()).toBe("test_mode");

      const unlocked = await loadEnvWith({
        DODO_PAYMENTS_API_KEY: "dodo_live_abc",
        DODO_PAYMENTS_ENVIRONMENT: "live_mode",
        DODO_LIVE_MODE_ENABLED: "true",
      });
      expect(unlocked.isDodoConfigured()).toBe(true);
      expect(unlocked.dodoEnvironment()).toBe("live_mode");
    } finally {
      warn.mockRestore();
    }
  });

  it("stays in simulation when forced, even with a test key", async () => {
    const env = await loadEnvWith({
      DODO_PAYMENTS_API_KEY: "dodo_test_abc",
      BILLING_SIMULATION: "true",
    });
    expect(env.isDodoConfigured()).toBe(false);
  });
});

describe("subscription status", () => {
  it("entitles active and past_due (grace period)", () => {
    expect(isActiveSubscriptionStatus("active")).toBe(true);
    expect(isActiveSubscriptionStatus("past_due")).toBe(true);
    for (const status of [
      "none",
      "pending",
      "on_hold",
      "paused",
      "cancelled",
      "failed",
      "expired",
      null,
      undefined,
    ]) {
      expect(isActiveSubscriptionStatus(status)).toBe(false);
    }
  });

  it("keeps access until a scheduled cancellation actually ends", () => {
    const future = new Date(Date.now() + 86_400_000);
    const past = new Date(Date.now() - 86_400_000);
    expect(
      subscriptionIsEntitled({
        status: "cancelled",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: future,
      }),
    ).toBe(true);
    expect(
      subscriptionIsEntitled({
        status: "cancelled",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: past,
      }),
    ).toBe(false);
    expect(
      subscriptionIsEntitled({
        status: "active",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: past,
      }),
    ).toBe(true);
    expect(
      subscriptionIsEntitled({
        status: "on_hold",
        cancelAtPeriodEnd: false,
        currentPeriodEnd: future,
      }),
    ).toBe(false);
  });
});

describe("billing plan", () => {
  it("prices monthly at $25 and yearly at $20/month ($240 total)", () => {
    expect(BILLING_PLAN.prices.month.amountUsd).toBe(25);
    expect(BILLING_PLAN.prices.year.amountUsd).toBe(20);
    expect(BILLING_PLAN.prices.year.totalUsd).toBe(240);
  });

  it("accepts only month and year intervals", () => {
    expect(isBillingInterval("month")).toBe(true);
    expect(isBillingInterval("year")).toBe(true);
    expect(isBillingInterval("week")).toBe(false);
    expect(isBillingInterval(undefined)).toBe(false);
    expect(isBillingInterval(42)).toBe(false);
  });
});

describe("simulation checkout token", () => {
  it("round-trips a signed token", () => {
    const token = signSimCheckout({ userId: "user-1", interval: "year" });
    const payload = verifySimCheckout(token);
    expect(payload?.userId).toBe("user-1");
    expect(payload?.interval).toBe("year");
  });

  it("rejects a tampered payload", () => {
    const token = signSimCheckout({ userId: "user-1", interval: "month" });
    const [, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        userId: "attacker",
        interval: "year",
        exp: Date.now() + 60_000,
      }),
    ).toString("base64url");
    expect(verifySimCheckout(`${forged}.${signature}`)).toBeNull();
  });

  it("rejects garbage and missing signatures", () => {
    expect(verifySimCheckout("")).toBeNull();
    expect(verifySimCheckout("not-a-token")).toBeNull();
    expect(verifySimCheckout("abc.def")).toBeNull();
  });
});
