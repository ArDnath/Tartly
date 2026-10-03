import "server-only";

import { z } from "zod";

import { defineStep } from "@/lib/engine/step";
import { isUnreachableAddress } from "@/lib/followup/rules";
import { classifyPromptInjection } from "@/lib/guardrails/injection";

/**
 * Guardrails run before egress. They are deterministic and conservative: any
 * violation forces a draft (never an auto-send), so a hallucinated promise or a
 * reply to a robot can never leave the inbox unattended.
 */

export const GUARDRAIL_CHECKS = [
  "forbidden_phrases",
  "ungrounded_numbers",
  "ungrounded_deadlines",
  "commitment_language",
  "auto_responder",
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

/** Money / pricing tokens that must be grounded before an autopilot send. */
const MONEY_PATTERN =
  /([$€£]\s?\d[\d,]*(?:\.\d+)?)|(\b(price|pricing|cost|fee|invoice|discount|refund|contract|terms)\b)/gi;

/** Commitment verbs: never promise on the user's behalf without grounding. */
const COMMITMENT_VERB_PATTERN =
  /\b(commit|commitment|guarantee|promise|agree|sign|purchase|pay|liable|liability)\b/gi;

const LEGAL_PATTERN = /\b(legally|agreement|nda|liable|liability)\b/gi;

/** Subject prefixes that mark an automated message (never auto-reply). */
const AUTO_SUBJECT_PATTERN =
  /^\s*(auto:|automatic reply|auto reply|out of office|vacation|undeliverable|away from)/i;

export type GuardrailSenderContext = {
  from: string | null;
  subject: string | null;
  autoSubmitted?: boolean;
  listId?: string | null;
  precedence?: string | null;
  hasListHeaders?: boolean;
};

function extractNumbers(text: string): string[] {
  return (text.match(/\b\d[\d,.]*\b/g) ?? []).map((value) => value.replace(/,/g, ""));
}

function ungroundedMatches(
  body: string,
  contextLower: string,
  pattern: RegExp,
): string[] {
  const found = body.match(pattern) ?? [];
  return [
    ...new Set(
      found
        .map((value) => value.trim())
        .filter((value) => value.length > 0 && !contextLower.includes(value.toLowerCase())),
    ),
  ];
}

/**
 * Flags a draft that implies a promise, price, legal term or hard date not
 * grounded in the inbound/history. Risk patterns, not a wording blacklist.
 */
export function evaluateCommitmentLanguage({
  body,
  contextText,
}: {
  body: string;
  contextText: string;
}): string[] {
  const contextLower = contextText.toLowerCase();
  const violations: string[] = [];

  const money = ungroundedMatches(body, contextLower, MONEY_PATTERN);
  if (money.length > 0) violations.push("commitment_language:money");

  const legal = ungroundedMatches(body, contextLower, LEGAL_PATTERN);
  if (legal.length > 0) violations.push("commitment_language:legal");

  // A commitment verb only matters when paired with a deadline or money claim.
  const hasDeadline = (body.match(DEADLINE_PATTERN) ?? []).length > 0;
  const hasMoney = money.length > 0;
  if (hasDeadline || hasMoney) {
    const verbs = ungroundedMatches(body, contextLower, COMMITMENT_VERB_PATTERN);
    if (verbs.length > 0) violations.push("commitment_language:commitment");
  }

  return violations;
}

/**
 * Never auto-reply to robots, bounces, out-of-office and mailing lists. Uses
 * deterministic header/subject/address signals only.
 */
export function evaluateAutoResponder(
  sender: GuardrailSenderContext,
): string[] {
  const violations: string[] = [];

  if (isUnreachableAddress(sender.from)) {
    violations.push("auto_responder:unreachable");
  }
  if (sender.autoSubmitted) {
    violations.push("auto_responder:auto_submitted");
  }
  if (sender.hasListHeaders || sender.listId) {
    violations.push("auto_responder:list");
  }
  const precedence = (sender.precedence ?? "").toLowerCase();
  if (precedence === "bulk" || precedence === "junk" || precedence === "list") {
    if (!violations.includes("auto_responder:list")) {
      violations.push("auto_responder:list");
    }
  }
  if (sender.subject && AUTO_SUBJECT_PATTERN.test(sender.subject)) {
    violations.push("auto_responder:subject");
  }

  return violations;
}

/**
 * Pure guardrail evaluation. `contextText` is the grounding corpus (the
 * inbound message + history): any number in the draft that does not appear
 * there is flagged as ungrounded.
 */
export function evaluateGuardrails({
  body,
  contextText,
  sender,
  enabled = [...GUARDRAIL_CHECKS],
}: {
  body: string;
  contextText: string;
  sender?: GuardrailSenderContext;
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

  if (active.has("commitment_language")) {
    violations.push(...evaluateCommitmentLanguage({ body, contextText }));
  }

  if (active.has("auto_responder") && sender) {
    violations.push(...evaluateAutoResponder(sender));
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
      | {
          from?: string | null;
          subject?: string | null;
          text?: string | null;
          autoSubmitted?: boolean;
          listId?: string | null;
          precedence?: string | null;
          hasListHeaders?: boolean;
        }
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
      sender: {
        from: latest?.from ?? null,
        subject: latest?.subject ?? null,
        autoSubmitted: latest?.autoSubmitted === true,
        listId: latest?.listId ?? null,
        precedence: latest?.precedence ?? null,
        hasListHeaders: latest?.hasListHeaders === true,
      },
      enabled: ctx.input.enabled ?? [...GUARDRAIL_CHECKS],
    });

    ctx.log("guardrails", result);
    return result;
  },
});
