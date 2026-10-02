import "server-only";

import { z } from "zod";

import { generateObject } from "@/lib/ai/generate";

/**
 * Campaign reply automation (Phase 7).
 *
 * Classifies a reply that belongs to a campaign, deterministically detecting
 * bounces and unsubscribe requests from headers/body before any model call.
 * Safety is structural: only out-of-office gets an automatic acknowledgement;
 * interested/question/not-interested always become drafts. Auto-replies never
 * carry a commitment.
 */

export const CAMPAIGN_REPLY_CLASSES = [
  "interested",
  "question",
  "not_interested",
  "unsubscribe",
  "out_of_office",
  "bounce",
] as const;

export type CampaignReplyClass = (typeof CAMPAIGN_REPLY_CLASSES)[number];

const replySchema = z.object({
  classification: z.enum(CAMPAIGN_REPLY_CLASSES),
  confidence: z.number().int().min(0).max(100),
});

const SYSTEM = [
  "Classify a reply to a bulk outreach email.",
  "interested: wants to engage. question: asks something. not_interested: declines.",
  "unsubscribe: asks to stop. out_of_office: automatic absence notice. bounce: delivery failure.",
  "Choose exactly one.",
].join(" ");

const BOUNCE_PATTERN =
  /\b(mailer-daemon|postmaster|delivery (status )?notification|undeliverable|delivery has failed|address not found|does not exist|mailbox full|550 |551 |552 |553 )\b/i;
const UNSUBSCRIBE_PATTERN =
  /\b(unsubscribe|opt[ -]?out|remove me|take me off|stop (emailing|contacting)|do not (email|contact))\b/i;
const OOO_PATTERN =
  /\b(out of (the )?office|automatic reply|auto[- ]?reply|on (annual )?leave|currently away|maternity leave|will be back)\b/i;

/** Deterministic verdict for the cases we must never leave to a model. */
export function deterministicReplyClass({
  from,
  subject,
  body,
}: {
  from: string | null;
  subject: string | null;
  body: string | null;
}): CampaignReplyClass | null {
  const address = (from ?? "").toLowerCase();
  const text = `${subject ?? ""}\n${body ?? ""}`;

  if (
    BOUNCE_PATTERN.test(text) ||
    /^(mailer-daemon|postmaster)@/.test(address) ||
    address.includes("mailer-daemon")
  ) {
    return "bounce";
  }
  // An explicit unsubscribe request wins over everything else.
  if (UNSUBSCRIBE_PATTERN.test(text)) return "unsubscribe";
  if (OOO_PATTERN.test(text)) return "out_of_office";
  return null;
}

export type CampaignReplyVerdict = {
  classification: CampaignReplyClass;
  source: "model" | "heuristic";
};

/** Classify a campaign reply; deterministic classes never reach the model. */
export async function classifyCampaignReply({
  userId,
  from,
  subject,
  body,
}: {
  userId: string;
  from: string | null;
  subject: string | null;
  body: string | null;
}): Promise<CampaignReplyVerdict> {
  const deterministic = deterministicReplyClass({ from, subject, body });
  if (deterministic) return { classification: deterministic, source: "heuristic" };

  const ai = await generateObject({
    schema: replySchema,
    role: "fast",
    feature: "campaign-reply",
    userId,
    system: SYSTEM,
    prompt: [
      `From: ${from ?? "unknown"}`,
      `Subject: ${subject ?? "(none)"}`,
      `<body>\n${(body ?? "").slice(0, 2_000)}\n</body>`,
    ].join("\n"),
    hardening: { trust: "untrusted", level: "compact" },
    maxOutputTokens: 120,
  });

  if (ai) return { classification: ai.classification, source: "model" };

  // Conservative fallback: treat as a question so it becomes a draft for review.
  return { classification: "question", source: "heuristic" };
}

/**
 * Whether a class may be handled automatically. Only out-of-office gets an
 * automatic acknowledgement; unsubscribe/bounce are suppression side effects.
 * Everything else is drafted for the user.
 */
export function canAutoRespond(classification: CampaignReplyClass): boolean {
  return classification === "out_of_office";
}

/**
 * Hard guard: an auto-reply must never imply a commitment. Even for an
 * out-of-office reply we refuse to auto-send if the acknowledgement text (or the
 * incoming message) mentions a price, date, or commitment.
 */
const COMMITMENT_PATTERN =
  /\b(price|pricing|cost|quote|\$\d|discount|deadline|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|end of)|guarantee|contract|agree to|commit)\b/i;

export function impliesCommitment(...texts: Array<string | null | undefined>): boolean {
  return texts.some((text) => (text ? COMMITMENT_PATTERN.test(text) : false));
}

/** Build a safe, commitment-free out-of-office acknowledgement. */
export function buildOutOfOfficeAck(): string {
  return [
    "Thanks for the note — I'm away right now and will get back to you when I return.",
    "",
    "If it's urgent, reply again and I'll see it as soon as I can.",
  ].join("\n");
}
