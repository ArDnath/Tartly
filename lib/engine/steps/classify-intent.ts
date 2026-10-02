import "server-only";

import { z } from "zod";

import { generateObject } from "@/lib/ai/generate";
import { defineStep } from "@/lib/engine/step";
import { loadThreadContext } from "@/lib/email-operator/thread-context";
import { requireThreadId } from "./helpers";

export const INTENTS = [
  "question",
  "request",
  "meeting",
  "update",
  "invoice",
  "newsletter",
  "spam",
  "other",
] as const;

export const SENTIMENTS = ["positive", "neutral", "negative"] as const;

export const intentResultSchema = z.object({
  intent: z.enum(INTENTS),
  sentiment: z.enum(SENTIMENTS),
  confidence: z.number().min(0).max(1),
  wantsMeeting: z.boolean(),
});

export type IntentResult = z.infer<typeof intentResultSchema>;

const POSITIVE_PATTERN = /\b(thanks|thank you|great|awesome|perfect|appreciate|sounds good|love)\b/i;
const NEGATIVE_PATTERN = /\b(angry|disappointed|frustrated|unacceptable|complaint|refund|cancel|urgent problem)\b/i;
const MEETING_PATTERN = /\b(meet|meeting|call|schedule|calendar|availability|available|book|slot)\b/i;
const QUESTION_PATTERN = /\?|\b(when|where|how|why|which|who|can you|could you|do you)\b/i;
const REQUEST_PATTERN = /\b(please|could you|can you|need you|send me|share|review|approve|confirm)\b/i;

/** Deterministic intent classification used when no model is configured. */
export function heuristicIntent({
  subject,
  body,
}: {
  subject: string | null;
  body: string;
}): IntentResult {
  const text = `${subject ?? ""}\n${body}`;
  const wantsMeeting = MEETING_PATTERN.test(text);

  let intent: IntentResult["intent"] = "other";
  if (wantsMeeting) intent = "meeting";
  else if (/\b(invoice|receipt|payment|billing)\b/i.test(text)) intent = "invoice";
  else if (/\b(unsubscribe|newsletter|webinar)\b/i.test(text)) intent = "newsletter";
  else if (QUESTION_PATTERN.test(text)) intent = "question";
  else if (REQUEST_PATTERN.test(text)) intent = "request";
  else if (/\b(update|status|fyi|heads up)\b/i.test(text)) intent = "update";

  const sentiment: IntentResult["sentiment"] = POSITIVE_PATTERN.test(text)
    ? "positive"
    : NEGATIVE_PATTERN.test(text)
      ? "negative"
      : "neutral";

  return { intent, sentiment, confidence: 0.5, wantsMeeting };
}

const SYSTEM_PROMPT =
  "Classify an email thread's intent and sentiment, and whether the sender " +
  "wants to schedule a meeting. Be conservative: only set wantsMeeting when " +
  "the sender clearly proposes or asks for time.";

export const classifyIntentStep = defineStep({
  type: "classify-intent",
  configSchema: z.object({ model: z.string().optional() }),
  async run(ctx) {
    const threadId = requireThreadId(ctx);
    const context = await loadThreadContext({ userId: ctx.userId, threadId, historyLimit: 4 });

    const subject = context?.thread.subject ?? null;
    const body = (context?.latestInbound?.bodyText ?? context?.latestInbound?.snippet ?? "").slice(0, 6_000);

    const ai = await generateObject({
      schema: intentResultSchema,
      role: "fast",
      feature: "classify-intent",
      system: SYSTEM_PROMPT,
      prompt: `Subject: ${subject ?? "(none)"}\n\nBody:\n${body}`,
      hardening: { trust: "untrusted", level: "compact" },
      maxOutputTokens: 200,
      userId: ctx.userId,
    });

    const result = ai ?? heuristicIntent({ subject, body });
    ctx.log("classify-intent", result);
    return result;
  },
});
