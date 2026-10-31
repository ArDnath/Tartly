import { autopilotMaxLoopThreshold, autopilotMaxPerDay, autopilotMaxPerHour, autopilotMaxPerThread, autopilotMinConfidence, type AutopilotConfidence } from "@/lib/env";
import { getIsoWeekday, getZonedParts, zonedTimeToUtc } from "@/lib/calendar/tz";
import type { AutopilotPolicyRow } from "@/lib/repositories/autopilot";

/**
 * The 24/7 Autopilot policy engine — pure decision logic.
 *
 * `evaluateAutopilotGate` is pure: given the policy, usage counters and the
 * guardrail verdict, it decides `send` vs `draft` with a machine reason. The
 * evaluation order is part of the contract and is unit-tested. Everything
 * ambiguous (`null` category/confidence), every error, and every guardrail
 * violation fails to `draft` — never `send`.
 *
 * This module holds the policy *semantics* only (defaults, normalization,
 * clamping, guard ordering, human-readable reasons). Persistence-backed
 * orchestration lives in `@/lib/settings/autopilot`.
 */

export const AUTOPILOT_POLICY_VERSION = 1;

export type AutopilotMode = "window" | "always";

/** Triage categories an autopilot policy may allow (mirrors triage taxonomy). */
export const AUTOPILOT_CATEGORIES = [
  "needs_reply",
  "meeting_request",
  "awaiting_reply",
  "fyi",
  "invoice",
  "newsletter",
  "spam",
] as const;

export type AutopilotCategory = (typeof AUTOPILOT_CATEGORIES)[number];

export type AutopilotPolicy = {
  id: string;
  mailboxId: string | null;
  enabled: boolean;
  mode: AutopilotMode;
  timezone: string;
  /** ISO weekdays (1=Mon..7=Sun). */
  days: number[];
  windowStartHour: number;
  windowEndHour: number;
  minConfidence: AutopilotConfidence;
  requireKnownSender: boolean;
  allowedCategories: string[];
  maxPerHour: number;
  maxPerDay: number;
  maxPerThread: number;
  loopThreshold: number;
  morningReview: boolean;
  policyVersion: number;
};

/** The mutable subset a client may patch (id/mailboxId/version are server-owned). */
export type AutopilotPolicyPatch = Partial<
  Omit<AutopilotPolicy, "id" | "mailboxId" | "policyVersion">
>;

export type { AutopilotConfidence };

export type AutopilotGateInput = {
  now: Date;
  policy: AutopilotPolicy;
  globalEnabled: boolean;
  category: string | null;
  confidence: AutopilotConfidence | null;
  contactEmail: string | null;
  knownSender: boolean;
  guardrailViolations: string[];
  sentLastHour: number;
  sentLastDay: number;
  sentInThread: number;
  consecutiveAutomatedExchanges: number;
};

export type AutopilotGateReason =
  | "autopilot"
  | "autopilot_disabled_globally"
  | "autopilot_disabled"
  | "outside_window"
  | "low_confidence"
  | "category_not_allowed"
  | "unknown_sender"
  | "hour_cap"
  | "day_cap"
  | "thread_cap"
  | "loop_detected"
  | "autopilot_error"
  | `guardrails:${string}`;

export type AutopilotGateResult = {
  allowed: boolean;
  reason: AutopilotGateReason;
  checks: Record<string, boolean>;
};

/**
 * Single-guard outcome. `reason` is set exactly when `ok` is false; the union
 * keeps the two shapes distinct so the runner can trust the reason.
 */
export type AutopilotGateOutcome = { ok: true } | { ok: false; reason: AutopilotGateReason };

/** One ordered autopilot guard. `evaluate` is pure; `key` is the check-map key. */
type AutopilotGateGuard = {
  key: string;
  evaluate: (input: AutopilotGateInput) => AutopilotGateOutcome;
};

/**
 * The ordered autopilot guard chain. Order is the contract: the first failing
 * guard decides the reason and short-circuits (later checks are not recorded).
 * `null` category/confidence always fail (INV-06).
 *
 * Kept declarative (ordered guards + runner) so each guard stays a small,
 * individually readable predicate instead of one monolithic branch chain.
 */
const AUTOPILOT_GUARDS: AutopilotGateGuard[] = [
  {
    key: "globalEnabled",
    evaluate: (input) =>
      input.globalEnabled
        ? { ok: true }
        : { ok: false, reason: "autopilot_disabled_globally" },
  },
  {
    key: "policyEnabled",
    evaluate: (input) =>
      input.policy.enabled
        ? { ok: true }
        : { ok: false, reason: "autopilot_disabled" },
  },
  {
    key: "withinWindow",
    evaluate: (input) => {
      const ok = isWithinSendWindow(input.now, input.policy);
      return ok ? { ok: true } : { ok: false, reason: "outside_window" };
    },
  },
  {
    key: "noGuardrailViolations",
    evaluate: (input) =>
      input.guardrailViolations.length > 0
        ? { ok: false, reason: `guardrails:${input.guardrailViolations[0]}` }
        : { ok: true },
  },
  {
    key: "confidence",
    evaluate: (input) => {
      const required = CONFIDENCE_RANK[input.policy.minConfidence];
      const ok =
        input.confidence !== null && CONFIDENCE_RANK[input.confidence] >= required;
      return ok ? { ok: true } : { ok: false, reason: "low_confidence" };
    },
  },
  {
    key: "category",
    evaluate: (input) =>
      input.category !== null && input.policy.allowedCategories.includes(input.category)
        ? { ok: true }
        : { ok: false, reason: "category_not_allowed" },
  },
  {
    key: "knownSender",
    evaluate: (input) =>
      !input.policy.requireKnownSender || input.knownSender
        ? { ok: true }
        : { ok: false, reason: "unknown_sender" },
  },
  {
    key: "hourCap",
    evaluate: (input) =>
      input.sentLastHour < input.policy.maxPerHour
        ? { ok: true }
        : { ok: false, reason: "hour_cap" },
  },
  {
    key: "dayCap",
    evaluate: (input) =>
      input.sentLastDay < input.policy.maxPerDay
        ? { ok: true }
        : { ok: false, reason: "day_cap" },
  },
  {
    key: "threadCap",
    evaluate: (input) =>
      input.sentInThread < input.policy.maxPerThread
        ? { ok: true }
        : { ok: false, reason: "thread_cap" },
  },
  {
    key: "loop",
    evaluate: (input) =>
      input.consecutiveAutomatedExchanges < input.policy.loopThreshold
        ? { ok: true }
        : { ok: false, reason: "loop_detected" },
  },
];

/**
 * The pure send gate. First failure wins; order is the contract, expressed by
 * the ordered {@link AUTOPILOT_GUARDS} chain. `null` category/confidence always
 * fail (INV-06).
 */
export function evaluateAutopilotGate(input: AutopilotGateInput): AutopilotGateResult {
  const checks: Record<string, boolean> = {};

  for (const guard of AUTOPILOT_GUARDS) {
    const outcome = guard.evaluate(input);
    checks[guard.key] = outcome.ok;
    if (!outcome.ok) {
      return { allowed: false, reason: outcome.reason, checks };
    }
  }

  return { allowed: true, reason: "autopilot", checks };
}

/** User-facing copy for every gate reason. Never render the raw enum. */
export const AUTOPILOT_REASON_LABELS: Record<string, string> = {
  autopilot: "Sent automatically",
  autopilot_disabled_globally: "Automatic sending is turned off",
  autopilot_disabled: "Autopilot is off for this mailbox",
  outside_window: "Outside your sending hours",
  low_confidence: "Held for review: not confident enough",
  category_not_allowed: "Held for review: this kind of email isn't auto-sent",
  unknown_sender: "Held for review: first-time sender",
  hour_cap: "Held for review: sending limit reached",
  day_cap: "Held for review: sending limit reached",
  thread_cap: "Held for review: sending limit reached",
  loop_detected: "Held for review: repeated auto-replies",
  autopilot_error: "Held for review: couldn't check safely",
};

/** Resolves a reason (including `guardrails:*`) to human copy. */
export function autopilotReasonLabel(reason: string): string {
  if (reason.startsWith("guardrails:")) {
    return "Held for review: risky content";
  }
  return AUTOPILOT_REASON_LABELS[reason] ?? "Held for review";
}

const CONFIDENCE_RANK: Record<AutopilotConfidence, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
};

function normalizeConfidence(value: string | null | undefined): AutopilotConfidence | null {
  return value === "HIGH" || value === "MEDIUM" || value === "LOW" ? value : null;
}

function normalizeMode(value: string | null | undefined): AutopilotMode {
  return value === "always" ? "always" : "window";
}

/** Everything a fresh (or synthesized) policy defaults to. */
export function defaultAutopilotPolicy(input: {
  id?: string;
  mailboxId?: string | null;
} = {}): AutopilotPolicy {
  return {
    id: input.id ?? "",
    mailboxId: input.mailboxId ?? null,
    enabled: false,
    mode: "window",
    timezone: "UTC",
    days: [1, 2, 3, 4, 5, 6, 7],
    windowStartHour: 22,
    windowEndHour: 7,
    minConfidence: autopilotMinConfidence(),
    requireKnownSender: true,
    allowedCategories: ["needs_reply"],
    maxPerHour: autopilotMaxPerHour(),
    maxPerDay: autopilotMaxPerDay(),
    maxPerThread: Math.min(3, autopilotMaxPerThread()),
    loopThreshold: Math.min(3, autopilotMaxLoopThreshold()),
    morningReview: true,
    policyVersion: AUTOPILOT_POLICY_VERSION,
  };
}

export function policyFromRow(row: AutopilotPolicyRow): AutopilotPolicy {
  return {
    id: row.id,
    mailboxId: row.mailboxId,
    enabled: row.enabled,
    mode: normalizeMode(row.mode),
    // A stale/corrupt timezone must not make the gate throw on every message.
    // Fail safe to UTC (never to a send) rather than crashing the run.
    timezone: isValidTimezone(row.timezone) ? row.timezone : "UTC",
    days: Array.isArray(row.days) && row.days.length > 0 ? row.days : [1, 2, 3, 4, 5, 6, 7],
    windowStartHour: clampHour(row.windowStartHour, 22),
    windowEndHour: clampHour(row.windowEndHour, 7),
    minConfidence: normalizeConfidence(row.minConfidence) ?? "HIGH",
    requireKnownSender: row.requireKnownSender,
    allowedCategories: Array.isArray(row.allowedCategories)
      ? row.allowedCategories.filter((category) =>
          (AUTOPILOT_CATEGORIES as readonly string[]).includes(category),
        )
      : ["needs_reply"],
    maxPerHour: clampPositive(row.maxPerHour, autopilotMaxPerHour()),
    maxPerDay: clampPositive(row.maxPerDay, autopilotMaxPerDay()),
    maxPerThread: Math.min(
      clampPositive(row.maxPerThread, 3),
      autopilotMaxPerThread(),
    ),
    loopThreshold: Math.min(
      clampPositive(row.loopThreshold, 3),
      autopilotMaxLoopThreshold(),
    ),
    morningReview: row.morningReview,
    policyVersion: row.policyVersion,
  };
}

function clampHour(value: number, fallback: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 23) return fallback;
  return value;
}

function clampPositive(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Clamps a user patch to the platform ceilings and enums. Exported for tests.
 * Unknown categories are dropped (T-14); caps never exceed the env ceilings.
 */
export function applyPolicyPatch(
  current: AutopilotPolicy,
  patch: AutopilotPolicyPatch,
): AutopilotPolicyPatch {
  const next: AutopilotPolicyPatch = {};

  if (patch.enabled !== undefined) next.enabled = patch.enabled === true;
  if (patch.mode !== undefined) next.mode = normalizeMode(patch.mode);
  if (patch.timezone !== undefined) {
    next.timezone = isValidTimezone(patch.timezone) ? patch.timezone : current.timezone;
  }
  if (patch.days !== undefined) {
    const days = [...new Set(patch.days)]
      .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)
      .sort((a, b) => a - b);
    next.days = days.length > 0 ? days : current.days;
  }
  if (patch.windowStartHour !== undefined) {
    next.windowStartHour = clampHour(patch.windowStartHour, current.windowStartHour);
  }
  if (patch.windowEndHour !== undefined) {
    next.windowEndHour = clampHour(patch.windowEndHour, current.windowEndHour);
  }
  if (patch.minConfidence !== undefined) {
    const floor = CONFIDENCE_RANK[autopilotMinConfidence()];
    const requested = normalizeConfidence(patch.minConfidence);
    // Never let a user pick a weaker floor than the platform requires.
    next.minConfidence =
      requested && CONFIDENCE_RANK[requested] >= floor
        ? requested
        : autopilotMinConfidence();
  }
  if (patch.requireKnownSender !== undefined) {
    next.requireKnownSender = patch.requireKnownSender === true;
  }
  if (patch.allowedCategories !== undefined) {
    next.allowedCategories = [
      ...new Set(
        patch.allowedCategories.filter((category) =>
          (AUTOPILOT_CATEGORIES as readonly string[]).includes(category),
        ),
      ),
    ];
  }
  if (patch.maxPerHour !== undefined) {
    next.maxPerHour = Math.min(
      clampPositive(patch.maxPerHour, current.maxPerHour),
      autopilotMaxPerHour(),
    );
  }
  if (patch.maxPerDay !== undefined) {
    next.maxPerDay = Math.min(
      clampPositive(patch.maxPerDay, current.maxPerDay),
      autopilotMaxPerDay(),
    );
  }
  if (patch.maxPerThread !== undefined) {
    next.maxPerThread = Math.min(
      clampPositive(patch.maxPerThread, current.maxPerThread),
      autopilotMaxPerThread(),
    );
  }
  if (patch.loopThreshold !== undefined) {
    next.loopThreshold = Math.min(
      clampPositive(patch.loopThreshold, current.loopThreshold),
      autopilotMaxLoopThreshold(),
    );
  }
  if (patch.morningReview !== undefined) {
    next.morningReview = patch.morningReview === true;
  }

  return next;
}

/**
 * Is `now` inside the policy's local send window? Uses `lib/calendar/tz.ts`
 * exactly as follow-up rules do; wrapping windows (22 → 7) are supported.
 */
export function isWithinSendWindow(now: Date, policy: AutopilotPolicy): boolean {
  if (policy.mode === "always") return true;

  const weekday = getIsoWeekday(now, policy.timezone);
  if (!policy.days.includes(weekday)) return false;

  const hour = getZonedParts(now, policy.timezone).hour;
  const { windowStartHour: start, windowEndHour: end } = policy;

  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  // Wrapping window, e.g. 22:00 → 07:00.
  return hour >= start || hour < end;
}

/**
 * The instant the current (or most recent) send window opened, in UTC. Used by
 * the overnight review to bound its query. For `always` mode, the last 24h.
 */
export function autopilotWindowStart(now: Date, policy: AutopilotPolicy): Date {
  if (policy.mode === "always") {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }

  const parts = getZonedParts(now, policy.timezone);
  const { windowStartHour: start, windowEndHour: end } = policy;

  // A wrapping window that has not yet closed started yesterday.
  const dayOffset = start > end && parts.hour < end ? -1 : 0;

  const localMidnight = zonedTimeToUtc(
    { year: parts.year, month: parts.month, day: parts.day, hour: 0, minute: 0 },
    policy.timezone,
  );
  const shifted = getZonedParts(
    new Date(localMidnight.getTime() + dayOffset * 24 * 60 * 60 * 1000),
    policy.timezone,
  );

  return zonedTimeToUtc(
    {
      year: shifted.year,
      month: shifted.month,
      day: shifted.day,
      hour: start,
      minute: 0,
    },
    policy.timezone,
  );
}
