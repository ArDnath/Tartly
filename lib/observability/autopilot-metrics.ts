import "server-only";

import { incrementCounter } from "./metrics";

/**
 * Bounded-cardinality counters for the 24/7 autopilot decision path
 * (Plan-24-7-autopilot §20.2).
 *
 * Label cardinality is bounded by construction: the only free-form reason is a
 * `guardrails:*` violation, which is collapsed to `guardrails`. No message
 * content, subject, sender address or id ever becomes a label (T-06 / INV-11).
 */
export function recordAutopilotDecisionMetric(input: {
  allowed: boolean;
  reason: string;
}): void {
  const reason = input.allowed ? "autopilot" : normalizeReason(input.reason);

  incrementCounter("autopilot_decisions_total", {
    decision: input.allowed ? "send" : "draft",
    reason,
  });

  if (input.allowed) return;

  // A cap hit is the leading signal of a storm or a compromised mailbox
  // (§20.3), so track it separately from an ordinary block.
  if (reason === "hour_cap" || reason === "day_cap" || reason === "thread_cap") {
    incrementCounter("autopilot_cap_hit_total", {
      cap: reason.replace(/_cap$/, ""),
    });
  }

  if (reason === "loop_detected") {
    incrementCounter("autopilot_loop_blocked_total");
  }
}

/** Collapses the unbounded `guardrails:<check>` family to one series. */
function normalizeReason(reason: string): string {
  return reason.startsWith("guardrails:") ? "guardrails" : reason;
}
