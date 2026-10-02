import "server-only";

import { streamGenerate } from "@/lib/ai/generate";

/**
 * Smart compose (Phase 4, C11).
 *
 * A streaming writing assistant embedded in the composer: complete the current
 * sentence, rewrite, shorten, change tone, or bulletize. It **never sends**; it
 * returns text the user reviews and edits. Every action has a deterministic
 * fallback so the toolbar does something even without a model, and the output is
 * constrained to plain text so a suggestion can never smuggle HTML or a
 * disguised link into an outgoing message.
 */

export const COMPOSE_ASSIST_ACTIONS = [
  "complete",
  "rewrite",
  "shorten",
  "formal",
  "casual",
  "bulletize",
  "translate",
  /** Free-form generation: the user describes the email and the model writes it. */
  "write",
] as const;

export type ComposeAssistAction = (typeof COMPOSE_ASSIST_ACTIONS)[number];

export function isComposeAssistAction(value: unknown): value is ComposeAssistAction {
  return (
    typeof value === "string" &&
    (COMPOSE_ASSIST_ACTIONS as readonly string[]).includes(value)
  );
}

export type ComposeAssistInput = {
  action: ComposeAssistAction;
  /** The full message body so far. */
  body: string;
  /** The highlighted fragment, when the user selected text. */
  selection?: string;
  subject?: string;
  to?: string[];
  /** Required for `translate`; a plain language name. */
  targetLanguage?: string;
  /** Required for `write`; the user's free-form description of the email. */
  instruction?: string;
};

/** Framing for the free-form `write` action. The user's request is appended. */
const WRITE_INSTRUCTION = [
  "Write the email body the user asks for.",
  "If an existing draft is present, treat it as context — for a reply it holds the quoted original message, so write a reply to it and never repeat the quoted text verbatim.",
  "Return only the new body text: no subject line, no commentary, and no markdown.",
].join(" ");

/** Per-action instruction shown to the model. */
const ACTION_INSTRUCTIONS: Record<ComposeAssistAction, string> = {
  complete:
    "Continue the email naturally from where it stops. Return ONLY the continuation text, with no repetition of what is already written.",
  rewrite:
    "Rewrite the text so it reads clearly and naturally while preserving the exact meaning and any facts.",
  shorten:
    "Shorten the text, keeping the meaning and any commitments. Remove filler, not substance.",
  formal:
    "Rewrite the text in a more formal, professional register without becoming stiff or bureaucratic.",
  casual:
    "Rewrite the text in a warm, casual register suitable for a friendly colleague.",
  bulletize:
    "Rewrite the text as a tight bullet list. One idea per line, each line starting with '- '.",
  translate:
    "Translate the text. Preserve names, numbers, URLs, and formatting; do not add commentary.",
  write: WRITE_INSTRUCTION,
};

const SYSTEM = [
  "You are a writing assistant embedded in an email composer.",
  "Follow the requested transformation precisely and return only the resulting email text.",
  "Never add a subject line, greeting you were not asked for, sign-off, or commentary.",
  "Preserve names, numbers, dates, links, and commitments exactly as written.",
  "Do not invent facts, offers, prices, or deadlines.",
].join(" ");

function targetText({ action, body, selection }: ComposeAssistInput): string {
  if (action === "complete") return body;
  if (action === "write") return body.trim();
  return (selection?.trim() ? selection : body).trim();
}

export function buildComposeAssistPrompt(input: ComposeAssistInput): string {
  const context = [
    input.to?.length ? `Recipients: ${input.to.join(", ")}` : "",
    input.subject?.trim() ? `Subject: ${input.subject.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Free-form generation: the user's request drives the whole body.
  if (input.action === "write") {
    const existing = input.body.trim();
    return [
      context,
      `<instruction>\n${WRITE_INSTRUCTION}\nUser request: ${
        input.instruction?.trim() || "Write a fitting email."
      }\n</instruction>`,
      existing ? `<existing_draft>\n${existing}\n</existing_draft>` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  const instruction =
    input.action === "translate"
      ? `${ACTION_INSTRUCTIONS.translate} Target language: ${input.targetLanguage ?? "English"}.`
      : ACTION_INSTRUCTIONS[input.action];

  const isComplete = input.action === "complete";

  return [
    context,
    `<instruction>\n${instruction}\n</instruction>`,
    isComplete
      ? `<draft_so_far>\n${targetText(input)}\n</draft_so_far>`
      : `<text>\n${targetText(input)}\n</text>`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Deterministic fallback. For transformations it returns the input unchanged
 * (a safe no-op rather than a garbled suggestion); for `complete` it returns an
 * empty string so nothing is appended.
 */
export function buildComposeAssistFallback(input: ComposeAssistInput): string {
  if (input.action === "complete") return "";
  return targetText(input);
}

function tokenCap(action: ComposeAssistAction): number {
  if (action === "complete") return 200;
  if (action === "write") return 800;
  return 700;
}

/**
 * The stream the route returns. Falls back to a single-chunk deterministic
 * stream when no model is available, so the client always gets text/plain.
 */
export async function composeAssistStream({
  userId,
  input,
}: {
  userId: string;
  input: ComposeAssistInput;
}): Promise<ReadableStream<Uint8Array>> {
  const encoder = new TextEncoder();
  const stream = await streamGenerate({
    role: "standard",
    feature: "compose-assist",
    userId,
    system: SYSTEM,
    prompt: buildComposeAssistPrompt(input),
    hardening: { trust: "trusted", outputConstraint: "plain-text" },
    maxOutputTokens: tokenCap(input.action),
    userInitiated: true,
    timeoutMs: 30_000,
  });

  if (!stream) {
    const fallback = buildComposeAssistFallback(input);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        if (fallback) controller.enqueue(encoder.encode(fallback));
        controller.close();
      },
    });
  }

  return stream.pipeThrough(
    new TransformStream<string, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(encoder.encode(chunk));
      },
    }),
  );
}
