import "server-only";

import { z } from "zod";

import { AI_CLASSIFIER_MODEL_ID } from "@/lib/ai/provider";
import { generateStructured } from "@/lib/ai/structured";
import { db } from "@/lib/db";
import { threadStates } from "@/lib/db/schema";
import { defineStep } from "@/lib/engine/step";
import { loadThreadContext } from "@/lib/email-operator/thread-context";
import { requireThreadId } from "./helpers";

export const TRIAGE_CATEGORIES = [
  "needs_reply",
  "awaiting_reply",
  "fyi",
  "meeting_request",
  "invoice",
  "newsletter",
  "spam",
] as const;

export type TriageCategory = (typeof TRIAGE_CATEGORIES)[number];
export type TriageAction = "draft" | "none" | "handoff";

export type TriageResult = {
  category: TriageCategory;
  priority: number;
  action: TriageAction;
  reason?: string;
};

export const triageResultSchema = z.object({
  category: z.enum(TRIAGE_CATEGORIES),
  priority: z.number().int().min(0).max(100),
  action: z.enum(["draft", "none", "handoff"]),
  reason: z.string().max(200).optional(),
});

const PRIORITY: Record<TriageCategory, number> = {
  meeting_request: 80,
  needs_reply: 60,
  invoice: 40,
  awaiting_reply: 30,
  fyi: 10,
  newsletter: 5,
  spam: 0,
};

const MEETING_PATTERN =
  /\b(meet|meeting|call|schedule|calendar|availability|available|book|sync up|catch up|standup|1:1|slot)\b/i;
const NEWSLETTER_PATTERN =
  /\b(unsubscribe|newsletter|webinar|no-?reply|do not reply|digest|weekly roundup|promotion|% off|sale ends)\b/i;
const INVOICE_PATTERN =
  /\b(invoice|receipt|payment|remittance|purchase order|billing|amount due)\b/i;
const SPAM_PATTERN =
  /\b(viagra|crypto|casino|lottery|winner|wire transfer|nigerian prince|bitcoin investment)\b/i;
const REQUEST_PATTERN =
  /\b(can you|could you|would you|please|need you|let me know|thoughts|feedback|review|confirm|approve)\b|\?/i;

/** Deterministic triage used when no model is configured. */
export function heuristicTriage({
  subject,
  body,
}: {
  subject: string | null;
  body: string;
}): TriageResult {
  const text = `${subject ?? ""}\n${body}`;

  if (SPAM_PATTERN.test(text)) {
    return { category: "spam", priority: PRIORITY.spam, action: "handoff", reason: "spam signals" };
  }
  if (MEETING_PATTERN.test(text)) {
    return {
      category: "meeting_request",
      priority: PRIORITY.meeting_request,
      action: "draft",
      reason: "meeting language",
    };
  }
  if (INVOICE_PATTERN.test(text)) {
    return {
      category: "invoice",
      priority: PRIORITY.invoice,
      action: "none",
      reason: "invoice language",
    };
  }
  if (NEWSLETTER_PATTERN.test(text)) {
    return {
      category: "newsletter",
      priority: PRIORITY.newsletter,
      action: "none",
      reason: "newsletter signals",
    };
  }
  if (REQUEST_PATTERN.test(text)) {
    return {
      category: "needs_reply",
      priority: PRIORITY.needs_reply,
      action: "draft",
      reason: "explicit request",
    };
  }
  return { category: "fyi", priority: PRIORITY.fyi, action: "none", reason: "no action needed" };
}

const TRIAGE_SYSTEM_PROMPT = [
  "You triage a single inbound email thread for an executive assistant.",
  "Choose exactly one category:",
  "- meeting_request: asks to meet, call, schedule, or check availability",
  "- needs_reply: a real person expects an answer or action from the user",
  "- awaiting_reply: the user already replied and is waiting on the other side",
  "- invoice: invoices, receipts, billing, or payments",
  "- newsletter: bulk or marketing mail, digests, unsubscribe links",
  "- spam: scams, phishing, or unsolicited promotional junk",
  "- fyi: informational, no reply or action needed",
  "Set priority 0-100, roughly: meeting_request 80, needs_reply 60, invoice 40,",
  "awaiting_reply 30, fyi 10, newsletter 5, spam 0.",
  'Set action to "draft" when the assistant should write a reply, "handoff"',
  'for spam or malicious mail, otherwise "none".',
].join(" ");

export const triageStep = defineStep({
  type: "triage",
  configSchema: z.object({
    maxBodyChars: z.number().int().positive().max(20_000).optional(),
  }),
  async run(ctx) {
    const threadId = requireThreadId(ctx);
    const context = await loadThreadContext({
      userId: ctx.userId,
      threadId,
      historyLimit: 4,
    });

    const subject = context?.thread.subject ?? null;
    const body = (
      context?.latestInbound?.bodyText ??
      context?.latestInbound?.snippet ??
      ""
    ).slice(0, ctx.input.maxBodyChars ?? 6_000);

    const ai = await generateStructured({
      schema: triageResultSchema,
      system: TRIAGE_SYSTEM_PROMPT,
      prompt: `Subject: ${subject ?? "(none)"}\n\nBody:\n${body}`,
      modelId: AI_CLASSIFIER_MODEL_ID,
      userId: ctx.userId,
    });

    const result = ai ?? heuristicTriage({ subject, body });

    await db
      .insert(threadStates)
      .values({
        threadId,
        category: result.category,
        priority: result.priority,
        action: result.action,
      })
      .onConflictDoUpdate({
        target: threadStates.threadId,
        set: {
          category: result.category,
          priority: result.priority,
          action: result.action,
          updatedAt: new Date(),
        },
      });

    ctx.log("triage", result);
    return result;
  },
});
