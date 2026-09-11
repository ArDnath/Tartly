import "server-only";

import { z } from "zod";

import { defineStep } from "@/lib/engine/step";
import { classifyPromptInjection } from "@/lib/guardrails/injection";

/**
 * Guardrails run before egress. They are deterministic and conservative: any
 * violation forces a draft (never an auto-send), so a hallucinated promise can
 * never leave the inbox unattended.
 */

export const GUARDRAIL_CHECKS = [
  "forbidden_phrases",
  "ungrounded_numbers",
  "ungrounded_deadlines",
  "prompt_injection",
  "length",
] as const;

export type GuardrailCheck = (typeof GUARDRAIL_CHECKS)[number];

export type GuardrailResult = {
  violations: string[];
  forcedDraft: boolean;
};

const FORBIDDEN_PHRASES = [
  "guarantee",
  "guaranteed",
  "100%",
  "we promise",
  "risk-free",
  "no risk",
  "free of charge",
  "legally binding",
];

const DEADLINE_PATTERN =
  /\b(by|before|until)\s+(tomorrow|today|tonight|next week|end of (the )?(day|week|month)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/gi;

function extractNumbers(text: string): string[] {
  return (text.match(/\b\d[\d,.]*\b/g) ?? []).map((value) => value.replace(/,/g, ""));
}

/**
 * Pure guardrail evaluation. `contextText` is the grounding corpus (the
 * inbound message + history): any number in the draft that does not appear
 * there is flagged as ungrounded.
 */
export function evaluateGuardrails({
  body,
  contextText,
  enabled = [...GUARDRAIL_CHECKS],
}: {
  body: string;
  contextText: string;
  enabled?: readonly string[];
}): GuardrailResult {
  const violations: string[] = [];
  const active = new Set(enabled);
  const lower = body.toLowerCase();

  if (active.has("forbidden_phrases")) {
    for (const phrase of FORBIDDEN_PHRASES) {
      if (lower.includes(phrase)) violations.push(`forbidden_phrase:${phrase}`);
    }
  }

  if (active.has("ungrounded_numbers")) {
    const contextNumbers = new Set(extractNumbers(contextText));
    for (const number of extractNumbers(body)) {
      if (!contextNumbers.has(number)) {
        violations.push(`ungrounded_number:${number}`);
      }
    }
  }

  if (active.has("ungrounded_deadlines")) {
    const contextLower = contextText.toLowerCase();
    const deadlines = body.match(DEADLINE_PATTERN) ?? [];
    for (const deadline of deadlines) {
      if (!contextLower.includes(deadline.toLowerCase())) {
        violations.push(`ungrounded_deadline:${deadline.trim()}`);
      }
    }
  }

  if (active.has("prompt_injection")) {
    const verdict = classifyPromptInjection(contextText);
    if (verdict.flagged) {
      violations.push(`prompt_injection:${verdict.signals.join(",")}`);
    }
  }

  if (active.has("length") && body.length > 4_000) {
    violations.push("too_long");
  }

  return { violations, forcedDraft: violations.length > 0 };
}

export const guardrailsStep = defineStep({
  type: "guardrails",
  configSchema: z.object({
    enabled: z.array(z.string()).optional(),
  }),
  async run(ctx) {
    const body = typeof ctx.state.body === "string" ? ctx.state.body : "";
    const history = Array.isArray(ctx.state.history) ? ctx.state.history : [];
    const latest = ctx.state.latestMessage as
      | { text?: string | null; subject?: string | null }
      | undefined;

    const contextText = [
      latest?.subject ?? "",
      latest?.text ?? "",
      ...history.map((entry) =>
        typeof entry === "object" && entry && "text" in entry
          ? String((entry as { text?: unknown }).text ?? "")
          : "",
      ),
    ].join("\n");

    const result = evaluateGuardrails({
      body,
      contextText,
      enabled: ctx.input.enabled ?? [...GUARDRAIL_CHECKS],
    });

    ctx.log("guardrails", result);
    return result;
  },
});
