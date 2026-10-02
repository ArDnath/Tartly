import "server-only";

import { z } from "zod";

import { generateObject } from "@/lib/ai/generate";
import { SENDER_CATEGORIES, type SenderCategory } from "@/lib/db/schema";

import { isAutomatedSender } from "./cold-email";

/**
 * Sender categorization (C6).
 *
 * Sorts senders into a fixed taxonomy so the inbox can show what kind of mail
 * this is and the noise categories can be auto-archived. Up to ten *new*
 * senders are classified in one call and cached on the profile; a known sender
 * never reaches the model.
 *
 * Guard: the model may only return senders that were in the input and only
 * categories from the taxonomy — anything else is dropped.
 */

export const CATEGORIZE_VERSION = "categorize-sender-v1";

/** New senders per batched call. */
export const CATEGORIZE_BATCH_MAX = 10;

export const SENDER_TAXONOMY = SENDER_CATEGORIES;

export type SenderCategoryInput = {
  email: string;
  /** Private org domain, or "". */
  domain: string;
  fromName: string | null;
  /** 0–100 bulk-mail signal from headers. */
  marketingScore: number;
  /** True when cold-email scoring already flagged this sender. */
  isCold: boolean;
};

export type SenderCategoryResult = {
  email: string;
  category: SenderCategory;
  confidence: number;
  source: "model" | "heuristic";
};

const RECEIPT_PATTERN = /\b(receipt|order|invoice|payment|billing|subscription|purchase)\b/i;
const FINANCE_PATTERN = /\b(bank|statement|transaction|paypal|stripe|wise|credit|salary|tax)\b/i;
const NOTIFICATION_PATTERN =
  /\b(verification code|security alert|sign-?in|password|otp|alert|notification|github|jira|asana|slack|calendar invite)\b/i;

/** Deterministic category from headers and address shape — the fallback. */
export function heuristicCategorizeSender(
  input: SenderCategoryInput,
): SenderCategoryResult {
  const haystack = `${input.fromName ?? ""} ${input.email} ${input.domain}`.toLowerCase();

  let category: SenderCategory = "Other";
  let confidence = 40;

  if (input.isCold) {
    category = "Cold Outreach";
    confidence = 70;
  } else if (input.marketingScore >= 60) {
    // A list header means a newsletter; strong promo signals mean marketing.
    category = NOTIFICATION_PATTERN.test(haystack) ? "Notifications" : "Newsletters";
    confidence = 65;
  } else if (RECEIPT_PATTERN.test(haystack)) {
    category = "Receipts";
    confidence = 55;
  } else if (FINANCE_PATTERN.test(haystack)) {
    category = "Financial";
    confidence = 55;
  } else if (NOTIFICATION_PATTERN.test(haystack) || isAutomatedSender(input.email)) {
    category = "Notifications";
    confidence = 55;
  } else if (!input.domain) {
    // A public webmail address with a human-looking name is likely personal.
    category = input.fromName ? "Personal" : "Other";
    confidence = input.fromName ? 50 : 30;
  } else {
    category = "Work";
    confidence = 35;
  }

  return { email: input.email, category, confidence, source: "heuristic" };
}

const batchSchema = z.object({
  results: z
    .array(
      z.object({
        index: z.number().int().min(0),
        category: z.enum(SENDER_CATEGORIES),
      }),
    )
    .max(CATEGORIZE_BATCH_MAX),
});

const SYSTEM_PROMPT = [
  "Categorize each email sender into exactly one of these categories:",
  SENDER_CATEGORIES.join(", ") + ".",
  "- Personal: a real individual the user knows or corresponds with.",
  "- Work: colleagues, clients, vendors, or business services.",
  "- Financial: banks, statements, payments, tax.",
  "- Receipts: order confirmations and purchase receipts.",
  "- Newsletters: opted-in or bulk editorial mail with an unsubscribe link.",
  "- Marketing: promotional mail and offers.",
  "- Notifications: automated alerts (security, CI, app notifications).",
  "- Cold Outreach: unsolicited sales/recruiting from an unknown sender.",
  "- Other: anything that does not fit.",
  "Return one category per input index. Do not invent senders.",
].join(" ");

/** Drop any result that names a sender not in `allowedEmails` (guard). */
export function sanitizeSenderCategories(
  results: SenderCategoryResult[],
  allowedEmails: string[],
): SenderCategoryResult[] {
  const allowed = new Set(allowedEmails.map((email) => email.trim().toLowerCase()));
  return results.filter((result) => allowed.has(result.email.trim().toLowerCase()));
}

/**
 * Categorize a bounded batch of new senders in one call. Results are aligned to
 * input order; anything the model omits falls back to the heuristic.
 */
export async function categorizeSendersBatch({
  userId,
  senders,
}: {
  userId: string;
  senders: SenderCategoryInput[];
}): Promise<SenderCategoryResult[]> {
  const bounded = senders.slice(0, CATEGORIZE_BATCH_MAX);
  const fallback = bounded.map((sender) => heuristicCategorizeSender(sender));
  if (bounded.length === 0) return [];

  const ai = await generateObject({
    schema: batchSchema,
    role: "fast",
    feature: "categorize-sender",
    userId,
    system: SYSTEM_PROMPT,
    prompt: bounded
      .map((sender, index) =>
        [
          `<sender index="${index}">`,
          `Name: ${sender.fromName ?? "(unknown)"}`,
          `Email: ${sender.email}`,
          `Domain: ${sender.domain || "(public webmail)"}`,
          `BulkSignals: ${sender.marketingScore}`,
          `LikelyColdOutreach: ${sender.isCold ? "yes" : "no"}`,
          "</sender>",
        ].join("\n"),
      )
      .join("\n\n"),
    hardening: { trust: "untrusted", level: "compact" },
    maxOutputTokens: Math.min(800, 120 + bounded.length * 40),
  });

  if (!ai) return fallback;

  // Guard: model results are only trusted for inputs we asked about.
  const allowed = bounded.map((sender) => sender.email);
  const guarded = sanitizeSenderCategories(
    ai.results.map((result) => ({
      email: bounded[result.index]?.email ?? "",
      category: result.category,
      confidence: 75,
      source: "model" as const,
    })),
    allowed,
  );
  const byEmail = new Map(guarded.map((result) => [result.email, result]));

  return bounded.map((sender, index) => byEmail.get(sender.email) ?? fallback[index]!);
}
