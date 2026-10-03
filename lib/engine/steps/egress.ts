import "server-only";

import { z } from "zod";

import { defineStep } from "@/lib/engine/step";
import { isAutopilotEnabled } from "@/lib/env";
import { threadRepository } from "@/lib/repositories/threads";
import { resolveAutonomy } from "@/lib/settings/autonomy";
import {
  evaluateAutopilotGate,
  getAutopilotPolicyForMailbox,
  isKnownSender,
  type AutopilotConfidence,
} from "@/lib/settings/autopilot";
import {
  getAutopilotUsage,
  recordAutopilotDecision,
} from "@/lib/settings/autopilot-usage";
import { requireThreadId } from "./helpers";

/**
 * The single send gate. Nothing else on the automation path may call
 * `gmail.send`.
 *
 * Sending requires `autopilot` on the most specific scope (thread → contact →
 * mailbox) and no guardrail violation. Every other combination drafts for the
 * user to approve. A per-thread override wins in both directions.
 *
 * When autonomy is `autopilot`, the mailbox policy gate is evaluated: window,
 * confidence, category, known sender, caps and loop protection. Any ambiguity
 * (null category/confidence, error, provider outage) resolves to `draft`.
 */
export const egressStep = defineStep({
  type: "egress",
  configSchema: z.object({}),
  async run(ctx) {
    const threadId = requireThreadId(ctx);

    const mailboxId =
      (await threadRepository.findMailboxIdById(threadId)) ?? null;
    const contactEmail = (
      ctx.state.contact as { email?: string | null } | undefined
    )?.email;

    const { autonomy, source } = await resolveAutonomy({
      userId: ctx.userId,
      threadId,
      contactEmail: contactEmail ?? null,
      mailboxId,
    });

    const forcedDraft = ctx.state.forcedDraft === true;

    // --- Copilot (unchanged): always draft. ------------------------------
    if (autonomy !== "autopilot") {
      const reason = source === "mailbox" ? "mailbox_copilot" : `${source}_copilot`;
      ctx.log("egress", { decision: "draft", reason, autonomy, source });
      return { decision: "draft", reason, autonomy, autonomySource: source };
    }

    if (forcedDraft && !hasViolations(ctx.state.violations)) {
      // Defensive: something forced a draft without naming a violation.
      ctx.log("egress", { decision: "draft", reason: "guardrails_forced_draft" });
      return {
        decision: "draft",
        reason: "guardrails_forced_draft",
        autonomy,
        autonomySource: source,
      };
    }

    // --- Autopilot: evaluate the policy gate. ----------------------------
    // Missing mailbox is a fail-safe draft (we cannot scope a policy or audit).
    if (!mailboxId) {
      ctx.log("egress", { decision: "draft", reason: "autopilot_disabled" });
      return {
        decision: "draft",
        reason: "autopilot_disabled",
        autonomy,
        autonomySource: source,
      };
    }

    const now = new Date();
    const policy = await getAutopilotPolicyForMailbox(ctx.userId, mailboxId);
    const usage = await getAutopilotUsage({
      userId: ctx.userId,
      threadId,
      now,
      loopThreshold: policy.loopThreshold,
    });

    const violations = toViolationList(ctx.state.violations);
    const category = typeof ctx.state.category === "string" ? ctx.state.category : null;
    const confidence = normalizeConfidence(ctx.state.confidence);
    const knownSender =
      !policy.requireKnownSender
        ? true
        : await isKnownSender({ userId: ctx.userId, email: contactEmail ?? null });

    const gate = evaluateAutopilotGate({
      now,
      policy,
      globalEnabled: isAutopilotEnabled(),
      category,
      confidence,
      contactEmail: contactEmail ?? null,
      knownSender,
      guardrailViolations: violations,
      sentLastHour: usage.sentLastHour,
      sentLastDay: usage.sentLastDay,
      sentInThread: usage.sentInThread,
      consecutiveAutomatedExchanges: usage.consecutiveAutomatedExchanges,
    });

    const decision: "draft" | "send" = gate.allowed ? "send" : "draft";
    const reason = gate.allowed ? "autopilot" : gate.reason;

    await recordAutopilotDecision({
      userId: ctx.userId,
      mailboxId,
      threadId,
      runId: ctx.runId,
      draftId: typeof ctx.state.draftId === "string" ? ctx.state.draftId : null,
      contactEmail: contactEmail ?? null,
      decision,
      reason,
      autonomySource: source,
      category,
      confidence,
      checks: gate.checks,
      policyVersion: policy.policyVersion,
    });

    ctx.log("egress", {
      decision,
      reason,
      autonomy,
      source,
      checks: gate.checks,
    });

    return {
      decision,
      reason,
      autonomy,
      autonomySource: source,
      autopilotReason: reason,
      autopilotChecks: gate.checks,
    };
  },
});

function normalizeConfidence(value: unknown): AutopilotConfidence | null {
  return value === "HIGH" || value === "MEDIUM" || value === "LOW" ? value : null;
}

function toViolationList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function hasViolations(value: unknown): boolean {
  return toViolationList(value).length > 0;
}
