import { beforeEach, describe, expect, it } from "vitest";

import {
  autopilotMaxLoopThreshold,
  autopilotMaxPerThread,
} from "@/lib/env";
import { recordAutopilotDecisionMetric } from "@/lib/observability/autopilot-metrics";
import { renderPrometheus, resetMetricsForTests } from "@/lib/observability/metrics";
import {
  applyPolicyPatch,
  AUTOPILOT_REASON_LABELS,
  defaultAutopilotPolicy,
  isWithinSendWindow,
  policyFromRow,
} from "@/lib/settings/autopilot";
import type { AutopilotPolicyRow } from "@/lib/repositories/autopilot";

/**
 * Production-hardening regressions for the 24/7 autopilot path:
 *  - caps/loop threshold cannot be raised past the platform ceilings;
 *  - a corrupt timezone fails safe instead of throwing in the gate;
 *  - decision metrics are bounded-cardinality and content-free.
 */

function row(overrides: Partial<AutopilotPolicyRow> = {}): AutopilotPolicyRow {
  return {
    id: "p1",
    userId: "u1",
    mailboxId: "m1",
    enabled: true,
    mode: "window",
    timezone: "UTC",
    days: [1, 2, 3, 4, 5, 6, 7],
    windowStartHour: 22,
    windowEndHour: 7,
    minConfidence: "HIGH",
    requireKnownSender: true,
    allowedCategories: ["needs_reply"],
    maxPerHour: 10,
    maxPerDay: 50,
    maxPerThread: 3,
    loopThreshold: 3,
    morningReview: true,
    policyVersion: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as unknown as AutopilotPolicyRow;
}

describe("autopilot caps are clamped to platform ceilings", () => {
  it("applyPolicyPatch cannot raise the per-thread cap or loop threshold", () => {
    const current = defaultAutopilotPolicy({ id: "p1", mailboxId: "m1" });
    const patch = applyPolicyPatch(current, {
      maxPerThread: 999_999,
      loopThreshold: 999_999,
    });
    expect(patch.maxPerThread).toBe(autopilotMaxPerThread());
    expect(patch.loopThreshold).toBe(autopilotMaxLoopThreshold());
  });

  it("a persisted row above the ceiling is clamped on read", () => {
    const policy = policyFromRow(
      row({ maxPerThread: 500, loopThreshold: 500 }),
    );
    expect(policy.maxPerThread).toBeLessThanOrEqual(autopilotMaxPerThread());
    expect(policy.loopThreshold).toBeLessThanOrEqual(autopilotMaxLoopThreshold());
  });
});

describe("timezone safety", () => {
  it("falls back to UTC for a corrupt timezone instead of throwing", () => {
    const policy = policyFromRow(row({ timezone: "Not/AZone" }));
    expect(policy.timezone).toBe("UTC");
    expect(() => isWithinSendWindow(new Date(), policy)).not.toThrow();
  });
});

describe("autopilot decision metrics", () => {
  beforeEach(() => resetMetricsForTests());

  it("counts an allowed send", () => {
    recordAutopilotDecisionMetric({ allowed: true, reason: "autopilot" });
    expect(renderPrometheus()).toContain(
      'autopilot_decisions_total{decision="send",reason="autopilot"} 1',
    );
  });

  it("collapses guardrail families so cardinality stays bounded", () => {
    recordAutopilotDecisionMetric({
      allowed: false,
      reason: "guardrails:commitment_language:money",
    });
    const text = renderPrometheus();
    expect(text).toContain(
      'autopilot_decisions_total{decision="draft",reason="guardrails"} 1',
    );
    // The specific guardrail check must never become a label.
    expect(text).not.toContain("commitment_language");
  });

  it("flags cap hits and loop blocks separately", () => {
    recordAutopilotDecisionMetric({ allowed: false, reason: "hour_cap" });
    recordAutopilotDecisionMetric({ allowed: false, reason: "loop_detected" });
    const text = renderPrometheus();
    expect(text).toContain('autopilot_cap_hit_total{cap="hour"} 1');
    expect(text).toContain("autopilot_loop_blocked_total 1");
  });
});

describe("fail-safe reason", () => {
  it("has human copy for the fail-safe error reason", () => {
    expect(AUTOPILOT_REASON_LABELS.autopilot_error).toBeTruthy();
  });
});
