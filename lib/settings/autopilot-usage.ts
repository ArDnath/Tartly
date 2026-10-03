import "server-only";

import { nanoid } from "nanoid";

import { logger } from "@/lib/observability/logger";
import {
  autopilotRepository,
  type AutopilotDecisionRow,
} from "@/lib/repositories/autopilot";
import {
  AUTOPILOT_POLICY_VERSION,
  autopilotWindowStart,
  type AutopilotPolicy,
  type AutopilotUsage,
} from "@/lib/settings/autopilot";

/**
 * Usage counters and the content-free decision audit for autopilot.
 *
 * Everything here is best-effort: recording a decision must never change the
 * send outcome, and the counters are read within a lane-serialized run so two
 * concurrent runs for the same mailbox cannot both observe a stale count.
 */

export async function getAutopilotUsage(input: {
  userId: string;
  threadId: string;
  now: Date;
  loopThreshold?: number;
}): Promise<AutopilotUsage> {
  return autopilotRepository.getUsage({
    userId: input.userId,
    threadId: input.threadId,
    now: input.now,
    // Read one past the threshold so the gate's `<` boundary is exact.
    loopBound: (input.loopThreshold ?? 3) + 1,
  });
}

export type RecordAutopilotDecisionInput = {
  userId: string;
  mailboxId: string;
  threadId: string | null;
  runId: string | null;
  draftId: string | null;
  contactEmail: string | null;
  decision: "send" | "draft";
  reason: string;
  autonomySource: string | null;
  category: string | null;
  confidence: string | null;
  checks: Record<string, boolean> | null;
  policyVersion?: number;
};

/**
 * Writes one content-free audit row (INV-11). Never throws: a failed audit
 * write must not fail the run or change the decision.
 */
export async function recordAutopilotDecision(
  input: RecordAutopilotDecisionInput,
): Promise<void> {
  try {
    await autopilotRepository.insertDecision({
      id: nanoid(),
      userId: input.userId,
      mailboxId: input.mailboxId,
      threadId: input.threadId,
      runId: input.runId,
      draftId: input.draftId,
      contactEmail: input.contactEmail,
      decision: input.decision,
      reason: input.reason,
      autonomySource: input.autonomySource,
      category: input.category,
      confidence: input.confidence,
      checks: input.checks,
      policyVersion: input.policyVersion ?? AUTOPILOT_POLICY_VERSION,
    });
  } catch (error) {
    // T-06: never log the raw driver error — Postgres/Drizzle messages can echo
    // bound parameter values (e.g. `contact_email`). Record the error name only.
    logger.error("autopilot_decision_record_failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}

export type OvernightSummary = {
  windowLabel: string;
  since: string;
  sent: Array<{ threadId: string; at: string; reason: string; draftId: string }>;
  drafted: Array<{ threadId: string; reason: string }>;
  blocked: Array<{ threadId: string; reason: string }>;
  totals: { sent: number; drafted: number; blocked: number };
};

/**
 * Aggregates decisions inside the current send window. `blocked` counts every
 * non-`send` decision (including drafts the user now has to review).
 */
export async function getOvernightSummary(
  userId: string,
  now: Date,
  policy: AutopilotPolicy,
): Promise<OvernightSummary> {
  const since = autopilotWindowStart(now, policy);
  const rows = await autopilotRepository.listDecisionsSince(userId, since);

  const sent: OvernightSummary["sent"] = [];
  const drafted: OvernightSummary["drafted"] = [];
  const blocked: OvernightSummary["blocked"] = [];

  const seenSend = new Set<string>();
  for (const row of rows) {
    const threadId = row.threadId ?? "";
    if (row.decision === "send") {
      // De-duplicate: a regenerated run may record more than one send decision
      // for the same thread; the overnight "sent" list should list it once.
      if (threadId && seenSend.has(threadId)) continue;
      if (threadId) seenSend.add(threadId);
      sent.push({
        threadId,
        at: row.createdAt.toISOString(),
        reason: row.reason,
        draftId: row.draftId ?? "",
      });
    } else {
      drafted.push({ threadId, reason: row.reason });
      blocked.push({ threadId, reason: row.reason });
    }
  }

  return {
    windowLabel: policy.mode === "always" ? "Always on" : formatWindowLabel(policy),
    since: since.toISOString(),
    sent,
    drafted,
    blocked,
    totals: { sent: sent.length, drafted: drafted.length, blocked: blocked.length },
  };
}

function formatWindowLabel(policy: AutopilotPolicy): string {
  const pad = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
  return `${pad(policy.windowStartHour)}–${pad(policy.windowEndHour)} (${policy.timezone})`;
}

export async function listAutopilotDecisions(input: {
  userId: string;
  since?: Date | null;
  before?: Date | null;
  limit: number;
}): Promise<AutopilotDecisionRow[]> {
  return autopilotRepository.listDecisionsForUser(input);
}

export async function pruneAutopilotDecisions(cutoff: Date): Promise<number> {
  return autopilotRepository.pruneDecisionsBefore(cutoff);
}
