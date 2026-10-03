import "server-only";

import { nanoid } from "nanoid";

import {
  autopilotMaxLoopThreshold,
  autopilotMaxPerDay,
  autopilotMaxPerHour,
  autopilotMaxPerThread,
  autopilotMinConfidence,
  type AutopilotConfidence,
} from "@/lib/env";
import { getIsoWeekday, getZonedParts, zonedTimeToUtc } from "@/lib/calendar/tz";
import { mailboxRepository } from "@/lib/repositories/mailboxes";
import {
  autopilotRepository,
  type AutopilotPolicyRow,
  type AutopilotUsage,
} from "@/lib/repositories/autopilot";

/**
 * The 24/7 Autopilot policy engine.
 *
 * `evaluateAutopilotGate` is pure: given the policy, usage counters and the
 * guardrail verdict, it decides `send` vs `draft` with a machine reason. The
 * evaluation order is part of the contract and is unit-tested. Everything
 * ambiguous (`null` category/confidence), every error, and every guardrail
 * violation fails to `draft` — never `send`.
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
 * The pure send gate. First failure wins; order is the contract.
 * `null` category/confidence always fail (INV-06).
 */
export function evaluateAutopilotGate(
  input: AutopilotGateInput,
): AutopilotGateResult {
  const checks: Record<string, boolean> = {};

  const fail = (key: string, reason: AutopilotGateReason): AutopilotGateResult => {
    checks[key] = false;
    return { allowed: false, reason, checks };
  };

  checks.globalEnabled = input.globalEnabled;
  if (!input.globalEnabled) return fail("globalEnabled", "autopilot_disabled_globally");

  checks.policyEnabled = input.policy.enabled;
  if (!input.policy.enabled) return fail("policyEnabled", "autopilot_disabled");

  checks.withinWindow = isWithinSendWindow(input.now, input.policy);
  if (!checks.withinWindow) return fail("withinWindow", "outside_window");

  checks.noGuardrailViolations = input.guardrailViolations.length === 0;
  if (!checks.noGuardrailViolations) {
    return fail(
      "noGuardrailViolations",
      `guardrails:${input.guardrailViolations[0] ?? "unknown"}`,
    );
  }

  const required = CONFIDENCE_RANK[input.policy.minConfidence];
  checks.confidence = input.confidence !== null && CONFIDENCE_RANK[input.confidence] >= required;
  if (!checks.confidence) return fail("confidence", "low_confidence");

  checks.category = input.category !== null && input.policy.allowedCategories.includes(input.category);
  if (!checks.category) return fail("category", "category_not_allowed");

  checks.knownSender = !input.policy.requireKnownSender || input.knownSender;
  if (!checks.knownSender) return fail("knownSender", "unknown_sender");

  checks.hourCap = input.sentLastHour < input.policy.maxPerHour;
  if (!checks.hourCap) return fail("hourCap", "hour_cap");

  checks.dayCap = input.sentLastDay < input.policy.maxPerDay;
  if (!checks.dayCap) return fail("dayCap", "day_cap");

  checks.threadCap = input.sentInThread < input.policy.maxPerThread;
  if (!checks.threadCap) return fail("threadCap", "thread_cap");

  checks.loop = input.consecutiveAutomatedExchanges < input.policy.loopThreshold;
  if (!checks.loop) return fail("loop", "loop_detected");

  return { allowed: true, reason: "autopilot", checks };
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

/* -------------------------------------------------------------------------- */
/*  Persistence-backed helpers                                                 */
/* -------------------------------------------------------------------------- */

async function resolveMailboxId(userId: string): Promise<string | null> {
  const mailbox = await mailboxRepository.findByUser(userId);
  return mailbox?.id ?? null;
}

/**
 * Returns the mailbox's policy, creating the disabled default on first read.
 * When the user has no mailbox yet, returns a synthesized default (not
 * persisted) so the settings UI can render before Gmail is connected.
 */
export async function getAutopilotPolicyForMailbox(
  userId: string,
  mailboxId: string,
): Promise<AutopilotPolicy> {
  const existing = await autopilotRepository.findPolicyByMailboxId(mailboxId);
  if (existing) return policyFromRow(existing);

  const created = await autopilotRepository.ensurePolicy({
    id: nanoid(),
    userId,
    mailboxId,
    policyVersion: AUTOPILOT_POLICY_VERSION,
  });
  return policyFromRow(created);
}

export async function getAutopilotPolicy(userId: string): Promise<AutopilotPolicy> {
  const mailboxId = await resolveMailboxId(userId);
  if (!mailboxId) return defaultAutopilotPolicy();
  return getAutopilotPolicyForMailbox(userId, mailboxId);
}

export async function setAutopilotPolicyForMailbox(
  userId: string,
  mailboxId: string,
  patch: AutopilotPolicyPatch,
  now = new Date(),
): Promise<AutopilotPolicy> {
  const current = await getAutopilotPolicyForMailbox(userId, mailboxId);
  const clamped = applyPolicyPatch(current, patch);
  const updated = await autopilotRepository.updatePolicy(
    mailboxId,
    clamped,
    now,
  );
  return policyFromRow(updated);
}

export async function setAutopilotPolicy(
  userId: string,
  patch: AutopilotPolicyPatch,
  now = new Date(),
): Promise<AutopilotPolicy> {
  const mailboxId = await resolveMailboxId(userId);
  if (!mailboxId) {
    throw new Error("No connected mailbox to configure autopilot.");
  }
  return setAutopilotPolicyForMailbox(userId, mailboxId, patch, now);
}

/**
 * Kill switch. Disables the policy and optionally forces the mailbox back to
 * `copilot` so a UI toggle cannot leave a sendable autonomy in place.
 */
export async function pauseAutopilot(
  userId: string,
  options: { alsoSetCopilot?: boolean } = {},
  now = new Date(),
): Promise<AutopilotPolicy> {
  const mailboxId = await resolveMailboxId(userId);
  if (!mailboxId) return defaultAutopilotPolicy();

  const policy = await setAutopilotPolicyForMailbox(
    userId,
    mailboxId,
    { enabled: false },
    now,
  );

  if (options.alsoSetCopilot) {
    const { setMailboxAutonomy } = await import("@/lib/settings/autonomy");
    await setMailboxAutonomy(userId, "copilot");
  }

  return policy;
}

/** A sender is known when they are a contact or we have mailed them before. */
export async function isKnownSender({
  userId,
  email,
}: {
  userId: string;
  email: string | null;
}): Promise<boolean> {
  if (!email) return false;
  if (await autopilotRepository.contactExists(userId, email)) return true;
  return autopilotRepository.hasPriorOutboundTo(userId, email);
}

export type { AutopilotUsage };
export { autopilotRepository };
