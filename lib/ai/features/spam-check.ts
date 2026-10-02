import "server-only";

import { z } from "zod";

import { generateObject } from "@/lib/ai/generate";
import { evaluateGuardrails } from "@/lib/engine/steps/guardrails";

/**
 * Campaign pre-send spam/quality gate (Phase 7).
 *
 * Deterministic checks run first (forbidden claims, prompt injection, length).
 * A `reasoning` judge then rates the template for spammy patterns and risky
 * claims. A high-risk verdict **blocks** the send until the user edits it. The
 * gate never sends and never edits the template.
 */

export const SPAM_CHECK_VERSION = "spam-check-v1";

export type SpamRisk = "low" | "medium" | "high";

export type SpamCheckResult = {
  risk: SpamRisk;
  blocked: boolean;
  /** Deterministic violations, e.g. `forbidden_phrase:guarantee`. */
  violations: string[];
  /** Human-readable issues (deterministic + model). */
  issues: string[];
  suggestion: string | null;
  source: "model" | "heuristic";
};

const judgeSchema = z.object({
  risk: z.enum(["low", "medium", "high"]),
  issues: z.array(z.string().max(200)).max(6),
  suggestion: z.string().max(400).nullable(),
});

const SYSTEM = [
  "You review a bulk email template before it is sent to many recipients.",
  "Judge deliverability and compliance risk: spammy phrasing, ALL CAPS, excessive punctuation, misleading or unverifiable claims, missing context, pressure tactics.",
  "Return a risk level (low/medium/high), concrete issues, and one suggestion.",
  "High risk means the send should be blocked until fixed.",
].join(" ");

/** Deterministic campaign checks (a template has no grounding corpus). */
export function evaluateCampaignGuardrails(template: string): { violations: string[] } {
  const { violations } = evaluateGuardrails({
    body: template,
    contextText: template,
    enabled: ["forbidden_phrases", "prompt_injection", "length"],
  });
  return { violations };
}

export async function checkCampaignTemplate({
  userId,
  name,
  subject,
  body,
}: {
  userId: string;
  name: string;
  subject: string;
  body: string;
}): Promise<SpamCheckResult> {
  const { violations } = evaluateCampaignGuardrails(`${subject}\n${body}`);
  const issues = violations.map((violation) => violation.replace(/:/g, ": "));

  // A deterministic violation is a hard block, model or not.
  if (violations.length > 0) {
    return {
      risk: "high",
      blocked: true,
      violations,
      issues,
      suggestion:
        "Remove promises and guarantees, and avoid prompting language in the body.",
      source: "heuristic",
    };
  }

  const ai = await generateObject({
    schema: judgeSchema,
    role: "reasoning",
    feature: "campaign-spam-check",
    userId,
    system: SYSTEM,
    prompt: [
      `<campaign name="${name}">`,
      `Subject: ${subject}`,
      `Body:\n${body.slice(0, 4_000)}`,
      "</campaign>",
    ].join("\n"),
    hardening: { trust: "trusted" },
    maxOutputTokens: 500,
  });

  if (!ai) {
    return {
      risk: "low",
      blocked: false,
      violations: [],
      issues: [],
      suggestion: null,
      source: "heuristic",
    };
  }

  return {
    risk: ai.risk,
    blocked: ai.risk === "high",
    violations: [],
    issues: ai.issues,
    suggestion: ai.suggestion,
    source: "model",
  };
}
