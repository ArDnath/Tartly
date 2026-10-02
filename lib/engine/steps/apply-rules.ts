import "server-only";

import { z } from "zod";

import { evaluateAndApplyRules, type RuleEvalContext } from "@/lib/ai/features/rules";
import { defineStep } from "@/lib/engine/step";
import { isRulesEnabled } from "@/lib/env";
import { loadThreadContext } from "@/lib/email-operator/thread-context";
import { requireThreadId } from "./helpers";

/**
 * `apply-rules` (Phase 3, best-effort).
 *
 * Runs after triage + sender intelligence and before drafting. It evaluates the
 * user's plain-English rules against the thread, applies reversible actions, and
 * carries any DRAFT_REPLY instruction into the run state for the drafting step.
 * A rule can never exceed the mailbox autonomy: sends still go through `egress`.
 */

function readSenderCategory(state: Record<string, unknown>): string | null {
  const profile = state.senderProfile as { category?: unknown } | undefined;
  return typeof profile?.category === "string" ? profile.category : null;
}

export const applyRulesStep = defineStep({
  type: "apply-rules",
  policy: "best_effort",
  configSchema: z.object({
    enabled: z.boolean().optional(),
  }),
  async run(ctx) {
    const threadId = requireThreadId(ctx);
    if (ctx.input.enabled === false || !isRulesEnabled()) {
      return { ruleMatches: [], draftInstruction: null };
    }

    const context = await loadThreadContext({
      userId: ctx.userId,
      threadId,
      historyLimit: 3,
    });
    if (!context) return { ruleMatches: [], draftInstruction: null };

    const triageCategory =
      typeof ctx.state.category === "string" ? ctx.state.category : null;
    const senderCategory = readSenderCategory(ctx.state);
    const categories = [triageCategory, senderCategory].filter(
      (value): value is string => Boolean(value),
    );

    const latestInbound = context.latestInbound;
    const evalContext: RuleEvalContext = {
      from: latestInbound?.fromAddr ?? null,
      to: latestInbound?.toAddr ?? [],
      subject: latestInbound?.subject ?? context.thread.subject,
      body: latestInbound?.bodyText ?? latestInbound?.snippet ?? "",
      categories,
      hasUnsubscribe: Boolean(latestInbound?.unsubscribe),
      coldEmail: (() => {
        const profile = ctx.state.senderProfile as
          | { isCold?: unknown }
          | undefined;
        return profile?.isCold === true;
      })(),
    };

    const { matches, draftInstruction } = await evaluateAndApplyRules({
      userId: ctx.userId,
      threadId,
      context: evalContext,
    });

    const summary = matches.map((match) => ({
      ruleId: match.rule.id,
      name: match.rule.name,
      reason: match.reason,
      applied: match.applied,
    }));
    ctx.log("apply-rules", { matched: summary.length, draftInstruction: Boolean(draftInstruction) });

    return { ruleMatches: summary, draftInstruction };
  },
});
