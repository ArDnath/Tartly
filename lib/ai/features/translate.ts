import "server-only";

import { generateText } from "@/lib/ai/generate";
import { isTranslateEnabled } from "@/lib/env";

/**
 * Translate / reply-in-language (Phase 5).
 *
 * A small, plain-text translation used by the mail reader and the agent's
 * drafting directive ("reply in French"). It never sends: output flows back into
 * a draft or the composer. Deterministic fallback returns the original text so a
 * model outage can never produce a garbled or empty message.
 */

export const TRANSLATE_VERSION = "translate-v1";

/** A conservative allowlist of common targets; any short language name works. */
export const TRANSLATE_LANGUAGES = [
  "English",
  "Spanish",
  "French",
  "German",
  "Portuguese",
  "Italian",
  "Dutch",
  "Hindi",
  "Arabic",
  "Japanese",
  "Korean",
  "Chinese (Simplified)",
] as const;

const SYSTEM = [
  "You are a professional translator embedded in an email client.",
  "Translate the user's text into the requested language.",
  "Preserve names, numbers, dates, URLs, and line breaks. Do not add commentary, greetings, or sign-offs.",
  "Output only the translated text in plain text (no markdown or HTML).",
].join(" ");

/** Trim and bound a language name; returns null when unusable. */
export function normalizeLanguage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, 40);
  if (!trimmed) return null;
  if (!/^[\p{L}\p{M}() .'-]+$/u.test(trimmed)) return null;
  return trimmed;
}

export type TranslateResult = {
  text: string;
  source: "model" | "fallback";
  targetLanguage: string;
};

export async function translateText({
  userId,
  text,
  targetLanguage,
}: {
  userId: string;
  text: string;
  targetLanguage: string;
}): Promise<TranslateResult> {
  const source = text.trim();
  const language = normalizeLanguage(targetLanguage) ?? "English";

  if (!isTranslateEnabled() || !source) {
    return { text, source: "fallback", targetLanguage: language };
  }

  try {
    const translated = await generateText({
      role: "standard",
      feature: "translate",
      userId,
      system: SYSTEM,
      prompt: `Target language: ${language}\n\n<text>\n${source}\n</text>`,
      hardening: { trust: "trusted", outputConstraint: "plain-text" },
      maxOutputTokens: 1_500,
      userInitiated: true,
    });
    const result = translated?.trim();
    if (result) {
      return { text: result, source: "model", targetLanguage: language };
    }
  } catch (error) {
    console.warn("[translate] failed", error);
  }

  return { text, source: "fallback", targetLanguage: language };
}
