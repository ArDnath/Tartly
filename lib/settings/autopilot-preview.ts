import "server-only";

import { isAutopilotEnabled } from "@/lib/env";
import { listInbox } from "@/lib/inbox/service";
import { draftRepository } from "@/lib/repositories/drafts";
import {
  evaluateAutopilotGate,
  getAutopilotPolicy,
  isKnownSender,
  type AutopilotConfidence,
  type AutopilotPolicy,
} from "@/lib/settings/autopilot";
import { getAutopilotUsage } from "@/lib/settings/autopilot-usage";

/**
 * Dry-run of the autopilot gate over the user's recent reply-worthy threads.
 *
 * Safety (T-10): operates only on the user's own mirrored data, makes no model
 * calls, performs no writes and can never send. Guardrails are not evaluated
 * here (they need the generated draft), so the reason shown is the policy
 * verdict; the runtime gate additionally forces a draft on any violation.
 */

export type AutopilotPreviewRow = {
  threadId: string;
  subject: string | null;
  from: string | null;
  decision: "send" | "draft";
  reason: string;
  checks: Record<string, boolean>;
};

export type AutopilotPreview = {
  globalEnabled: boolean;
  policy: AutopilotPolicy;
  rows: AutopilotPreviewRow[];
  totals: { wouldSend: number; wouldDraft: number };
};

export async function previewAutopilot(
  userId: string,
  limit = 10,
): Promise<AutopilotPreview> {
  const now = new Date();
  const policy = await getAutopilotPolicy(userId);

  // The user's mailbox id is required for a real policy; getAutopilotPolicy
  // already returns a synthesized default when there is none.
  const items = await listInbox({ userId, view: "needs_reply", limit });

  const globalEnabled = isAutopilotEnabled();
  const baseUsage = await getAutopilotUsage({
    userId,
    threadId: items[0]?.threadId ?? "",
    now,
    loopThreshold: policy.loopThreshold,
  });
  // Simulate the caps advancing as we walk the list (no writes).
  let sentLastHour = baseUsage.sentLastHour;
  let sentLastDay = baseUsage.sentLastDay;

  const rows: AutopilotPreviewRow[] = [];

  for (const item of items) {
    const draft = await draftRepository.findAnyPendingByThread(item.threadId);
    const confidence: AutopilotConfidence | null =
      draft?.confidence === "HIGH" ||
      draft?.confidence === "MEDIUM" ||
      draft?.confidence === "LOW"
        ? draft.confidence
        : null;
    const knownSender = policy.requireKnownSender
      ? await isKnownSender({ userId, email: item.from })
      : true;

    const gate = evaluateAutopilotGate({
      now,
      policy,
      globalEnabled,
      category: item.category,
      confidence,
      contactEmail: item.from,
      knownSender,
      // Preview cannot evaluate draft-dependent guardrails; runtime may draft.
      guardrailViolations: [],
      sentLastHour,
      sentLastDay,
      sentInThread: 0,
      consecutiveAutomatedExchanges: 0,
    });

    if (gate.allowed) {
      sentLastHour += 1;
      sentLastDay += 1;
    }

    rows.push({
      threadId: item.threadId,
      subject: item.subject,
      from: item.from,
      decision: gate.allowed ? "send" : "draft",
      reason: gate.reason,
      checks: gate.checks,
    });
  }

  const wouldSend = rows.filter((row) => row.decision === "send").length;
  return {
    globalEnabled,
    policy,
    rows,
    totals: { wouldSend, wouldDraft: rows.length - wouldSend },
  };
}
