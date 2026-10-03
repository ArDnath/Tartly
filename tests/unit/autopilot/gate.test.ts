import { describe, expect, it } from "vitest";

import {
  applyPolicyPatch,
  autopilotWindowStart,
  defaultAutopilotPolicy,
  evaluateAutopilotGate,
  isWithinSendWindow,
  type AutopilotGateInput,
  type AutopilotPolicy,
} from "@/lib/settings/autopilot";
import {
  evaluateAutoResponder,
  evaluateCommitmentLanguage,
} from "@/lib/engine/steps/guardrails";

function policy(overrides: Partial<AutopilotPolicy> = {}): AutopilotPolicy {
  return { ...defaultAutopilotPolicy({ id: "p1", mailboxId: "m1" }), enabled: true, ...overrides };
}

function input(overrides: Partial<AutopilotGateInput> = {}): AutopilotGateInput {
  return {
    now: new Date("2026-01-15T03:00:00Z"), // 22:00 America/New_York (winter)
    policy: policy({ timezone: "America/New_York" }),
    globalEnabled: true,
    category: "needs_reply",
    confidence: "HIGH",
    contactEmail: "known@example.com",
    knownSender: true,
    guardrailViolations: [],
    sentLastHour: 0,
    sentLastDay: 0,
    sentInThread: 0,
    consecutiveAutomatedExchanges: 0,
    ...overrides,
  };
}

describe("evaluateAutopilotGate", () => {
  it("allows an eligible send and returns the checks map", () => {
    const result = evaluateAutopilotGate(input());
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("autopilot");
    expect(result.checks.loop).toBe(true);
  });

  it("first failure wins: global kill switch beats everything else", () => {
    const result = evaluateAutopilotGate(
      input({ globalEnabled: false, policy: policy({ enabled: false }) }),
    );
    expect(result).toEqual({
      allowed: false,
      reason: "autopilot_disabled_globally",
      checks: { globalEnabled: false },
    });
  });

  it("requires the mailbox policy to be enabled", () => {
    const result = evaluateAutopilotGate(
      input({ policy: policy({ enabled: false }) }),
    );
    expect(result.reason).toBe("autopilot_disabled");
  });

  it("rejects outside the window", () => {
    const result = evaluateAutopilotGate(
      input({ now: new Date("2026-01-15T16:00:00Z") }), // 11:00 local
    );
    expect(result.reason).toBe("outside_window");
  });

  it("any guardrail violation forces a draft with a guardrails: reason", () => {
    const result = evaluateAutopilotGate(
      input({ guardrailViolations: ["commitment_language:money"] }),
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("guardrails:commitment_language:money");
  });

  it("unknown confidence (null) fails closed", () => {
    const result = evaluateAutopilotGate(input({ confidence: null }));
    expect(result.reason).toBe("low_confidence");
  });

  it("confidence below the policy floor fails", () => {
    const result = evaluateAutopilotGate(
      input({ confidence: "LOW", policy: policy({ minConfidence: "MEDIUM", timezone: "America/New_York" }) }),
    );
    expect(result.reason).toBe("low_confidence");
  });

  it("unknown category (null) fails closed", () => {
    const result = evaluateAutopilotGate(input({ category: null }));
    expect(result.reason).toBe("category_not_allowed");
  });

  it("disallowed category fails", () => {
    const result = evaluateAutopilotGate(
      input({ category: "newsletter" }),
    );
    expect(result.reason).toBe("category_not_allowed");
  });

  it("unknown sender fails when required", () => {
    const result = evaluateAutopilotGate(input({ knownSender: false }));
    expect(result.reason).toBe("unknown_sender");
  });

  it("unknown sender is allowed when the policy does not require it", () => {
    const result = evaluateAutopilotGate(
      input({
        knownSender: false,
        policy: policy({
          requireKnownSender: false,
          timezone: "America/New_York",
        }),
      }),
    );
    expect(result.allowed).toBe(true);
  });

  it("enforces the hour, day, thread caps and the loop threshold", () => {
    expect(
      evaluateAutopilotGate(input({ sentLastHour: 10 })).reason,
    ).toBe("hour_cap");
    expect(evaluateAutopilotGate(input({ sentLastDay: 50 })).reason).toBe(
      "day_cap",
    );
    expect(evaluateAutopilotGate(input({ sentInThread: 3 })).reason).toBe(
      "thread_cap",
    );
    expect(
      evaluateAutopilotGate(input({ consecutiveAutomatedExchanges: 3 })).reason,
    ).toBe("loop_detected");
  });

  it("treats `always` mode as inside the window", () => {
    const result = evaluateAutopilotGate(
      input({
        now: new Date("2026-01-15T16:00:00Z"),
        policy: policy({ mode: "always" }),
      }),
    );
    expect(result.allowed).toBe(true);
  });
});

describe("isWithinSendWindow", () => {
  it("supports wrapping windows across midnight", () => {
    const p = policy({ timezone: "America/New_York", windowStartHour: 22, windowEndHour: 7 });
    expect(isWithinSendWindow(new Date("2026-01-15T03:00:00Z"), p)).toBe(true); // 22:00 local
    expect(isWithinSendWindow(new Date("2026-01-15T07:00:00Z"), p)).toBe(true); // 02:00 local
    expect(isWithinSendWindow(new Date("2026-01-15T16:00:00Z"), p)).toBe(false); // 11:00 local
  });

  it("supports non-wrapping windows", () => {
    const p = policy({ timezone: "UTC", windowStartHour: 9, windowEndHour: 17 });
    expect(isWithinSendWindow(new Date("2026-01-15T12:00:00Z"), p)).toBe(true);
    expect(isWithinSendWindow(new Date("2026-01-15T08:59:00Z"), p)).toBe(false);
    expect(isWithinSendWindow(new Date("2026-01-15T17:00:00Z"), p)).toBe(false);
  });

  it("respects the local weekday", () => {
    // 2026-01-19 is a Monday; 2026-01-20 a Tuesday.
    const p = policy({
      timezone: "UTC",
      days: [1],
      windowStartHour: 0,
      windowEndHour: 23,
    });
    expect(isWithinSendWindow(new Date("2026-01-19T10:00:00Z"), p)).toBe(true);
    expect(isWithinSendWindow(new Date("2026-01-20T10:00:00Z"), p)).toBe(false);
  });

  it("accounts for DST offset shifts", () => {
    // July: America/New_York is UTC-4 (EDT), so 02:00Z is 22:00 local.
    const p = policy({ timezone: "America/New_York", windowStartHour: 22, windowEndHour: 7 });
    expect(isWithinSendWindow(new Date("2026-07-15T02:00:00Z"), p)).toBe(true);
    expect(isWithinSendWindow(new Date("2026-07-15T15:00:00Z"), p)).toBe(false); // 11:00 local
  });
});

describe("autopilotWindowStart", () => {
  it("resolves a wrapping window to the previous local evening", () => {
    const p = policy({ timezone: "America/New_York", windowStartHour: 22, windowEndHour: 7 });
    const start = autopilotWindowStart(new Date("2026-01-15T03:00:00Z"), p);
    // 22:00 America/New_York on Jan 14 = 03:00Z Jan 15.
    expect(start.toISOString()).toBe("2026-01-15T03:00:00.000Z");
  });
});

describe("applyPolicyPatch", () => {
  it("clamps caps to the env ceilings and drops unknown categories", () => {
    const current = defaultAutopilotPolicy({ id: "p", mailboxId: "m" });
    const patch = applyPolicyPatch(current, {
      maxPerHour: 999_999,
      maxPerDay: 999_999,
      allowedCategories: ["needs_reply", "not_a_category"],
      mode: "always",
    });
    expect(patch.maxPerHour).toBeLessThanOrEqual(10);
    expect(patch.maxPerDay).toBeLessThanOrEqual(50);
    expect(patch.allowedCategories).toEqual(["needs_reply"]);
    expect(patch.mode).toBe("always");
  });

  it("never weakens the confidence floor below the platform default", () => {
    const current = defaultAutopilotPolicy({ id: "p", mailboxId: "m" });
    const patch = applyPolicyPatch(current, { minConfidence: "LOW" });
    // Platform floor defaults to HIGH.
    expect(patch.minConfidence).toBe("HIGH");
  });
});

describe("commitment_language guardrail", () => {
  it("flags a price that is not present in the grounding corpus", () => {
    const violations = evaluateCommitmentLanguage({
      body: "The price is $500 and we can discount it.",
      contextText: "Hi, can you tell me more about your service?",
    });
    expect(violations).toContain("commitment_language:money");
  });

  it("allows a price that is grounded in the inbound message", () => {
    const violations = evaluateCommitmentLanguage({
      body: "Yes, the price is $500.",
      contextText: "What is the price? Is it $500?",
    });
    expect(violations).not.toContain("commitment_language:money");
  });

  it("flags an ungrounded commitment with a deadline", () => {
    const violations = evaluateCommitmentLanguage({
      body: "I promise to send it by tomorrow.",
      contextText: "Just checking in.",
    });
    expect(violations).toContain("commitment_language:commitment");
  });
});

describe("auto_responder guardrail", () => {
  it("flags no-reply senders, auto-submitted mail, lists and OOO subjects", () => {
    expect(
      evaluateAutoResponder({ from: "no-reply@example.com", subject: null }),
    ).toContain("auto_responder:unreachable");
    expect(
      evaluateAutoResponder({
        from: "person@example.com",
        subject: null,
        autoSubmitted: true,
      }),
    ).toContain("auto_responder:auto_submitted");
    expect(
      evaluateAutoResponder({
        from: "person@example.com",
        subject: "Newsletter",
        hasListHeaders: true,
      }),
    ).toContain("auto_responder:list");
    expect(
      evaluateAutoResponder({
        from: "person@example.com",
        subject: "Automatic reply: out of office",
      }),
    ).toContain("auto_responder:subject");
  });

  it("does not flag a normal person-to-person message", () => {
    expect(
      evaluateAutoResponder({
        from: "jane@example.com",
        subject: "Re: Project update",
      }),
    ).toEqual([]);
  });
});
